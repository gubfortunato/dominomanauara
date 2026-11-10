// 10/11 (pedido do dono: "dar sensação de pertencimento para os sócios", tudo automático)
//
// COPA DOS SÓCIOS — a cada 3 meses (o dono escolheu: todo mês ficaria banal), no último fim de semana de novembro,
// fevereiro, maio e agosto: de sexta às 20h até domingo às 22h (horário de Manaus). A 1ª é de 27 a 29/11/2026.
//   - só sócios pontuam (as mesmas regras de pontos do ranking: +3 contra pessoas, +1 contra a turma do bairro até 3 por
//     dia, -1 na derrota contra pessoas, até 5 partidas por dia contra a mesma pessoa). Quem não é sócio vê e é convidado.
//   - na segunda de manhã o servidor apura sozinho: troféu (1º), medalhas (2º e 3º) e marca de participação (quem jogou)
//     ficam guardados na conta de sócio (o código do plano: vão junto para outro celular) e aparecem na carteira.
//   - o campeão ganha a mesa do campeão até o fim da Copa seguinte (só ele escolhe; na mesa online, todos jogam nela).
//
// TEMPO DE CASA — "sócio há 3 meses": a contagem é da conta de sócio (o código). Se o plano vencer e passar 7 dias sem
// renovar, recomeça do zero (o dono escolheu). Marcas aos 3, 6 e 12 meses; quando chega uma, vai um aviso para o celular.
//
// SEXTA DA CALÇADA — toda sexta, das 20h às 23h: XP em dobro (no app) e aviso às 19h e às 20h.
import { ordenados, lista, periodos } from './ranking.js';

const MANAUS = 4 * 3600000, DIA = 86400000;
export const COPA_HORA = { inicio: 20, fim: 22 };
export const SEXTA_HORA = { inicio: 20, fim: 23 };
export const CASA_TOLERANCIA = 7 * DIA;
export const CASA_MARCAS = [3, 6, 12];
const agoraDe = env => Number(env && env.COPA_AGORA) || Date.now();   // COPA_AGORA: só nos testes

// sexta do último fim de semana do mês (o domingo ainda dentro do mês); mes de 1 a 12
function sextaDoMes(ano, mes) {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  for (let d = ultimo; d > 0; d--) if (new Date(Date.UTC(ano, mes - 1, d)).getUTCDay() === 0) return d - 2;
  return ultimo - 2;
}
// edição n (1 = novembro de 2026; depois, de 3 em 3 meses)
export function edicao(n) {
  const t = 2026 * 12 + 10 + (n - 1) * 3, ano = Math.floor(t / 12), mes = t % 12 + 1, sexta = sextaDoMes(ano, mes);
  return { n, id: `C${ano}-${String(mes).padStart(2, '0')}`, nome: `${n}ª Copa dos Sócios`,
    inicio: Date.UTC(ano, mes - 1, sexta, COPA_HORA.inicio) + MANAUS, fim: Date.UTC(ano, mes - 1, sexta + 2, COPA_HORA.fim) + MANAUS };
}
// a que está rolando ou a próxima (atual), e a última que já acabou (anterior)
export function copaAgora(agora) {
  let n = 1; while (edicao(n).fim <= agora) n++;
  const atual = edicao(n);
  return { atual, anterior: n > 1 ? edicao(n - 1) : null, ativa: agora >= atual.inicio && agora < atual.fim };
}
const pub = e => e && { n: e.n, nome: e.nome, inicio: e.inicio, fim: e.fim };

