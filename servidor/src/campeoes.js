// 24/11 (dono: "quero bastante destaque para os campeões da semana, mês, Copa dos Sócios e torneios"): os campeões do
// momento (Rei da Calçada, Campeão do Mês, Campeão da Copa dos Sócios e Campeão do Sábado), o Hall da Fama (todos os
// anteriores) e os títulos de cada um. Para o app nunca vai o código do aparelho de ninguém: só "eu" (é você).
// Os campeões da semana e do mês ficam guardados em `campeoes` quando aparecem (a Copa já fica em copa_premios e o
// sábado em sabado_campeao), por até 13 meses (faxina da Privacidade).
import { reiDaSemana, campeaoDoMes, periodos, perfis, reiDe, campeaoMesDe, inicioPeriodo, CAMPEAO_DESDE } from './ranking.js';
import { campeaoDoSabado, temaDoSabado } from './sabado.js';   // temaDoSabado: o nome do torneio no Hall
import { copaAgora } from './copa.js';

const DIA = 86400000, MANAUS = 4 * 3600000;
const SEMANA_DESDE = 'S2026-10-26';   // o ranking por pontos começou nessa semana
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const ddmm = ms => { const d = new Date(ms - MANAUS); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const mesNome = per => MESES[Number(per.slice(6, 8)) - 1] || '';   // M2026-11
const agoraDe = env => Number(env && (env.RANKING_AGORA || env.COPA_AGORA)) || Date.now();

// 25/11 (dono: ficha do campeão): uma chave por pessoa, para o app juntar os títulos de cada um sem saber o código do aparelho
async function chaveDe(ap) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hall|' + ap)));
  return [...b.slice(0, 6)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function guardar(env, tipo, periodo, x) {
  if (!x || !x.aparelho) return;
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO campeoes (tipo, periodo, aparelho, nome, av, pontos, em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(tipo, periodo, x.aparelho, String(x.nome || 'Jogador').slice(0, 16), x.av || null, Number(x.pontos) || 0, Date.now()).run();
  } catch (e) {}
}
// as semanas e os meses que já acabaram e ainda não estão guardados (uma vez: depois, só a última)
async function completar(env, agora) {
  const p = periodos(agora), feitos = new Set();
  try { const { results } = await env.DB.prepare('SELECT tipo, periodo FROM campeoes').all(); (results || []).forEach(r => feitos.add(r.tipo + r.periodo)); } catch (e) { return; }
  for (let t = inicioPeriodo(SEMANA_DESDE) + 12 * 3600000; t < inicioPeriodo(p.sem); t += 7 * DIA) {
    const sem = periodos(t).sem; if (feitos.has('semana' + sem)) continue;
    try { await guardar(env, 'semana', sem, await reiDe(env, sem)); } catch (e) {}
  }
  for (let t = inicioPeriodo(CAMPEAO_DESDE) + 12 * 3600000; t < inicioPeriodo(p.mes); t = inicioPeriodo(periodos(t).mes) + 40 * DIA) {
    const mes = periodos(t).mes; if (feitos.has('mes' + mes)) continue;
    try { await guardar(env, 'mes', mes, await campeaoMesDe(env, mes)); } catch (e) {}
  }
}
const HALL = { em: 0, chave: '', dados: null };
async function hall(env, agora) {
  const chave = periodos(agora).sem + periodos(agora).mes;
  if (HALL.dados && HALL.chave === chave && agora - HALL.em < 10 * 60000) return HALL.dados;
  await completar(env, agora);
  const q = async (sql, ...b) => { try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch (e) { return []; } };
  const sem = await q("SELECT periodo, aparelho, nome, av, pontos FROM campeoes WHERE tipo = 'semana' AND aparelho IS NOT NULL ORDER BY periodo DESC LIMIT 60");
  const mes = await q("SELECT periodo, aparelho, nome, av, pontos FROM campeoes WHERE tipo = 'mes' AND aparelho IS NOT NULL ORDER BY periodo DESC LIMIT 24");
  const copa = await q('SELECT edicao, n, aparelho, codigo, nome, pontos FROM copa_premios WHERE pos = 1 ORDER BY n DESC LIMIT 12');
  const sab = await q('SELECT dia, aparelho, nome, pontos FROM sabado_campeao WHERE aparelho IS NOT NULL ORDER BY dia DESC LIMIT 60');
  const ini = per => inicioPeriodo(per);
  const dados = {
    semana: sem.map(r => ({ ap: r.aparelho, nome: r.nome, av: r.av, pontos: r.pontos, quando: `semana de ${ddmm(ini(r.periodo))} a ${ddmm(ini(r.periodo) + 6 * DIA)}`, desde: ini(r.periodo) + 7 * DIA })),
    mes: mes.map(r => ({ ap: r.aparelho, nome: r.nome, av: r.av, pontos: r.pontos, quando: `${mesNome(r.periodo)} de ${r.periodo.slice(1, 5)}`, desde: ini('M' + new Date(ini(r.periodo) + 40 * DIA - MANAUS).toISOString().slice(0, 7)) })),
    copa: copa.map(r => ({ ap: r.aparelho, codigo: r.codigo, nome: r.nome, pontos: r.pontos, quando: `${r.n}ª Copa dos Sócios · ${mesNome('M' + r.edicao.slice(1))} de ${r.edicao.slice(1, 5)}`, n: r.n })),
    sabado: sab.map(r => ({ ap: r.aparelho, nome: r.nome, pontos: r.pontos, quando: `${temaDoSabado(r.dia).nome} · ${r.dia.slice(8, 10)}/${r.dia.slice(5, 7)}`, desde: Date.parse(r.dia + 'T22:00:00-04:00'), dia: r.dia }))
  };
  // o rosto (foto do sócio ou avatar) de quem aparece
  const aps = [...new Set(['semana', 'mes', 'copa', 'sabado'].flatMap(k => dados[k].slice(0, 30).map(x => x.ap)))].filter(Boolean);
  const pf = new Map();
  for (let i = 0; i < aps.length; i += 30) { try { (await perfis(env, aps.slice(i, i + 30))).forEach((v, k) => pf.set(k, v)); } catch (e) {} }
  for (const k of ['semana', 'mes', 'copa', 'sabado']) for (const x of dados[k]) { const p = pf.get(x.ap); if (p) { x.av = x.av || p.av; x.foto = p.foto || null; } }
  // 25/11 (dono): a chave de cada um (ficha do campeão) e os maiores campeões (quem tem mais títulos, somando tudo)
  const chaves = new Map(); for (const a of new Set(['semana', 'mes', 'copa', 'sabado'].flatMap(k => dados[k].map(x => x.ap)).filter(Boolean))) chaves.set(a, await chaveDe(a));
  const mx = new Map();
  for (const k of ['semana', 'mes', 'copa', 'sabado']) for (const x of dados[k]) {
    x.k = chaves.get(x.ap) || null; if (!x.ap) continue;
    const quando = x.desde || 0;
    let m = mx.get(x.ap); if (!m) { m = { ap: x.ap, codigo: null, k: x.k, nome: x.nome, av: x.av, foto: x.foto || null, semana: 0, mes: 0, copa: 0, sabado: 0, total: 0, ultimo: -1 }; mx.set(x.ap, m); }
    m[k]++; m.total++; if (x.codigo) m.codigo = x.codigo;
    if (quando > m.ultimo) { m.ultimo = quando; m.nome = x.nome; m.av = x.av || m.av; m.foto = x.foto || m.foto; }   // o apelido do título mais novo
  }
  dados.maiores = [...mx.values()].sort((a, b) => b.total - a.total || b.ultimo - a.ultimo).slice(0, 10);
  HALL.em = agora; HALL.chave = chave; HALL.dados = dados;
  return dados;
}
const publico = (x, ap, codigo) => x ? { k: x.k || null, nome: x.nome, av: x.av || null, foto: x.foto || null, pontos: x.pontos || 0, quando: x.quando, desde: x.desde || null,
  eu: !!ap && (x.ap === ap || (!!codigo && !!x.codigo && x.codigo === codigo)) } : null;
// os do momento: o Rei e o Campeão do Mês são os mesmos da coroa e da pedra Dourada (ranking.js); a Copa, a última apurada
// (a mesa do campeão vale até o fim da seguinte); o sábado, o do último torneio
export async function atuais(env, agora) {
  agora = agora || agoraDe(env);
  const h = await hall(env, agora), out = { semana: null, mes: null, copa: null, sabado: null };
  try {
    const r = await reiDaSemana(env);
    if (r) { const sem = periodos(agora - 7 * DIA).sem, i = inicioPeriodo(sem);
      out.semana = h.semana.find(x => x.ap === r.aparelho && x.desde === i + 7 * DIA) || { ap: r.aparelho, k: await chaveDe(r.aparelho), nome: r.nome, av: r.av, quando: `semana de ${ddmm(i)} a ${ddmm(i + 6 * DIA)}`, desde: i + 7 * DIA }; }
  } catch (e) {}
  try {
    const c = await campeaoDoMes(env);
    if (c) out.mes = h.mes.find(x => x.ap === c.aparelho && x.quando.startsWith(mesNome(c.mes))) || { ap: c.aparelho, k: await chaveDe(c.aparelho), nome: c.nome, av: c.av, quando: `${mesNome(c.mes)} de ${c.mes.slice(1, 5)}`, desde: inicioPeriodo(periodos(agora).mes) };
  } catch (e) {}
  try { const c = copaAgora(agora); if (c.anterior) { const x = h.copa.find(y => y.n === c.anterior.n); if (x) out.copa = Object.assign({}, x, { desde: c.anterior.fim }); } } catch (e) {}
  // o sábado: o do último torneio (no fim de semana da Copa não tem torneio: continua o do sábado anterior)
  try { const c = await campeaoDoSabado(env, agora); out.sabado = (c && c.aparelho && h.sabado.find(x => x.dia === c.dia)) || (h.sabado[0] && agora - h.sabado[0].desde < 15 * DIA ? h.sabado[0] : null); } catch (e) {}
  return { out, h };
}
// GET /campeoes?aparelho= -> { atuais: {semana, mes, copa, sabado}, hall: {...}, meus: {semana, mes, copa, sabado} }
export async function rota(req, env, origin, hh, url) {
  const ap = idOk(url.searchParams.get('aparelho')) ? url.searchParams.get('aparelho') : null, agora = agoraDe(env);
  let codigo = null; if (ap) { try { const p = await env.DB.prepare('SELECT codigo FROM planos WHERE aparelho = ?').bind(ap).first(); codigo = (p && p.codigo) || null; } catch (e) {} }
  const { out, h } = await atuais(env, agora);
  const at = {}; for (const k of Object.keys(out)) at[k] = publico(out[k], ap, codigo);
  const hl = {}; for (const k of ['semana', 'mes', 'copa', 'sabado']) hl[k] = h[k].slice(0, 30).map(x => publico(x, ap, codigo));
  hl.maiores = (h.maiores || []).map(m => ({ k: m.k, nome: m.nome, av: m.av || null, foto: m.foto || null, semana: m.semana, mes: m.mes, copa: m.copa, sabado: m.sabado, total: m.total,
    eu: !!ap && (m.ap === ap || (!!codigo && !!m.codigo && m.codigo === codigo)) }));
  const meus = { semana: 0, mes: 0, copa: 0, sabado: 0 };
  if (ap) for (const k of Object.keys(meus)) meus[k] = h[k].filter(x => x.ap === ap || (k === 'copa' && codigo && x.codigo === codigo)).length;
  return hh.json({ atuais: at, hall: hl, meus, agora }, 200, origin);
}
// avisos (rotina das 9h às 11h): o Campeão do Mês no dia 1º e o Campeão do Sábado no domingo, para todo mundo (o campeão
// recebe o dele). O Rei da Calçada vai na segunda, no aviso do dia (index.js)
export async function avisosCampeoes(env, agora) {
  agora = agora || Date.now();
  const d = new Date(agora - MANAUS), h = d.getUTCHours(), out = [];
  if (h < 9 || h >= 12) return out;
  if (d.getUTCDate() === 1) {
    try {
      const c = await campeaoDoMes(env);
      if (c && c.aparelho) {
        const m = mesNome(c.mes), prox = mesNome('M' + new Date(inicioPeriodo(c.mes) + 40 * DIA - MANAUS).toISOString().slice(0, 7));
        out.push({ chave: `cm:${c.mes}:eu`, msg: { titulo: 'Você é o Campeão do Mês! 🥇', texto: `Você foi o sócio mais bem colocado de ${m}. A pedra Dourada é sua em ${prox} inteiro, e todo mundo vê.`, url: '/?abrir=campeoes' }, para: { aparelhos: [c.aparelho] }, caixa: false });
        out.push({ chave: `cm:${c.mes}:todos`, msg: { titulo: `🥇 ${c.nome} é o Campeão de ${m}!`, texto: `Ficou em 1º no ranking do mês e joga ${prox} com a pedra Dourada. O próximo pode ser você!`, url: '/?abrir=campeoes' }, para: 'todos', caixa: true, menos: [c.aparelho] });
      }
    } catch (e) {}
  }
  return out;
}
