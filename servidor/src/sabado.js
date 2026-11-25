// 17/11 (pedido do dono): Sábado dos Torneios. Todo sábado, das 10h às 22h (Manaus), um torneio com tema: toda partida
// online jogada inteira conta pontos (vitória vale 3, mais o bônus do tema da semana). Todo mundo aparece no placar, mas
// o título de Campeão do Sábado é só de sócio: o sócio mais bem colocado leva, com o selo 🏅 na mesa até o próximo
// torneio. No fim de semana da Copa dos Sócios não tem torneio. Quem conta é o servidor; menor de 18 não aparece.
import { copaAgora } from './copa.js';
import { perfis } from './ranking.js';
const MANAUS = 4 * 3600000, DIA = 86400000, SEMANA = 7 * DIA;
const manaus = t => new Date(t - MANAUS);
const diaM = t => manaus(t).toISOString().slice(0, 10);
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
export const SABADO_HORA = { inicio: 10, fim: 22 };
// 17/11 (dono): cada sábado o torneio leva o nome de uma mesa de Manaus (e a ilustração dela), em rodízio; a regra do bônus
// também roda (galo, carroça, maratona). O primeiro sábado, 21/11/2026, é o Torneio Teatro Amazonas, com o bônus do galo (24/11, dono: os nomes sem "do/da").
// O app tem as mesmas listas.
export const REGRAS_SABADO = [
  { id: 'galo', regra: 'cada galo seu vale +1 ponto' },
  { id: 'carroca', regra: 'cada batida de carroça vale +2 pontos' },
  { id: 'maratona', regra: 'cada partida jogada até o fim vale +1 ponto' }
];
export const TORNEIO_MESAS = [['teatro', 'Teatro Amazonas'], ['encontro', 'Encontro das Águas'], ['arena', 'Arena da Amazônia'], ['boto', 'Boto-rosa'], ['mercado', 'Mercado Adolpho Lisboa'], ['peixeboi', 'Peixe-boi'], ['ponte', 'Ponte Rio Negro'], ['guarana', 'Guaraná'], ['palacio', 'Palácio Rio Negro'], ['onca', 'Onça-pintada'], ['pontanegra', 'Ponta Negra'], ['pirarucu', 'Pirarucu'], ['relogio', 'Relógio Municipal'], ['tucano', 'Tucano'], ['calcadao', 'Largo de São Sebastião'], ['vitoria', 'Vitória-régia'], ['igreja', 'Igreja de São Sebastião'], ['araraazul', 'Arara-Azul'], ['chamine', 'Usina Chaminé'], ['tambaqui', 'Tambaqui']];
const BASE = Date.parse('2026-11-21T12:00:00Z');
// 24/11 (dono): a lista só anda nos sábados que têm torneio: o sábado da Copa dos Sócios não gasta a vez de ninguém
export function temaDoSabado(dia) {
  const fim = Date.parse(dia + 'T12:00:00Z'), r = REGRAS_SABADO, m = TORNEIO_MESAS;
  let k = 0;
  if (fim >= BASE) { for (let t = BASE; t < fim; t += SEMANA) if (semCopa(t)) k++; }
  else k = Math.round((fim - BASE) / SEMANA);
  const g = r[((k % r.length) + r.length) % r.length], me = m[((k % m.length) + m.length) % m.length];
  return { id: g.id, regra: g.regra, mesa: me[0], nome: 'Torneio ' + me[1] };
}
// sábado sem Copa dos Sócios no ar (no fim de semana da Copa, o sábado é dela)
const semCopa = t => { try { return !copaAgora(t).ativa; } catch (e) { return true; } };
export function sabadoAgora(t) { t = t || Date.now(); const d = manaus(t), h = d.getUTCHours(); return d.getUTCDay() === 6 && h >= SABADO_HORA.inicio && h < SABADO_HORA.fim && semCopa(t); }
// SABADO_TESTE = '1' liga o torneio agora (só no teste local); COPA_AGORA muda a hora (testes)
export const sabadoValendo = env => (env && env.SABADO_TESTE === '1') || sabadoAgora(Number(env && env.COPA_AGORA) || Date.now());

