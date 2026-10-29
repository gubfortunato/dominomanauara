// Ranking da calçada (3.29): quem mais ganha partidas na mesa online, na semana (vira na segunda-feira) e no mês
// (horário de Manaus). Quem conta é a mesa, no servidor: só partidas jogadas do começo ao fim pela pessoa (sem robô
// jogando no lugar dela). Partida offline não entra (fica só no celular, não dá para conferir).
// Fica de fora: menor de 18 (o app avisa; e quem aparece como menor no "No app agora"), quem foi bloqueado e quem pediu
// para não aparecer. Guarda o código do aparelho, o apelido, o avatar desenhado e o nível de cada um, por até 13 meses.
//
// 3.37 (o dono achou que o ranking subia rápido demais e sem emoção: vitória contra robô valia igual a vitória contra
// gente, e perder não custava nada): a partir da semana de 26/10/2026 (e do mês de novembro), o ranking é por PONTOS.
//   vitória contra pessoas (pelo menos uma pessoa do outro lado, que jogou a partida inteira): +3
//   vitória contra robôs: +1, só as 3 primeiras do dia
//   derrota contra pessoas: -1 (nunca abaixo de 0); derrota contra robôs: 0
//   contra a mesma pessoa, só as 5 primeiras partidas do dia valem ponto (para ninguém combinar resultado)
// Desempate: aproveitamento (vitórias ÷ partidas) e, depois, quem chegou primeiro. Semanas e meses que começaram antes
// continuam por vitórias (tabela ranking), para ninguém perder o que já tinha no meio da semana.
// Rei da Calçada: o 1º da semana passada ganha a coroa na mesa online durante a semana seguinte.
// Apelido genérico ("Anonimous", "Jogador"...) não aparece no ranking: a pessoa vê o aviso para escolher um apelido.
import { nomeGenerico, nomeOfensivo } from './motor.js';
import { limitesValem, temPlano } from './planos.js';   // 28/10: ranking completo é dos sócios

const DIA = 86400000, MANAUS = 4 * 3600000;
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const TOP = 20, LER = 300;
const PONTOS_DESDE = Date.parse('2026-10-26T00:00:00-04:00');
export const PTS = { gente: 3, robo: 1, derrota: -1 };
export const ROBO_POR_DIA = 3, PAR_POR_DIA = 5;
const agoraDe = env => Number(env && env.RANKING_AGORA) || Date.now();   // RANKING_AGORA: só nos testes
export function pontosDesde(env) {
  const v = env && env.PONTOS_DESDE;
  return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : PONTOS_DESDE;
}
const diaManaus = t => new Date(t - MANAUS).toISOString().slice(0, 10);
export function periodos(agora) {
  const d = new Date(agora - MANAUS);   // campos UTC = hora de Manaus
  const dia = (d.getUTCDay() + 6) % 7;   // 0 = segunda-feira
  const seg = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia);
  return {
    sem: 'S' + new Date(seg).toISOString().slice(0, 10), fimSem: seg + 7 * DIA + MANAUS,
    mes: 'M' + d.toISOString().slice(0, 7), fimMes: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) + MANAUS
  };
}
// quando começa a semana (S2026-10-26) ou o mês (M2026-11), no horário de Manaus
function inicio(per) { const s = per.slice(1); return Date.parse((per[0] === 'S' ? s : s + '-01') + 'T00:00:00-04:00'); }
export function usaPontos(env, per) { return inicio(per) >= pontosDesde(env); }

