// 25/11 (ideia de um sócio, aprovada pelo dono): Duelo entre sócios. No lugar de um chat aberto (o jogo não junta
// desconhecidos), um sócio desafia outro pelo ranking ou pelo Hall da Fama: o app cria a mesa com os amigos e o desafiado
// recebe o aviso no celular e no app ("Fulano te desafiou"), com Aceitar e Agora não. Os dois ficam em lados opostos (a
// mesa senta quem chega na cadeira seguinte), cada um com a turma do bairro de parceiro.
// - Sem texto livre: só as frases prontas (FRASES).
// - Só sócio desafia e só sócio é desafiado (sócio é maior de 18); menor nunca entra. Quem não quer receber, desliga.
// - Limites: 6 desafios por dia, 2 para a mesma pessoa, 5 recebidos por dia. Um desafio vale 10 minutos.
// - O placar dos dois soma no fim de cada partida inteira (até 200) na mesa do duelo, com os dois em lados opostos.
// - Guarda quem desafiou quem, a frase e o número da mesa por 30 dias (o placar fica); a chave de cada um é a do Hall.
import { temPlano } from './planos.js';
import { pushPara, ehMenor } from './turmas.js';
import { bloqueado } from './bloqueio.js';
import { nomeOfensivo } from './motor.js';
import { chaveHall } from './chaves.js';
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
export const DUELO = { vence: 10 * 60000, porDia: 6, porPar: 2, recebidos: 5, guarda: 30 * 86400000, placarJanela: 3 * 3600000 };
export const FRASES = ['Bora um duelo?', 'Quero revanche!', 'Tô na mesa, vem!', 'Duvido tu ganhar de mim, maninho!'];
const inicioDoDia = () => { const d = new Date(Date.now() - 4 * 3600000); d.setUTCHours(0, 0, 0, 0); return d.getTime() + 4 * 3600000; };   // meia-noite de Manaus
const nomeLimpo = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);

// o aparelho do sócio com essa chave (a mesma do Hall da Fama); só entre quem tem plano agora
async function acharSocio(env, k) {
  if (!/^[0-9a-f]{12}$/.test(String(k || ''))) return null;
  try {
    const { results } = await env.DB.prepare('SELECT DISTINCT aparelho FROM planos WHERE ate > ?').bind(Date.now()).all();
    for (const r of results || []) if (idOk(r.aparelho) && await chaveHall(r.aparelho) === k) return r.aparelho;
  } catch (e) {}
  return null;
}
const naoRecebe = async (env, ap) => { try { return !!(await env.DB.prepare('SELECT 1 AS x FROM duelo_off WHERE aparelho = ?').bind(ap).first()); } catch (e) { return false; } };
async function conta(env, sql, ...args) { try { const r = await env.DB.prepare(sql).bind(...args).first(); return (r && r.n) || 0; } catch (e) { return 0; } }
// o placar entre dois aparelhos, do ponto de vista de `eu`
async function placar(env, eu, outro) {
  const [a, b] = [eu, outro].sort();
  try {
    const r = await env.DB.prepare('SELECT va, vb FROM duelo_placar WHERE a = ? AND b = ?').bind(a, b).first();
    if (!r) return { eu: 0, ele: 0 };
    return a === eu ? { eu: r.va, ele: r.vb } : { eu: r.vb, ele: r.va };
  } catch (e) { return { eu: 0, ele: 0 }; }
}
// a mesa do desafio: existe, é com os amigos, está esperando, quem desafia está sentado nela e tem cadeira livre
async function mesaBoa(env, codigo, ap) {
  try {
    const r = await (await env.MESA.get(env.MESA.idFromName(codigo)).fetch('https://mesa/info?id=' + encodeURIComponent(ap))).json();
    return !!(r && r.existe && !r.publica && r.fase === 'espera' && r.meu && r.livres > 0);
  } catch (e) { return false; }
}

