// 12/11 (pedido do dono: trazer mais gente sem tirar valor do sócio, e sem prêmios por enquanto)
// QUARTA DOS AMIGOS — toda quarta, das 20h às 23h (horário de Manaus):
//   - quem senta numa mesa com os amigos de um SÓCIO joga sem limite (mesmo sem plano). As partidas desse horário na mesa
//     do sócio não gastam as partidas grátis do dia. É o sócio que abre a mesa para a turma: o benefício é dele.
//   - na mesa de quem não é sócio, vale o limite de sempre (quem chega novo tem as partidas grátis dele).
//   - o sócio ganha moral em dobro nas mesas com os amigos (a conta da moral é do app).
//   - aviso no celular às 12h e às 20h, quando começa (um texto para o sócio e outro para quem não é). 13/11: antes era às 18h.
//   - 13/11: Duplas da Quarta: as duplas de parceiros que mais venceram juntas nas mesas com os amigos (ver no fim).
// CONVITE (sem prêmio, só para medir): quem abre o app pela 1ª vez pelo link de uma mesa e entra nela fica anotado. O painel
// do dono mostra quantos amigos novos chegaram (e quantos na Quarta), quantos voltaram em outro dia e quantos viraram sócio.
const MANAUS = 4 * 3600000, DIA = 86400000;
export const QUARTA_HORA = { inicio: 20, fim: 23 };
export function quartaAgora(agora) {
  const d = new Date((agora || Date.now()) - MANAUS), h = d.getUTCHours();
  return d.getUTCDay() === 3 && h >= QUARTA_HORA.inicio && h < QUARTA_HORA.fim;
}
// COPA_AGORA muda a hora (testes); QUARTA_TESTE = '1' liga a Quarta agora (só no teste local)
export const quartaValendo = env => (env && env.QUARTA_TESTE === '1') || quartaAgora(Number(env && env.COPA_AGORA) || Date.now());
const diaManaus = t => new Date(t - MANAUS).toISOString().slice(0, 10);
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));

