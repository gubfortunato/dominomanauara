// 17/11 (pedido do dono): Segunda é de Lei. Das 19h às 22h de segunda (Manaus), cada partida online inteira conta para quem
// jogou: partidas, vitórias e galos, como no Placar da Sexta. Quem conta é o servidor (não dá para inventar do celular).
// Menor de 18 não aparece. O Placar da Segunda fica na Calçada durante a Segunda e, com o resultado, na terça.
const MANAUS = 4 * 3600000, DIA = 86400000;
const manaus = t => new Date(t - MANAUS);
const diaM = t => manaus(t).toISOString().slice(0, 10);
export function segundaAgora(t) { const d = manaus(t || Date.now()), h = d.getUTCHours(); return d.getUTCDay() === 1 && h >= 19 && h < 22; }
// SEGUNDA_TESTE = '1' liga a Segunda agora (só no teste local)
export const segundaValendo = env => (env && env.SEGUNDA_TESTE === '1') || segundaAgora(Number(env && env.COPA_AGORA) || Date.now());
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));

// fim de partida online na Segunda: soma para cada um que jogou a partida inteira (quem: quemContaNoRanking; galos por cadeira)
export async function anotarSegunda(env, m, quem) {
  const dia = diaM(Date.now()), agora = Date.now();
  for (const q of quem || []) {
    if (!idOk(q.id) || q.menor) continue;
    const p = (m.cad || []).findIndex(c => c && c.id === q.id), g = p >= 0 && m.sxG ? Math.min(6, m.sxG[p] || 0) : 0;
    try {
      await env.DB.prepare(`INSERT INTO segunda_placar (dia, aparelho, nome, partidas, vitorias, galos, em) VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT (dia, aparelho) DO UPDATE SET nome = excluded.nome, partidas = partidas + 1, vitorias = vitorias + excluded.vitorias, galos = galos + excluded.galos, em = excluded.em`)
        .bind(dia, q.id, String(q.nome || '').slice(0, 24), q.ganhou ? 1 : 0, g, agora).run();
    } catch (e) {}
  }
}
// GET /segunda/placar?id=: na Segunda (das 19h), o de hoje (ao vivo até as 22h); na terça, o de ontem; nos outros dias, nada
export async function segundaPlacar(env, url, h, origin) {
  const agora = Date.now(), d = manaus(agora), ws = d.getUTCDay(), hr = d.getUTCHours();
  let dia = null, aoVivo = false;
  if (env.SEGUNDA_TESTE === '1') { dia = diaM(agora); aoVivo = true; }
  else if (ws === 1 && hr >= 19) { dia = diaM(agora); aoVivo = hr < 22; }
  else if (ws === 2) dia = diaM(agora - DIA);
  if (!dia) return h.json({ dia: null }, 200, origin);
  let top = [], eu = null;
  try {
    top = (await env.DB.prepare('SELECT aparelho, nome, partidas, vitorias, galos FROM segunda_placar WHERE dia = ? AND vitorias > 0 ORDER BY vitorias DESC, galos DESC, partidas ASC, em ASC LIMIT 10').bind(dia).all()).results || [];
    const id = url.searchParams.get('id') || '';
    if (idOk(id)) {
      const r = await env.DB.prepare('SELECT nome, partidas, vitorias, galos, em FROM segunda_placar WHERE dia = ? AND aparelho = ?').bind(dia, id).first();
      if (r && r.vitorias > 0) {
        const acima = await env.DB.prepare('SELECT COUNT(*) AS n FROM segunda_placar WHERE dia = ? AND vitorias > 0 AND (vitorias > ? OR (vitorias = ? AND (galos > ? OR (galos = ? AND (partidas < ? OR (partidas = ? AND em < ?))))))')
          .bind(dia, r.vitorias, r.vitorias, r.galos, r.galos, r.partidas, r.partidas, r.em).first();
        eu = { pos: ((acima && acima.n) || 0) + 1, vitorias: r.vitorias, galos: r.galos, partidas: r.partidas };
      }
    }
  } catch (e) {}
  return h.json({ dia, aoVivo, top: top.map(x => ({ nome: x.nome, vitorias: x.vitorias, galos: x.galos, partidas: x.partidas })), eu }, 200, origin);
}