// ---- pontos: chamado pelo ranking no fim de cada partida online (delta já calculado com as regras do ranking) ----
export async function somarCopa(env, q, delta, gente, agora) {
  const c = copaAgora(agora);
  if (!c.ativa) return;
  const p = await env.DB.prepare('SELECT ate FROM planos WHERE aparelho = ?').bind(q.id).first();
  if (!(p && p.ate > agora)) return;   // só sócio pontua
  const nome = String(q.nome || 'Jogador').slice(0, 16), nv = Math.max(1, Math.min(50, Number(q.nv) || 1));
  await env.DB.prepare(`INSERT INTO calcada (periodo, aparelho, nome, av, nv, pontos, ganhas, jogadas, ganhas_gente, jogadas_gente, atualizado)
      VALUES (?, ?, ?, ?, ?, MAX(0, ?), ?, 1, ?, ?, ?)
      ON CONFLICT (periodo, aparelho) DO UPDATE SET nome = excluded.nome, av = excluded.av, nv = excluded.nv, pontos = MAX(0, pontos + ?),
      ganhas = ganhas + excluded.ganhas, jogadas = jogadas + 1, ganhas_gente = ganhas_gente + excluded.ganhas_gente,
      jogadas_gente = jogadas_gente + excluded.jogadas_gente, atualizado = CASE WHEN ? != 0 THEN excluded.atualizado ELSE atualizado END`)
    .bind(c.atual.id, q.id, nome, q.av || null, nv, delta, q.ganhou ? 1 : 0, gente && q.ganhou ? 1 : 0, gente ? 1 : 0, agora, delta, delta).run();
}

