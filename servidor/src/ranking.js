// Ranking da calçada (3.29): quem mais ganha partidas na mesa online, na semana (vira na segunda-feira) e no mês
// (horário de Manaus). Quem conta é a mesa, no servidor: só partidas jogadas do começo ao fim pela pessoa (sem robô
// jogando no lugar dela). Partida offline não entra (fica só no celular, não dá para conferir).
// Fica de fora: menor de 18 (o app avisa; e quem aparece como menor no "No app agora"), quem foi bloqueado e quem pediu
// para não aparecer. Guarda o código do aparelho, o apelido, o avatar desenhado e o nível de cada um, por até 13 meses.
const DIA = 86400000, MANAUS = 4 * 3600000;
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const TOP = 20;
export function periodos(agora) {
  const d = new Date(agora - MANAUS);   // campos UTC = hora de Manaus
  const dia = (d.getUTCDay() + 6) % 7;   // 0 = segunda-feira
  const seg = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia);
  return {
    sem: 'S' + new Date(seg).toISOString().slice(0, 10), fimSem: seg + 7 * DIA + MANAUS,
    mes: 'M' + d.toISOString().slice(0, 7), fimMes: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) + MANAUS
  };
}
// Fim de partida online: quem jogou a partida inteira (quem: [{ id, nome, av, nv, menor, ganhou }])
export async function somarRanking(env, quem) {
  const agora = Date.now(), { sem, mes } = periodos(agora);
  for (const q of quem) {
    if (!q || !idOk(q.id) || q.menor) continue;
    try { const pr = await env.DB.prepare('SELECT menor FROM presenca WHERE aparelho = ?').bind(q.id).first(); if (pr && pr.menor) continue; } catch (e) {}
    for (const per of [sem, mes]) {
      await env.DB.prepare(`INSERT INTO ranking (periodo, aparelho, nome, av, nv, ganhas, jogadas, atualizado) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT (periodo, aparelho) DO UPDATE SET nome = excluded.nome, av = excluded.av, nv = excluded.nv,
          ganhas = ganhas + excluded.ganhas, jogadas = jogadas + 1, atualizado = excluded.atualizado`)
        .bind(per, q.id, String(q.nome || 'Jogador').slice(0, 16), q.av || null, Math.max(1, Math.min(50, Number(q.nv) || 1)), q.ganhou ? 1 : 0, agora).run();
    }
  }
}
const FILTRO = 'NOT EXISTS (SELECT 1 FROM ranking_fora f WHERE f.aparelho = r.aparelho) AND NOT EXISTS (SELECT 1 FROM bloqueios b WHERE b.aparelho = r.aparelho)';
async function lista(env, per, fim, eu) {
  const { results } = await env.DB.prepare(`SELECT aparelho, nome, av, nv, ganhas, jogadas FROM ranking r WHERE periodo = ? AND ganhas > 0 AND ${FILTRO}
      ORDER BY ganhas DESC, jogadas ASC, atualizado ASC LIMIT ${TOP}`).bind(per).all();
  const top = (results || []).map((x, i) => ({ pos: i + 1, nome: x.nome, av: x.av, nv: x.nv, ganhas: x.ganhas, jogadas: x.jogadas, eu: !!eu && x.aparelho === eu }));
  let meu = null;
  if (eu && !top.some(x => x.eu)) {
    const me = await env.DB.prepare('SELECT ganhas, jogadas, atualizado FROM ranking WHERE periodo = ? AND aparelho = ?').bind(per, eu).first();
    if (me && me.ganhas > 0) {
      const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ranking r WHERE periodo = ? AND ganhas > 0 AND ${FILTRO}
          AND (ganhas > ? OR (ganhas = ? AND (jogadas < ? OR (jogadas = ? AND atualizado < ?))))`)
        .bind(per, me.ganhas, me.ganhas, me.jogadas, me.jogadas, me.atualizado).first();
      meu = { pos: ((c && c.n) || 0) + 1, ganhas: me.ganhas, jogadas: me.jogadas };
    } else if (me) meu = { pos: null, ganhas: 0, jogadas: me.jogadas };
  }
  return { top, eu: meu, fim };
}
// GET /ranking?aparelho= -> { semana, mes, fora }
export async function ranking(req, env, origin, h, url) {
  const ap = idOk(url.searchParams.get('aparelho')) ? url.searchParams.get('aparelho') : null;
  const p = periodos(Date.now());
  const fora = ap ? !!(await env.DB.prepare('SELECT 1 AS x FROM ranking_fora WHERE aparelho = ?').bind(ap).first()) : false;
  return h.json({ semana: await lista(env, p.sem, p.fimSem, fora ? null : ap), mes: await lista(env, p.mes, p.fimMes, fora ? null : ap), fora }, 200, origin);
}
// POST /ranking/fora {aparelho, fora: true|false} — não aparecer (ou voltar a aparecer) no ranking
export async function sairDoRanking(req, env, origin, h) {
  let b; try { b = JSON.parse(await req.text()); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!b || !idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (b.fora) await env.DB.prepare('INSERT INTO ranking_fora (aparelho, em) VALUES (?, ?) ON CONFLICT (aparelho) DO NOTHING').bind(b.aparelho, Date.now()).run();
  else await env.DB.prepare('DELETE FROM ranking_fora WHERE aparelho = ?').bind(b.aparelho).run();
  return h.json({ ok: true, fora: !!b.fora }, 200, origin);
}
// No agendado: o ranking guarda no máximo 13 meses
export async function limparRanking(env) {
  await env.DB.prepare('DELETE FROM ranking WHERE atualizado < ?').bind(Date.now() - 400 * DIA).run();
}