// POST /duelo {aparelho, nome, alvo, frase, mesa?, menor?} — sem mesa só confere (antes de criar a mesa); com a mesa, desafia
export async function desafiar(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const ap = b.aparelho;
  if (!idOk(ap)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (b.menor || await ehMenor(env, ap)) return h.json({ erro: 'menor' }, 403, origin);
  if (await bloqueado(env, ap)) return h.json({ erro: 'bloqueado' }, 403, origin);
  if (!(await temPlano(env, ap))) return h.json({ erro: 'socio' }, 403, origin);
  const nome = nomeLimpo(b.nome); if (!nome || nomeOfensivo(nome)) return h.json({ erro: 'apelido' }, 403, origin);
  const frase = Number(b.frase); if (!Number.isInteger(frase) || frase < 0 || frase >= FRASES.length) return h.json({ erro: 'frase' }, 400, origin);
  const alvo = await acharSocio(env, b.alvo);
  if (!alvo) return h.json({ erro: 'alvo' }, 404, origin);
  if (alvo === ap) return h.json({ erro: 'voce' }, 400, origin);
  if (await ehMenor(env, alvo)) return h.json({ erro: 'alvo' }, 404, origin);
  if (await naoRecebe(env, alvo)) return h.json({ erro: 'nao-recebe' }, 409, origin);
  const dia = inicioDoDia();
  if (await conta(env, 'SELECT COUNT(*) AS n FROM duelos WHERE de = ? AND em >= ?', ap, dia) >= DUELO.porDia) return h.json({ erro: 'limite' }, 429, origin);
  if (await conta(env, 'SELECT COUNT(*) AS n FROM duelos WHERE de = ? AND para = ? AND em >= ?', ap, alvo, dia) >= DUELO.porPar) return h.json({ erro: 'par' }, 429, origin);
  if (await conta(env, 'SELECT COUNT(*) AS n FROM duelos WHERE para = ? AND em >= ?', alvo, dia) >= DUELO.recebidos) return h.json({ erro: 'cheio' }, 429, origin);
  const pl = await placar(env, ap, alvo);
  if (!b.mesa) return h.json({ ok: true, checado: true, placar: pl }, 200, origin);
  const mesa = String(b.mesa); if (!/^\d{5}$/.test(mesa) || !(await mesaBoa(env, mesa, ap))) return h.json({ erro: 'mesa' }, 409, origin);
  const agora = Date.now();
  try { await env.DB.prepare("UPDATE duelos SET estado = 'cancelado', decidido = ? WHERE de = ? AND estado = 'aberto'").bind(agora, ap).run(); } catch (e) {}
  let id = null;
  try {
    const r = await env.DB.prepare("INSERT INTO duelos (de, para, de_nome, mesa, frase, em, estado) VALUES (?, ?, ?, ?, ?, ?, 'aberto')").bind(ap, alvo, nome, mesa, frase, agora).run();
    id = r && r.meta && r.meta.last_row_id;
  } catch (e) { return h.json({ erro: 'banco' }, 500, origin); }
  try { await pushPara(env, alvo, 'duelo:' + id, { titulo: `⚔️ ${nome} te desafiou pra um duelo!`, texto: `“${FRASES[frase]}” A mesa tá esperando: toque aqui pra entrar.`, url: '/?abrir=duelo' }); } catch (e) {}
  return h.json({ ok: true, id, vence: agora + DUELO.vence, placar: pl }, 201, origin);
}

// GET /duelo?aparelho= — os desafios abertos para mim (com o placar), o último que eu mandei e se eu recebo desafios
export async function meus(req, env, origin, h, url) {
  const ap = url.searchParams.get('aparelho');
  if (!idOk(ap)) return h.json({ erro: 'aparelho' }, 400, origin);
  const agora = Date.now(), desde = agora - DUELO.vence;
  const out = { receber: !(await naoRecebe(env, ap)), abertos: [], meu: null, frases: FRASES };
  try {
    const { results } = await env.DB.prepare("SELECT id, de, de_nome, mesa, frase, em FROM duelos WHERE para = ? AND estado = 'aberto' AND em > ? ORDER BY em DESC LIMIT 3").bind(ap, desde).all();
    for (const d of results || []) out.abertos.push({ id: d.id, nome: d.de_nome, mesa: d.mesa, frase: FRASES[d.frase] || FRASES[0], vence: d.em + DUELO.vence, placar: await placar(env, ap, d.de) });
    const m = await env.DB.prepare('SELECT id, para, mesa, estado, em FROM duelos WHERE de = ? AND em > ? ORDER BY em DESC LIMIT 1').bind(ap, agora - 3 * 3600000).first();
    if (m) out.meu = { id: m.id, mesa: m.mesa, estado: m.estado === 'aberto' && m.em + DUELO.vence < agora ? 'vencido' : m.estado, vence: m.em + DUELO.vence, placar: await placar(env, ap, m.para) };
  } catch (e) {}
  return h.json(out, 200, origin);
}

// POST /duelo/responder {aparelho, id, aceitar}
export async function responder(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho) || !Number.isInteger(Number(b.id))) return h.json({ erro: 'dados' }, 400, origin);
  const d = await env.DB.prepare('SELECT id, de, mesa, estado, em FROM duelos WHERE id = ? AND para = ?').bind(Number(b.id), b.aparelho).first();
  if (!d) return h.json({ erro: 'nao-achei' }, 404, origin);
  if (d.estado !== 'aberto' || d.em + DUELO.vence < Date.now()) return h.json({ erro: d.estado === 'cancelado' ? 'cancelado' : 'vencido' }, 409, origin);
  const aceitar = !!b.aceitar;
  await env.DB.prepare('UPDATE duelos SET estado = ?, decidido = ? WHERE id = ?').bind(aceitar ? 'aceito' : 'recusado', Date.now(), d.id).run();
  return h.json({ ok: true, mesa: aceitar ? d.mesa : null }, 200, origin);
}