// fim de partida online no torneio: soma para cada um que jogou a partida inteira (galos e carroças por cadeira)
export async function anotarSabado(env, m, quem) {
  const agora = Number(env && env.COPA_AGORA) || Date.now(), dia = diaM(agora), tema = temaDoSabado(dia);
  for (const q of quem || []) {
    if (!idOk(q.id) || q.menor) continue;
    const p = (m.cad || []).findIndex(c => c && c.id === q.id);
    const g = p >= 0 && m.sxG ? Math.min(6, m.sxG[p] || 0) : 0, c = p >= 0 && m.sxC ? Math.min(4, m.sxC[p] || 0) : 0;
    const pts = (q.ganhou ? 3 : 0) + (tema.id === 'galo' ? g : tema.id === 'carroca' ? 2 * c : 1);
    try {
      await env.DB.prepare(`INSERT INTO sabado_placar (dia, aparelho, nome, partidas, vitorias, galos, carrocas, pontos, em) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
        ON CONFLICT (dia, aparelho) DO UPDATE SET nome = excluded.nome, partidas = partidas + 1, vitorias = vitorias + excluded.vitorias, galos = galos + excluded.galos,
        carrocas = carrocas + excluded.carrocas, pontos = pontos + excluded.pontos, em = CASE WHEN excluded.pontos > 0 THEN excluded.em ELSE em END`)
        .bind(dia, q.id, String(q.nome || '').slice(0, 24), q.ganhou ? 1 : 0, g, c, pts, agora).run();
    } catch (e) {}
  }
}
const ORDEM = 'ORDER BY pontos DESC, vitorias DESC, partidas ASC, em ASC';
const socioAgora = async (env, ap) => { try { const p = await env.DB.prepare('SELECT ate FROM planos WHERE aparelho = ?').bind(ap).first(); return !!(p && p.ate > Date.now()); } catch (e) { return false; } };
// o último sábado em que o torneio já terminou (22h) e o campeão dele (o sócio mais bem colocado). Fica guardado.
const CAMP = { em: 0, dados: null, chave: '' };
function ultimoSabado(agora) {
  const d = manaus(agora); let k = (d.getUTCDay() + 1) % 7;   // dias desde o último sábado (sábado = 0)
  let dia = new Date(agora - MANAUS - k * DIA).toISOString().slice(0, 10);
  if (Date.parse(dia + 'T22:00:00-04:00') > agora) dia = new Date(Date.parse(dia + 'T12:00:00Z') - SEMANA).toISOString().slice(0, 10);
  return dia;
}
export async function campeaoDoSabado(env, agora) {
  agora = agora || Number(env && env.COPA_AGORA) || Date.now();
  const dia = ultimoSabado(agora);
  if (CAMP.dados !== null && CAMP.chave === dia && agora - CAMP.em < 10 * 60000) return CAMP.dados;
  let r = null;
  try {
    r = await env.DB.prepare('SELECT dia, aparelho, nome, pontos FROM sabado_campeao WHERE dia = ?').bind(dia).first();
    if (!r) {
      const l = (await env.DB.prepare(`SELECT aparelho, nome, pontos FROM sabado_placar WHERE dia = ? AND pontos > 0 ${ORDEM} LIMIT 40`).bind(dia).all()).results || [];
      let c = null; for (const x of l) { if (await socioAgora(env, x.aparelho)) { c = x; break; } }
      const lider = l[0] || null;
      await env.DB.prepare('INSERT OR IGNORE INTO sabado_campeao (dia, aparelho, nome, pontos, lider, em) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(dia, c ? c.aparelho : null, c ? c.nome : null, c ? c.pontos : 0, lider && (!c || lider.aparelho !== c.aparelho) ? lider.aparelho : null, agora).run();
      r = await env.DB.prepare('SELECT dia, aparelho, nome, pontos, lider FROM sabado_campeao WHERE dia = ?').bind(dia).first();
    }
  } catch (e) { r = null; }
  const dados = r && r.aparelho ? { dia: r.dia, aparelho: r.aparelho, nome: r.nome, pontos: r.pontos } : { dia, aparelho: null };
  CAMP.em = agora; CAMP.chave = dia; CAMP.dados = dados;
  return dados;
}
// GET /sabado/placar?id=: no sábado (das 10h), o de hoje (ao vivo até as 22h); no domingo e na segunda até as 19h (24/11: até a
// Segunda, o próximo evento com placar), o de sábado, com o campeão
export async function sabadoPlacar(env, url, h, origin) {
  const agora = Number(env && env.COPA_AGORA) || Date.now(), d = manaus(agora), ws = d.getUTCDay(), hr = d.getUTCHours();
  let dia = null, aoVivo = false;
  if (env.SABADO_TESTE === '1') { dia = diaM(agora); aoVivo = true; }
  else if (ws === 6 && hr >= SABADO_HORA.inicio) { dia = diaM(agora); aoVivo = hr < SABADO_HORA.fim; }
  else if (ws === 0) dia = diaM(agora - DIA);
  else if (ws === 1 && hr < 19) dia = diaM(agora - 2 * DIA);
  if (dia && !semCopa(Date.parse(dia + 'T15:00:00-04:00'))) dia = null;   // sábado da Copa: sem torneio
  if (!dia) return h.json({ dia: null }, 200, origin);
  const tema = temaDoSabado(dia);
  let top = [], eu = null, campeao = null, titulo = null, quase = false;
  try {
    const l = (await env.DB.prepare(`SELECT aparelho, nome, partidas, vitorias, galos, carrocas, pontos FROM sabado_placar WHERE dia = ? AND pontos > 0 ${ORDEM} LIMIT 10`).bind(dia).all()).results || [];
    const pf = await perfis(env, l.map(x => x.aparelho));
    top = l.map(x => Object.assign({ nome: x.nome, pontos: x.pontos, vitorias: x.vitorias, galos: x.galos, carrocas: x.carrocas, partidas: x.partidas }, pf.get(x.aparelho) || {}));
    const id = url.searchParams.get('id') || '';
    if (aoVivo) { const i = top.findIndex(x => x.socio); titulo = i >= 0 ? i + 1 : null; }   // quem levaria o título agora (o sócio mais bem colocado)
    else {
      const c = await campeaoDoSabado(env, Date.parse(dia + 'T22:00:00-04:00') + 60000);
      if (c && c.aparelho) { campeao = { nome: c.nome, pontos: c.pontos, eu: idOk(id) && c.aparelho === id }; const i = l.findIndex(x => x.aparelho === c.aparelho); titulo = i >= 0 ? i + 1 : null; }
      quase = idOk(id) && !!l[0] && l[0].aparelho === id && !(c && c.aparelho === id);   // ficou em 1º sem ser sócio
    }
    if (idOk(id)) {
      const r = await env.DB.prepare('SELECT nome, partidas, vitorias, galos, carrocas, pontos, em FROM sabado_placar WHERE dia = ? AND aparelho = ?').bind(dia, id).first();
      if (r && r.pontos > 0) {
        const acima = await env.DB.prepare('SELECT COUNT(*) AS n FROM sabado_placar WHERE dia = ? AND pontos > 0 AND (pontos > ? OR (pontos = ? AND (vitorias > ? OR (vitorias = ? AND (partidas < ? OR (partidas = ? AND em < ?))))))')
          .bind(dia, r.pontos, r.pontos, r.vitorias, r.vitorias, r.partidas, r.partidas, r.em).first();
        eu = { pos: ((acima && acima.n) || 0) + 1, pontos: r.pontos, vitorias: r.vitorias, partidas: r.partidas };
      }
    }
  } catch (e) {}
  return h.json({ dia, aoVivo, tema, top, eu, campeao, titulo, quase }, 200, origin);
}
// avisos: sábado às 10h (o que não sair nessa rodada sai às 11h), para todos; domingo de manhã, o campeão recebe o dele
// e quem ficou em 1º sem ser sócio fica sabendo que o título seria dele
export async function avisosSabado(env, agora) {
  agora = agora || Date.now();
  const d = manaus(agora), h = d.getUTCHours(), dia = diaM(agora), out = [];
  if (d.getUTCDay() === 6 && (h === 10 || h === 11) && semCopa(agora)) {
    const t = temaDoSabado(dia);
    out.push({ chave: `sb:${dia}`, msg: { titulo: `Hoje é Sábado dos Torneios: ${t.nome}! 🏅`, texto: `Das 10h às 22h, toda partida online conta: vitória vale 3 e ${t.regra}. O sócio mais bem colocado vira o Campeão do Sábado.`, url: '/?abrir=ranking' }, para: 'todos', caixa: false });
  }
  if (d.getUTCDay() === 0 && h >= 9 && h < 12) {
    const ontem = diaM(agora - DIA);
    if (semCopa(Date.parse(ontem + 'T15:00:00-04:00'))) {
      const c = await campeaoDoSabado(env, agora);
      if (c && c.aparelho && c.dia === ontem) out.push({ chave: `sb:${ontem}:campeao`, msg: { titulo: 'Você é o Campeão do Sábado! 🏅', texto: `Você foi o sócio mais bem colocado no ${temaDoSabado(ontem).nome}. O selo 🏅 fica com você na mesa até o próximo sábado.`, url: '/?abrir=ranking' }, para: { aparelhos: [c.aparelho] }, caixa: false });
      try {
        const r = await env.DB.prepare('SELECT lider FROM sabado_campeao WHERE dia = ?').bind(ontem).first();
        if (r && r.lider) out.push({ chave: `sb:${ontem}:quase`, msg: { titulo: 'Você ficou em 1º no torneio de sábado! 🏅', texto: 'O título de Campeão do Sábado é dos sócios. Seja Sócio da Calçada e, no próximo, o selo 🏅 é seu.', url: '/?abrir=ranking' }, para: { aparelhos: [r.lider] }, caixa: false });
      } catch (e) {}
    }
  }
  return out;
}
