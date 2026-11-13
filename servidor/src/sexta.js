// 13/11 (pedido do dono): Placar da Sexta. Das 20h às 23h de sexta (Manaus), cada partida online inteira conta para quem
// jogou: partidas, vitórias e galos. Quem conta é o servidor (não dá para inventar do celular). Menor de 18 não aparece.
// O placar fica na Calçada durante a Sexta e, com o resultado, no sábado.
const MANAUS = 4 * 3600000, DIA = 86400000;
const manaus = t => new Date(t - MANAUS);
const diaM = t => manaus(t).toISOString().slice(0, 10);
export function sextaAgora(t) { const d = manaus(t || Date.now()), h = d.getUTCHours(); return d.getUTCDay() === 5 && h >= 20 && h < 23; }
// SEXTA_TESTE = '1' liga a Sexta agora (só no teste local)
export const sextaValendo = env => (env && env.SEXTA_TESTE === '1') || sextaAgora(Number(env && env.COPA_AGORA) || Date.now());
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));

// fim de partida online na Sexta: soma para cada um que jogou a partida inteira (quem: quemContaNoRanking; galos por cadeira)
export async function anotarSexta(env, m, quem) {
  const dia = diaM(Date.now()), agora = Date.now();
  for (const q of quem || []) {
    if (!idOk(q.id) || q.menor) continue;
    const p = (m.cad || []).findIndex(c => c && c.id === q.id), g = p >= 0 && m.sxG ? Math.min(6, m.sxG[p] || 0) : 0;
    try {
      await env.DB.prepare(`INSERT INTO sexta_placar (dia, aparelho, nome, partidas, vitorias, galos, em) VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT (dia, aparelho) DO UPDATE SET nome = excluded.nome, partidas = partidas + 1, vitorias = vitorias + excluded.vitorias, galos = galos + excluded.galos, em = excluded.em`)
        .bind(dia, q.id, String(q.nome || '').slice(0, 24), q.ganhou ? 1 : 0, g, agora).run();
    } catch (e) {}
  }
}
// GET /sexta/placar?id=&dia=: na Sexta, o de hoje (ao vivo); no sábado, o de ontem; nos outros dias, nada (a não ser com dia=)
export async function sextaPlacar(env, url, h, origin) {
  const agora = Date.now(), d = manaus(agora), ws = d.getUTCDay(), hr = d.getUTCHours();
  let dia = null, aoVivo = false;
  const pedido = url.searchParams.get('dia') || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(pedido)) dia = pedido;
  else if (env.SEXTA_TESTE === '1') { dia = diaM(agora); aoVivo = true; }
  else if (ws === 5 && hr >= 20) { dia = diaM(agora); aoVivo = hr < 23; }
  else if (ws === 6) dia = diaM(agora - DIA);
  if (!dia) return h.json({ dia: null }, 200, origin);
  let top = [], eu = null;
  try {
    top = (await env.DB.prepare('SELECT aparelho, nome, partidas, vitorias, galos FROM sexta_placar WHERE dia = ? AND vitorias > 0 ORDER BY vitorias DESC, galos DESC, partidas ASC, em ASC LIMIT 10').bind(dia).all()).results || [];
    const id = url.searchParams.get('id') || '';
    if (idOk(id)) {
      const r = await env.DB.prepare('SELECT nome, partidas, vitorias, galos, em FROM sexta_placar WHERE dia = ? AND aparelho = ?').bind(dia, id).first();
      if (r && r.vitorias > 0) {
        const acima = await env.DB.prepare('SELECT COUNT(*) AS n FROM sexta_placar WHERE dia = ? AND vitorias > 0 AND (vitorias > ? OR (vitorias = ? AND (galos > ? OR (galos = ? AND (partidas < ? OR (partidas = ? AND em < ?))))))')
          .bind(dia, r.vitorias, r.vitorias, r.galos, r.galos, r.partidas, r.partidas, r.em).first();
        eu = { pos: ((acima && acima.n) || 0) + 1, vitorias: r.vitorias, galos: r.galos, partidas: r.partidas };
      }
    }
  } catch (e) {}
  return h.json({ dia, aoVivo, top: top.map(x => ({ nome: x.nome, vitorias: x.vitorias, galos: x.galos, partidas: x.partidas })), eu }, 200, origin);
}