// POST /duelo/config {aparelho, receber}
export async function config(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (b.receber) await env.DB.prepare('DELETE FROM duelo_off WHERE aparelho = ?').bind(b.aparelho).run();
  else {
    await env.DB.prepare('INSERT OR REPLACE INTO duelo_off (aparelho, em) VALUES (?, ?)').bind(b.aparelho, Date.now()).run();
    try { await env.DB.prepare("UPDATE duelos SET estado = 'recusado', decidido = ? WHERE para = ? AND estado = 'aberto'").bind(Date.now(), b.aparelho).run(); } catch (e) {}
  }
  return h.json({ ok: true, receber: !!b.receber }, 200, origin);
}

// fim de partida inteira numa mesa com os amigos (mesa.js, contarRanking): o placar dos duelos aceitos nessa mesa
export async function anotarDuelo(env, codigo, quem) {
  if (!codigo || !quem || quem.length < 2) return;
  const { results } = await env.DB.prepare("SELECT id, de, para FROM duelos WHERE mesa = ? AND estado IN ('aceito', 'jogado') AND em > ?").bind(String(codigo), Date.now() - DUELO.placarJanela).all();
  for (const d of results || []) {
    const a = quem.find(q => q.id === d.de), b = quem.find(q => q.id === d.para);
    if (!a || !b || a.ganhou === b.ganhou) continue;   // os dois jogaram a partida inteira, em lados opostos
    const [x, y] = [d.de, d.para].sort(), ganhouX = (x === a.id ? a : b).ganhou;
    await env.DB.prepare('INSERT INTO duelo_placar (a, b, va, vb, em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(a, b) DO UPDATE SET va = va + excluded.va, vb = vb + excluded.vb, em = excluded.em')
      .bind(x, y, ganhouX ? 1 : 0, ganhouX ? 0 : 1, Date.now()).run();
    await env.DB.prepare("UPDATE duelos SET estado = 'jogado', partidas = partidas + 1 WHERE id = ?").bind(d.id).run();
  }
}
export async function limparDuelos(env) {
  try { await env.DB.prepare('DELETE FROM duelos WHERE em < ?').bind(Date.now() - DUELO.guarda).run(); } catch (e) {}
}
