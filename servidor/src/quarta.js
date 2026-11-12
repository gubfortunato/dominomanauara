// 12/11 (pedido do dono: trazer mais gente sem tirar valor do sócio, e sem prêmios por enquanto)
// QUARTA DOS AMIGOS — toda quarta, das 20h às 23h (horário de Manaus):
//   - quem senta numa mesa com os amigos de um SÓCIO joga sem limite (mesmo sem plano). As partidas desse horário na mesa
//     do sócio não gastam as partidas grátis do dia. É o sócio que abre a mesa para a turma: o benefício é dele.
//   - na mesa de quem não é sócio, vale o limite de sempre (quem chega novo tem as partidas grátis dele).
//   - o sócio ganha moral em dobro nas mesas com os amigos (a conta da moral é do app).
//   - aviso no celular às 18h (um texto para o sócio e outro para quem não é; o que sobrar sai às 19h).
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