// ---- apuração (rotina agendada): na primeira passada depois do fim ----
export async function apurarCopa(env, agora) {
  agora = agora || agoraDe(env);
  const { anterior } = copaAgora(agora);
  if (!anterior || agora < anterior.fim) return null;
  const ja = await env.DB.prepare('SELECT 1 AS x FROM copa_premios WHERE edicao = ? LIMIT 1').bind(anterior.id).first();
  if (ja) return null;
  const podio = (await ordenados(env, anterior.id)).slice(0, 3);
  const { results } = await env.DB.prepare('SELECT aparelho, nome, pontos FROM calcada WHERE periodo = ? AND jogadas > 0').bind(anterior.id).all();
  const todos = results || [];
  const pos = new Map(podio.map((x, i) => [x.aparelho, i + 1]));
  const codigo = async ap => { try { const r = await env.DB.prepare('SELECT codigo FROM planos WHERE aparelho = ?').bind(ap).first(); return r && r.codigo || null; } catch (e) { return null; } };
  for (const x of todos) {
    await env.DB.prepare('INSERT OR IGNORE INTO copa_premios (edicao, n, aparelho, codigo, nome, pos, pontos, em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(anterior.id, anterior.n, x.aparelho, await codigo(x.aparelho), x.nome, pos.get(x.aparelho) || 0, x.pontos || 0, agora).run();
  }
  // ninguém jogou: fica a marca de "apurada" para não conferir de novo
  if (!todos.length) await env.DB.prepare("INSERT OR IGNORE INTO copa_premios (edicao, n, aparelho, codigo, nome, pos, pontos, em) VALUES (?, ?, '-', NULL, '', -1, 0, ?)").bind(anterior.id, anterior.n, agora).run();
  return { edicao: anterior.id, podio: podio.map(x => x.aparelho), participantes: todos.length };
}
// o pódio já apurado de uma edição: [{pos, aparelho, codigo, nome, av}]
async function podioDe(env, ed) {
  const { results } = await env.DB.prepare('SELECT p.pos, p.aparelho, p.codigo, p.nome, c.av FROM copa_premios p LEFT JOIN calcada c ON c.periodo = p.edicao AND c.aparelho = p.aparelho WHERE p.edicao = ? AND p.pos BETWEEN 1 AND 3 ORDER BY p.pos').bind(ed.id).all();
  return results || [];
}
// os prêmios da conta (código do plano; sem código, o aparelho): [{n, pos}] (pos 0 = participou)
export async function premiosDe(env, aparelho, codigo) {
  try {
    // dois aparelhos da mesma conta podem ter jogado: vale o melhor lugar (o menor pos > 0; 0 = só participou)
    const { results } = await env.DB.prepare('SELECT n, MIN(CASE WHEN pos > 0 THEN pos ELSE 99 END) AS m FROM copa_premios WHERE pos >= 0 AND (aparelho = ? OR (codigo IS NOT NULL AND codigo = ?)) GROUP BY n ORDER BY n DESC')
      .bind(aparelho, codigo || '#').all();
    return (results || []).map(r => ({ n: r.n, pos: r.m === 99 ? 0 : r.m }));
  } catch (e) { return []; }
}
// o campeão da última Copa usa a mesa do campeão até o fim da Copa seguinte: -> até quando (ou 0)
export async function campeaoAte(env, aparelho, agora) {
  agora = agora || agoraDe(env);
  const { atual, anterior } = copaAgora(agora);
  if (!anterior || !aparelho) return 0;
  try {
    const r = await env.DB.prepare(`SELECT 1 AS x FROM copa_premios WHERE edicao = ? AND pos = 1 AND (aparelho = ? OR codigo = (SELECT codigo FROM planos WHERE aparelho = ?))`)
      .bind(anterior.id, aparelho, aparelho).first();
    return r ? atual.fim : 0;
  } catch (e) { return 0; }
}

// GET /copa?aparelho= -> a Copa de agora (ou a próxima), a lista e o campeão da última
export async function copaInfo(req, env, origin, h, url) {
  const agora = agoraDe(env), c = copaAgora(agora);
  const ap = /^[a-z0-9-]{8,40}$/i.test(String(url.searchParams.get('aparelho') || '')) ? url.searchParams.get('aparelho') : null;
  const fase = c.ativa ? 'agora' : (c.anterior && agora - c.anterior.fim < 7 * DIA) ? 'depois' : (c.atual.inicio - agora < 8 * DIA) ? 'antes' : 'longe';   // desde a quinta à noite, uma semana antes
  const ed = fase === 'depois' ? c.anterior : c.atual;
  let tab = { top: [], eu: null };
  if (fase === 'agora' || fase === 'depois') { try { tab = await lista(env, ed.id, ed.fim, ap, null); } catch (e) {} }
  let campeao = null;
  if (c.anterior) {
    try {
      const p = await podioDe(env, c.anterior);
      campeao = p.length ? { n: c.anterior.n, nome: p[0].nome, av: p[0].av || null, eu: !!ap && p[0].aparelho === ap,
        podio: p.map(x => ({ pos: x.pos, nome: x.nome, av: x.av || null, eu: !!ap && x.aparelho === ap })) } : null;
    } catch (e) {}
  }
  let socio = false; if (ap) { try { const p = await env.DB.prepare('SELECT ate FROM planos WHERE aparelho = ?').bind(ap).first(); socio = !!(p && p.ate > agora); } catch (e) {} }
  return h.json({ fase, edicao: pub(ed), proxima: pub(c.atual), anterior: pub(c.anterior), top: (tab.top || []).slice(0, 10), eu: tab.eu || null, campeao, socio,
    horas: COPA_HORA }, 200, origin);
}

// ---- tempo de casa ----
// Chamado quando o plano liga ou soma tempo (pagamento, presente, cortesia). ateAntes: até quando valia antes.
export async function casaAoLigar(env, aparelho, ateAntes, agora) {
  agora = agora || Date.now();
  try {
    const p = await env.DB.prepare('SELECT codigo FROM planos WHERE aparelho = ?').bind(aparelho).first();
    if (!p || !p.codigo) return;
    if (!ateAntes || ateAntes < agora - CASA_TOLERANCIA) {
      await env.DB.prepare('INSERT INTO socio_casa (codigo, desde) VALUES (?, ?) ON CONFLICT (codigo) DO UPDATE SET desde = excluded.desde').bind(p.codigo, agora).run();
    } else {
      const m = await env.DB.prepare('SELECT MIN(desde) AS d FROM planos WHERE codigo = ? AND ate > 0').bind(p.codigo).first();
      await env.DB.prepare('INSERT OR IGNORE INTO socio_casa (codigo, desde) VALUES (?, ?)').bind(p.codigo, (m && m.d) || agora).run();
    }
  } catch (e) {}
}
export async function casaDe(env, codigo, desdePadrao) {
  try { const r = await env.DB.prepare('SELECT desde FROM socio_casa WHERE codigo = ?').bind(codigo).first(); return (r && r.desde) || desdePadrao || null; }
  catch (e) { return desdePadrao || null; }
}
// "n meses depois" no calendário (dia 31 vira o último dia do mês)
export function somaMeses(ms, n) {
  const d = new Date(ms - MANAUS), dia = d.getUTCDate();
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes()));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimo));
  return alvo.getTime() + MANAUS;
}
// sócios que chegaram numa marca nos últimos 3 dias e ainda não receberam o aviso: [{aparelho, codigo, marca}]
export async function marcasNovas(env, agora) {
  agora = agora || Date.now();
  const { results } = await env.DB.prepare(`SELECT p.aparelho, p.codigo, COALESCE(c.desde, (SELECT MIN(desde) FROM planos q WHERE q.codigo = p.codigo AND q.ate > 0)) AS casa
    FROM planos p LEFT JOIN socio_casa c ON c.codigo = p.codigo WHERE p.ate > ? AND p.codigo IS NOT NULL`).bind(agora).all();
  const novas = [];
  for (const r of results || []) {
    if (!r.casa) continue;
    for (const m of CASA_MARCAS) {
      const quando = somaMeses(r.casa, m);
      if (quando <= agora && quando > agora - 3 * DIA) novas.push({ aparelho: r.aparelho, codigo: r.codigo, marca: m });
    }
  }
  const fora = [];
  for (const n of novas) {
    const ja = await env.DB.prepare('SELECT 1 AS x FROM socio_marcas WHERE codigo = ? AND marca = ?').bind(n.codigo, n.marca).first();
    if (!ja) fora.push(n);
  }
  return fora;
}