// Fim de partida online: quem jogou a partida inteira
// (quem: [{ id, nome, av, nv, menor, ganhou, gente, oponente }]; gente = tinha pessoa do outro lado; oponente = o código dela)
export async function somarRanking(env, quem) {
  const agora = agoraDe(env), { sem, mes } = periodos(agora), dia = diaManaus(agora);
  for (const q of quem) {
    if (!q || !idOk(q.id) || q.menor) continue;
    try { const pr = await env.DB.prepare('SELECT menor FROM presenca WHERE aparelho = ?').bind(q.id).first(); if (pr && pr.menor) continue; } catch (e) {}
    const nome = String(q.nome || 'Jogador').slice(0, 16), av = q.av || null, nv = Math.max(1, Math.min(50, Number(q.nv) || 1));
    for (const per of [sem, mes]) {
      await env.DB.prepare(`INSERT INTO ranking (periodo, aparelho, nome, av, nv, ganhas, jogadas, atualizado) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT (periodo, aparelho) DO UPDATE SET nome = excluded.nome, av = excluded.av, nv = excluded.nv,
          ganhas = ganhas + excluded.ganhas, jogadas = jogadas + 1, atualizado = excluded.atualizado`)
        .bind(per, q.id, nome, av, nv, q.ganhou ? 1 : 0, agora).run();
    }
    const pers = [sem, mes].filter(per => usaPontos(env, per));
    if (!pers.length) continue;
    const gente = !!q.gente && idOk(q.oponente);
    let delta = 0;
    if (gente) {
      const r = await env.DB.prepare('INSERT INTO calcada_par (dia, a, b, n) VALUES (?, ?, ?, 1) ON CONFLICT (dia, a, b) DO UPDATE SET n = n + 1 RETURNING n')
        .bind(dia, q.id, q.oponente).first();
      if (((r && r.n) || 1) <= PAR_POR_DIA) delta = q.ganhou ? PTS.gente : PTS.derrota;
    } else if (q.ganhou) {
      const r = await env.DB.prepare('INSERT INTO calcada_robo (dia, aparelho, n) VALUES (?, ?, 1) ON CONFLICT (dia, aparelho) DO UPDATE SET n = n + 1 RETURNING n')
        .bind(dia, q.id).first();
      if (((r && r.n) || 1) <= ROBO_POR_DIA) delta = PTS.robo;
    }
    for (const per of pers) {
      await env.DB.prepare(`INSERT INTO calcada (periodo, aparelho, nome, av, nv, pontos, ganhas, jogadas, ganhas_gente, jogadas_gente, atualizado)
          VALUES (?, ?, ?, ?, ?, MAX(0, ?), ?, 1, ?, ?, ?)
          ON CONFLICT (periodo, aparelho) DO UPDATE SET nome = excluded.nome, av = excluded.av, nv = excluded.nv, pontos = MAX(0, pontos + ?),
          ganhas = ganhas + excluded.ganhas, jogadas = jogadas + 1, ganhas_gente = ganhas_gente + excluded.ganhas_gente,
          jogadas_gente = jogadas_gente + excluded.jogadas_gente, atualizado = CASE WHEN ? != 0 THEN excluded.atualizado ELSE atualizado END`)
        .bind(per, q.id, nome, av, nv, delta, q.ganhou ? 1 : 0, gente && q.ganhou ? 1 : 0, gente ? 1 : 0, agora, delta, delta).run();
    }
  }
}
const FILTRO = 'NOT EXISTS (SELECT 1 FROM ranking_fora f WHERE f.aparelho = r.aparelho) AND NOT EXISTS (SELECT 1 FROM bloqueios b WHERE b.aparelho = r.aparelho)';
// a lista do período em ordem (já sem quem pediu para sair, bloqueados e apelidos genéricos)
async function ordenados(env, per) {
  const sql = usaPontos(env, per)
    ? `SELECT aparelho, nome, av, nv, pontos, ganhas, jogadas, atualizado FROM calcada r WHERE periodo = ? AND pontos > 0 AND ${FILTRO}
        ORDER BY pontos DESC, (ganhas * 1.0 / jogadas) DESC, atualizado ASC LIMIT ${LER}`
    : `SELECT aparelho, nome, av, nv, ganhas, jogadas, atualizado FROM ranking r WHERE periodo = ? AND ganhas > 0 AND ${FILTRO}
        ORDER BY ganhas DESC, jogadas ASC, atualizado ASC LIMIT ${LER}`;
  const { results } = await env.DB.prepare(sql).bind(per).all();
  return (results || []).filter(x => !nomeGenerico(x.nome) && !nomeOfensivo(x.nome));   // 3.38.2: apelido ofensivo também fica de fora
}
async function lista(env, per, fim, eu, reiAp) {
  const pts = usaPontos(env, per), todos = await ordenados(env, per);
  const top = todos.slice(0, TOP).map((x, i) => Object.assign({ pos: i + 1, nome: x.nome, av: x.av, nv: x.nv, ganhas: x.ganhas, jogadas: x.jogadas },
    pts ? { pontos: x.pontos } : {}, { eu: !!eu && x.aparelho === eu, rei: !!reiAp && x.aparelho === reiAp }));
  let meu = null;
  if (eu && !top.some(x => x.eu)) {
    const me = await env.DB.prepare(`SELECT nome, ${pts ? 'pontos, ' : ''}ganhas, jogadas, atualizado FROM ${pts ? 'calcada' : 'ranking'} WHERE periodo = ? AND aparelho = ?`)
      .bind(per, eu).first();
    if (me) {
      const base = Object.assign({ ganhas: me.ganhas, jogadas: me.jogadas }, pts ? { pontos: me.pontos } : {});
      const tem = pts ? me.pontos > 0 : me.ganhas > 0, i = todos.findIndex(x => x.aparelho === eu);
      if (nomeGenerico(me.nome) || nomeOfensivo(me.nome)) meu = Object.assign({ pos: null, oculto: 'nome' }, base);
      else if (i >= 0) meu = Object.assign({ pos: i + 1 }, base);
      else if (tem) {
        const c = pts
          ? await env.DB.prepare(`SELECT COUNT(*) AS n FROM calcada r WHERE periodo = ? AND pontos > 0 AND ${FILTRO}
              AND (pontos > ? OR (pontos = ? AND ganhas * ? > ? * jogadas) OR (pontos = ? AND ganhas * ? = ? * jogadas AND atualizado < ?))`)
            .bind(per, me.pontos, me.pontos, me.jogadas, me.ganhas, me.pontos, me.jogadas, me.ganhas, me.atualizado).first()
          : await env.DB.prepare(`SELECT COUNT(*) AS n FROM ranking r WHERE periodo = ? AND ganhas > 0 AND ${FILTRO}
              AND (ganhas > ? OR (ganhas = ? AND (jogadas < ? OR (jogadas = ? AND atualizado < ?))))`)
            .bind(per, me.ganhas, me.ganhas, me.jogadas, me.jogadas, me.atualizado).first();
        meu = Object.assign({ pos: ((c && c.n) || 0) + 1 }, base);
      } else meu = Object.assign({ pos: null }, base, pts ? {} : { ganhas: 0 });
    }
  }
  return { top, eu: meu, fim, pontos: pts };
}
// Rei da Calçada: o 1º da semana passada (guardado 10 min para a mesa não perguntar ao banco toda hora)
const REI = { sem: null, em: 0, dados: null };
export async function reiDaSemana(env) {
  const agora = agoraDe(env), sem = periodos(agora - 7 * DIA).sem;
  if (!env.RANKING_AGORA && REI.sem === sem && agora - REI.em < 10 * 60000) return REI.dados;
  const x = (await ordenados(env, sem))[0];
  REI.sem = sem; REI.em = agora; REI.dados = x ? { aparelho: x.aparelho, nome: x.nome, av: x.av, nv: x.nv } : null;
  return REI.dados;
}
// GET /ranking?aparelho= -> { semana, mes, fora, rei, regras, completo }
// Planos (28/10): sem plano, depois do lançamento, o ranking mostra só o Rei da Calçada e os 3 primeiros da semana; a
// lista completa da semana e do mês e a sua posição são dos sócios (completo = false: o app mostra o convite).
export const TOP_GRATIS = 3;
export async function ranking(req, env, origin, h, url) {
  const ap = idOk(url.searchParams.get('aparelho')) ? url.searchParams.get('aparelho') : null;
  const p = periodos(agoraDe(env));
  const fora = ap ? !!(await env.DB.prepare('SELECT 1 AS x FROM ranking_fora WHERE aparelho = ?').bind(ap).first()) : false;
  let rei = null; try { rei = await reiDaSemana(env); } catch (e) {}
  const eu = fora ? null : ap, reiAp = rei && rei.aparelho;
  const completo = !limitesValem(env) || (!!ap && await temPlano(env, ap));
  const semana = await lista(env, p.sem, p.fimSem, eu, reiAp);
  const mes = completo ? await lista(env, p.mes, p.fimMes, eu, reiAp) : { top: [], eu: null, fim: p.fimMes, pontos: usaPontos(env, p.mes), trancado: true };
  if (!completo) { semana.top = semana.top.slice(0, TOP_GRATIS); semana.eu = null; semana.trancado = true; }
  return h.json({ semana, mes, fora, completo, topGratis: TOP_GRATIS,
    rei: rei ? { nome: rei.nome, av: rei.av, nv: rei.nv, eu: !!ap && ap === reiAp } : null,
    regras: { pontosDesde: pontosDesde(env), ...PTS, roboPorDia: ROBO_POR_DIA, parPorDia: PAR_POR_DIA } }, 200, origin);
}
// POST /ranking/fora {aparelho, fora: true|false} — não aparecer (ou voltar a aparecer) no ranking
export async function sairDoRanking(req, env, origin, h) {
  let b; try { b = JSON.parse(await req.text()); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!b || !idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (b.fora) await env.DB.prepare('INSERT INTO ranking_fora (aparelho, em) VALUES (?, ?) ON CONFLICT (aparelho) DO NOTHING').bind(b.aparelho, Date.now()).run();
  else await env.DB.prepare('DELETE FROM ranking_fora WHERE aparelho = ?').bind(b.aparelho).run();
  REI.em = 0;   // quem saiu (ou voltou) pode mudar quem é o Rei
  return h.json({ ok: true, fora: !!b.fora }, 200, origin);
}
// No agendado: o ranking guarda no máximo 13 meses; as contas do dia (robôs e pares), 2 dias
export async function limparRanking(env) {
  await env.DB.prepare('DELETE FROM ranking WHERE atualizado < ?').bind(Date.now() - 400 * DIA).run();
  await env.DB.prepare('DELETE FROM calcada WHERE atualizado < ?').bind(Date.now() - 400 * DIA).run();
  const velho = diaManaus(Date.now() - 2 * DIA);
  await env.DB.prepare('DELETE FROM calcada_robo WHERE dia < ?').bind(velho).run();
  await env.DB.prepare('DELETE FROM calcada_par WHERE dia < ?').bind(velho).run();
}