// uma partida jogada sem limite na mesa de um sócio, por quem não é sócio (para o painel)
export async function contarQuarta(env, aparelho) {
  if (!idOk(aparelho)) return;
  try { await env.DB.prepare('INSERT INTO quarta_jog (dia, aparelho, n) VALUES (?, ?, 1) ON CONFLICT (dia, aparelho) DO UPDATE SET n = n + 1').bind(diaManaus(Date.now()), aparelho).run(); } catch (e) {}
}
// chegou pelo link da mesa (1ª vez no app) e entrou: anota uma vez por aparelho, se o aparelho é novo de verdade
export async function anotarConvite(env, aparelho, anfitriao, socioAnfitriao, quarta, mesa) {
  if (!idOk(aparelho) || aparelho === anfitriao) return;
  try {
    const a = await env.DB.prepare('SELECT desde FROM aparelhos WHERE aparelho = ?').bind(aparelho).first();
    if (a && a.desde && a.desde < Date.now() - DIA) return;   // já jogava antes: não é amigo novo
    await env.DB.prepare('INSERT OR IGNORE INTO convites (aparelho, anfitriao, socio_anfitriao, quarta, mesa, em) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(aparelho, idOk(anfitriao) ? anfitriao : null, socioAnfitriao ? 1 : 0, quarta ? 1 : 0, String(mesa || '').slice(0, 8), Date.now()).run();
  } catch (e) {}
}

// GET /dono/quarta: as últimas Quartas e os convites dos últimos 30 dias (só números, sem nomes)
export async function donoQuarta(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const agora = Date.now();
  const tudo = async (q, ...a) => { try { const { results } = await env.DB.prepare(q).bind(...a).all(); return results || []; } catch (e) { return []; } };
  const quartas = await tudo('SELECT dia, COUNT(*) AS pessoas, SUM(n) AS partidas FROM quarta_jog GROUP BY dia ORDER BY dia DESC LIMIT 6');
  const conv = await tudo(`SELECT c.aparelho, c.em, c.quarta, c.socio_anfitriao,
      (SELECT visto_em FROM jogadores_vistos v WHERE v.aparelho = c.aparelho) AS v1,
      (SELECT visto_em FROM presenca p WHERE p.aparelho = c.aparelho) AS v2,
      (SELECT MAX(atualizado) FROM ranking r WHERE r.aparelho = c.aparelho) AS v3,
      (SELECT 1 FROM planos x WHERE x.aparelho = c.aparelho AND x.ate > 0 AND x.desde >= c.em) AS socio,
      (SELECT 1 FROM pedidos d WHERE d.aparelho = c.aparelho AND d.status = 'pago' AND d.pago_em >= c.em) AS pagou
    FROM convites c WHERE c.em > ? ORDER BY c.em DESC LIMIT 2000`, agora - 30 * DIA);
  // voltou: apareceu de novo a partir do dia seguinte (de Manaus) ao da chegada
  const amanha = t => Date.parse(diaManaus(t) + 'T00:00:00Z') + MANAUS + DIA;
  const voltou = c => Math.max(Number(c.v1) || 0, Number(c.v2) || 0, Number(c.v3) || 0) >= amanha(c.em);
  const resumo = l => ({ novos: l.length, voltaram: l.filter(voltou).length, socios: l.filter(c => c.socio || c.pagou).length });
  const porDia = {};
  for (const c of conv.filter(c => c.quarta)) (porDia[diaManaus(c.em)] = porDia[diaManaus(c.em)] || []).push(c);
  return h.json({
    agora: quartaValendo(env),
    quartas: [...new Set([...quartas.map(q => q.dia), ...Object.keys(porDia)])].sort().reverse().slice(0, 6).map(dia => {
      const q = quartas.find(x => x.dia === dia) || {};
      return Object.assign({ dia, pessoas: q.pessoas || 0, partidas: q.partidas || 0 }, resumo(porDia[dia] || []));
    }),
    convites: Object.assign(resumo(conv), { naQuarta: conv.filter(c => c.quarta).length, deSocio: conv.filter(c => c.socio_anfitriao).length })
  }, 200, origin);
}

// ---- 13/11 (pedido do dono): Duplas da Quarta. Das 20h às 23h de quarta, nas mesas com os amigos (não a rápida), cada
// partida inteira conta para a dupla de parceiros (cadeiras 0 e 2, 1 e 3) quando os dois são pessoas que jogaram a partida
// toda. Quem conta é o servidor. Dupla com menor de 18 não aparece. O placar fica na Calçada na Quarta e, com o resultado, na quinta.
export async function anotarQuarta(env, m, quem) {
  if (!m || m.publica) return;
  const dia = diaManaus(Date.now()), agora = Date.now(), por = {};
  for (const q of quem || []) if (idOk(q.id)) por[q.id] = q;
  for (const p of [0, 1]) {
    const a = m.cad && m.cad[p], b = m.cad && m.cad[p + 2];
    const qa = a && por[a.id], qb = b && por[b.id];
    if (!qa || !qb || qa.id === qb.id || qa.menor || qb.menor) continue;
    const [x, y] = [qa, qb].sort((u, v) => (u.id < v.id ? -1 : 1));
    const g = m.sxG ? Math.min(6, (m.sxG[p] || 0) + (m.sxG[p + 2] || 0)) : 0;
    try {
      await env.DB.prepare(`INSERT INTO quarta_duplas (dia, chave, a, b, nome_a, nome_b, partidas, vitorias, galos, em) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT (dia, chave) DO UPDATE SET nome_a = excluded.nome_a, nome_b = excluded.nome_b, partidas = partidas + 1, vitorias = vitorias + excluded.vitorias, galos = galos + excluded.galos, em = excluded.em`)
        .bind(dia, x.id + '|' + y.id, x.id, y.id, String(x.nome || '').slice(0, 24), String(y.nome || '').slice(0, 24), qa.ganhou ? 1 : 0, g, agora).run();
    } catch (e) {}
  }
}
// GET /quarta/placar?id=&dia=: na Quarta, o de hoje (ao vivo); na quinta, o de ontem; nos outros dias, nada (a não ser com dia=)
export async function quartaPlacar(env, url, h, origin) {
  const agora = Number(env && env.COPA_AGORA) || Date.now(), d = new Date(agora - MANAUS), ws = d.getUTCDay(), hr = d.getUTCHours();
  let dia = null, aoVivo = false;
  const pedido = url.searchParams.get('dia') || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(pedido)) dia = pedido;
  else if (env.QUARTA_TESTE === '1') { dia = diaManaus(Date.now()); aoVivo = true; }
  else if (ws === 3 && hr >= QUARTA_HORA.inicio) { dia = diaManaus(agora); aoVivo = hr < QUARTA_HORA.fim; }
  else if (ws === 4) dia = diaManaus(agora - DIA);
  if (!dia) return h.json({ dia: null }, 200, origin);
  let top = [], eu = null;
  try {
    top = (await env.DB.prepare('SELECT a, b, nome_a, nome_b, partidas, vitorias, galos FROM quarta_duplas WHERE dia = ? AND vitorias > 0 ORDER BY vitorias DESC, galos DESC, partidas ASC, em ASC LIMIT 10').bind(dia).all()).results || [];
    const id = url.searchParams.get('id') || '';
    if (idOk(id)) {
      const r = await env.DB.prepare('SELECT nome_a, nome_b, a, partidas, vitorias, galos, em FROM quarta_duplas WHERE dia = ? AND (a = ? OR b = ?) AND vitorias > 0 ORDER BY vitorias DESC, galos DESC, partidas ASC, em ASC LIMIT 1').bind(dia, id, id).first();
      if (r) {
        const acima = await env.DB.prepare('SELECT COUNT(*) AS n FROM quarta_duplas WHERE dia = ? AND vitorias > 0 AND (vitorias > ? OR (vitorias = ? AND (galos > ? OR (galos = ? AND (partidas < ? OR (partidas = ? AND em < ?))))))')
          .bind(dia, r.vitorias, r.vitorias, r.galos, r.galos, r.partidas, r.partidas, r.em).first();
        eu = { pos: ((acima && acima.n) || 0) + 1, parceiro: r.a === id ? r.nome_b : r.nome_a, vitorias: r.vitorias, galos: r.galos, partidas: r.partidas };
      }
    }
    const meu = idOk(id) ? id : '';
    top = top.map(x => ({ nomes: [x.nome_a, x.nome_b], vitorias: x.vitorias, galos: x.galos, partidas: x.partidas, eu: !!meu && (x.a === meu || x.b === meu) }));
  } catch (e) { top = []; }
  return h.json({ dia, aoVivo, top, eu }, 200, origin);
}