// ---- Sexta da Calçada ----
export function sextaAgora(agora) {
  const d = new Date(agora - MANAUS), h = d.getUTCHours();
  return d.getUTCDay() === 5 && h >= SEXTA_HORA.inicio && h < SEXTA_HORA.fim;
}

// ---- Avisos automáticos do dia (rotina agendada): o que sai agora, para quem ----
// -> [{ chave, msg, para: 'todos' | 'socios' | {aparelhos: [...]}, caixa: bool }]
const hm = ms => { const d = new Date(ms - MANAUS); return { dia: d.toISOString().slice(0, 10), sem: d.getUTCDay(), h: d.getUTCHours() }; };
const ddmm = ms => { const d = new Date(ms - MANAUS); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
export const TEXTOS = {
  vemAi: e => ({ titulo: `Vem aí a ${e.nome}! 🏆`, texto: `De ${ddmm(e.inicio)} (sexta, 20h) a ${ddmm(e.fim)} (domingo, 22h). Só sócios pontuam: o campeão leva o troféu na carteira e a mesa do campeão.`, url: '/?abrir=copa' }),
  sexta19: { titulo: 'Hoje tem Sexta da Calçada! 🎲', texto: 'Das 20h às 23h, XP em dobro em todas as partidas. Chama a turma e bora pra mesa!', url: '/' },
  sexta20: { titulo: 'Começou a Sexta da Calçada!', texto: 'XP em dobro até as 23h. A calçada tá cheia: bora pra mesa?', url: '/' },
  copa19: e => ({ titulo: `A ${e.nome} começa em 1 hora! 🏆`, texto: 'Às 20h começa a Copa e a Sexta da Calçada, com XP em dobro. Só sócios pontuam na Copa.', url: '/?abrir=copa' }),
  copa20: e => ({ titulo: `Começou a ${e.nome}! 🏆`, texto: `Vai até domingo, 22h. Cada vitória online conta ponto para os sócios. E hoje tem XP em dobro até as 23h.`, url: '/?abrir=copa' }),
  ultimas: e => ({ titulo: `Últimas horas da ${e.nome}!`, texto: 'A Copa termina hoje às 22h. Ainda dá tempo de subir no ranking: bora pra mesa!', url: '/?abrir=copa' }),
  campeaoTodos: e => ({ titulo: `Temos campeão da ${e.nome}! 🏆`, texto: 'Veja quem levou o troféu. A próxima Copa já tem data: seja sócio e venha disputar.', url: '/?abrir=copa' }),
  campeaoEu: e => ({ titulo: 'Você é o campeão da Copa dos Sócios! 🏆', texto: `O troféu da ${e.nome} já está na sua carteira, e a mesa do campeão é sua até a próxima Copa.`, url: '/?abrir=copa' }),
  podioEu: (e, pos) => ({ titulo: `${pos}º lugar na ${e.nome}! ${pos === 2 ? '🥈' : '🥉'}`, texto: 'A sua medalha já está na carteira de sócio. Parabéns! Na próxima, o troféu pode ser seu.', url: '/?abrir=copa' }),
  casa: m => ({ titulo: m === 12 ? '1 ano de sócio! 🥇' : `${m} meses de sócio! ${m === 3 ? '🥉' : '🥈'}`, texto: `Sua carteira de sócio ganhou a marca de ${m === 12 ? '1 ano' : m + ' meses'}. Obrigado por manter a calçada viva!`, url: '/?abrir=carteira' })
};
export async function avisosAgendados(env, agora) {
  agora = agora || agoraDe(env);
  const t = hm(agora), c = copaAgora(agora), out = [];
  const diaDe = ms => hm(ms).dia;
  // sexta: 19h e 20h (no dia da Copa, o texto junta as duas)
  if (t.sem === 5 && (t.h === 19 || t.h === 20)) {
    const copaHoje = diaDe(c.atual.inicio) === t.dia;
    if (t.h === 19) out.push({ chave: `sx:${t.dia}:19`, msg: copaHoje ? TEXTOS.copa19(c.atual) : TEXTOS.sexta19, para: 'todos', caixa: copaHoje });
    else out.push({ chave: `sx:${t.dia}:20`, msg: copaHoje ? TEXTOS.copa20(c.atual) : TEXTOS.sexta20, para: 'todos', caixa: copaHoje });
  }
  // uma semana antes da Copa (de manhã)
  if (t.h >= 9 && t.h < 12 && diaDe(c.atual.inicio - 7 * DIA) === t.dia) out.push({ chave: `cp:${c.atual.id}:vem`, msg: TEXTOS.vemAi(c.atual), para: 'todos', caixa: true });
  // domingo da Copa, 18h e 19h: últimas horas (só para os sócios)
  if (c.ativa && t.sem === 0 && t.h >= 18 && t.h < 20) out.push({ chave: `cp:${c.atual.id}:fim`, msg: TEXTOS.ultimas(c.atual), para: 'socios', caixa: false });
  // depois da apuração (de manhã, até 2 dias depois do fim): o pódio recebe o dele; todo mundo, o "temos campeão"
  if (c.anterior && agora - c.anterior.fim < 2 * DIA && t.h >= 9 && t.h < 12) {
    const p = await podioDe(env, c.anterior);
    if (p.length) {
      for (const x of p) out.push({ chave: `cp:${c.anterior.id}:pos${x.pos}`, msg: x.pos === 1 ? TEXTOS.campeaoEu(c.anterior) : TEXTOS.podioEu(c.anterior, x.pos), para: { aparelhos: [x.aparelho] }, caixa: false });
      out.push({ chave: `cp:${c.anterior.id}:campeao`, msg: TEXTOS.campeaoTodos(c.anterior), para: 'todos', caixa: true, menos: p.map(x => x.aparelho) });
    }
  }
  // tempo de casa (de manhã): quem chegou numa marca
  if (t.h >= 9 && t.h < 12) {
    try { for (const n of await marcasNovas(env, agora)) out.push({ chave: `casa:${n.codigo}:${n.marca}`, msg: TEXTOS.casa(n.marca), para: { aparelhos: [n.aparelho] }, caixa: false, marca: n }); } catch (e) {}
  }
  return out;
}
export { periodos };
