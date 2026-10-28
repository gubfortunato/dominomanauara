// Servidor do Dominó Manauara (Cloudflare Workers + D1 + Durable Objects).
// Caixa de mensagens "Fale com a gente", lembretes para jogar (Web Push), painel do dono e mesa online por convite.
import { enviarPush } from './webpush.js';
import { Mesa } from './mesa.js';
import { pagar, pedido, plano, trazerPlano, webhook, donoPagamentos, donoDevolver, manterChaveAsaas, donoCortesia, guardarProgresso, verProgresso, donoApoiadores } from './pagamentos.js';
import { atuais, imagem, contar, donoLista, donoImagem, donoSalvar, donoApagar } from './patrocinadores.js';
import * as fotos from './fotos.js';
import * as turmas from './turmas.js';
import * as vivo from './vivo.js';
import * as presenca from './presenca.js';
import * as rk from './ranking.js';
import { bloqueado, donoJogadores, donoBloquear, donoDesbloquear, limparVistos, apelidoBarrado, donoApelido, exigeApp, appAberto, anotarRitmo, donoRobos } from './bloqueio.js';
import { donoPapo, donoPapoApagar } from './papo.js';
export { Mesa };

const SITE = 'https://dominomanauara.com.br';
const TIPOS = ['problema', 'ideia', 'elogio', 'outro'];
const INTERESSES = { banner: 'Banner no início', mesa: 'Mesa com a marca', fim: 'Fim de partida', naosei: 'Ainda não sei' };
const STATUS = ['novo', 'lido', 'resolvido'];
const LIMITE_POR_HORA = 6;
const MESAS_POR_HORA = 20;

// 28/10: as listas iguais para todos (mesas ao vivo, mesa rápida) ficam alguns segundos guardadas no próprio Worker:
// a pergunta de cada celular não acorda a fila. No teste local, CACHE_LISTA_MS (ou CACHE_VIVO_MS) muda o tempo.
const LISTAS = new Map();
async function daFila(env, caminho) {
  const f = Number(env.TEMPO_FATOR) || 1;
  const ms = env.CACHE_LISTA_MS != null ? Number(env.CACHE_LISTA_MS) : env.CACHE_VIVO_MS != null ? Number(env.CACHE_VIVO_MS) : f < 1 ? 0 : 8000;
  const agora = Date.now(), c = LISTAS.get(caminho);
  if (c && agora - c.t < ms) return c.v;
  const v = await (await env.MESA.get(env.MESA.idFromName('fila')).fetch('https://mesa' + caminho)).json();
  LISTAS.set(caminho, { t: agora, v });
  return v;
}
const origemOk = origin => origin === SITE || /^http:\/\/localhost(:\d+)?$/.test(origin || '');
function cors(origin) {
  const ok = origemOk(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : SITE,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-admin-key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, cors(origin))
  });
}
async function sha256(txt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Texto limpo: sem caracteres de controle, espaços normais, tamanho máximo.
function limpa(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}
async function ehDono(req, env) {
  const k = req.headers.get('x-admin-key') || '';
  if (!k || !env.ADMIN_HASH) return false;
  return (await sha256(k)) === env.ADMIN_HASH;
}

// Limite contra spam: por endereço de rede, sem guardar o endereço (só um resumo que muda todo dia).
async function marcaDoDia(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'sem-ip';
  const dia = new Date().toISOString().slice(0, 10);
  return (await sha256(ip + '|' + dia + '|' + (env.ADMIN_HASH || ''))).slice(0, 24);
}

// ---- Mesa online: cria uma mesa com código de 5 números (cada mesa é um Durable Object) ----
async function novaMesa(req, env, origin) {
  let b;
  try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  if (await bloqueado(env, b && b.id)) return json({ erro: 'bloqueado' }, 403, origin);
  if (await apelidoBarrado(env, b && b.id, b && b.nome)) return json({ erro: 'apelido' }, 403, origin);   // 3.41
  // 3.41: só pelo app aberto (robôs de fora não passam)
  if (exigeApp(env) && (!origemOk(origin) || !(await appAberto(env, b && b.id)))) { await anotarRitmo(env, b && b.id, { semApp: 1 }); return json({ erro: 'app' }, 403, origin); }
  const marca = await marcaDoDia(req, env);
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM mesas_criadas WHERE marca = ? AND criado_em > ?').bind(marca, Date.now() - 3600000).first();
  if (r && r.n >= MESAS_POR_HORA) return json({ erro: 'muitas' }, 429, origin);
  for (let k = 0; k < 8; k++) {
    const codigo = String(10000 + Math.floor(Math.random() * 90000));
    const stub = env.MESA.get(env.MESA.idFromName(codigo));
    const res = await stub.fetch('https://mesa/criar', { method: 'POST', body: JSON.stringify({ id: b.id, nome: b.nome, av: b.av, nv: b.nv, codigo }) });
    if (res.status === 201) {
      try { await env.DB.prepare('INSERT INTO mesas_criadas (marca, criado_em) VALUES (?, ?)').bind(marca, Date.now()).run(); } catch (e) {}   // limite do banco: a mesa vale assim mesmo
      return json({ codigo }, 201, origin);
    }
    if (res.status === 400) return json({ erro: 'dados' }, 400, origin);
  }
  return json({ erro: 'tente-de-novo' }, 503, origin);
}
// ---- Mesa rápida: a fila junta quem quer jogar com qualquer um (e cria mesa pública quando precisa) ----
async function mesaRapida(req, env, origin) {
  let b;
  try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  if (await bloqueado(env, b && b.id)) return json({ erro: 'bloqueado' }, 403, origin);
  if (await apelidoBarrado(env, b && b.id, b && b.nome)) return json({ erro: 'apelido' }, 403, origin);   // 3.41
  // 3.41: só pelo app aberto (robôs de fora não passam)
  if (exigeApp(env) && (!origemOk(origin) || !(await appAberto(env, b && b.id)))) { await anotarRitmo(env, b && b.id, { semApp: 1 }); return json({ erro: 'app' }, 403, origin); }
  const marca = await marcaDoDia(req, env);
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM mesas_criadas WHERE marca = ? AND criado_em > ?').bind(marca, Date.now() - 3600000).first();
  if (r && r.n >= MESAS_POR_HORA) return json({ erro: 'muitas' }, 429, origin);
  const res = await env.MESA.get(env.MESA.idFromName('fila')).fetch('https://mesa/fila', { method: 'POST',
    body: JSON.stringify({ id: b.id, nome: b.nome, av: b.av, bairro: b.bairro, nv: b.nv }) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 201) { try { await env.DB.prepare('INSERT INTO mesas_criadas (marca, criado_em) VALUES (?, ?)').bind(marca, Date.now()).run(); } catch (e) {} }
  return json(j, res.status === 201 ? 200 : res.status, origin);
}
async function rotaMesa(req, env, origin, codigo, ws) {
  const stub = env.MESA.get(env.MESA.idFromName(codigo));
  if (ws) {
    if ((req.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return json({ erro: 'ws' }, 426, origin);
    if ((origin || exigeApp(env)) && !origemOk(origin)) return new Response('origem', { status: 403 });   // 3.41: sem o app (sem origem), não entra
    return stub.fetch(req);
  }
  const r = await stub.fetch('https://mesa/info');
  return json(await r.json(), 200, origin);
}

// ---- Anuncie no jogo: formulário de quem quer patrocinar (cai na caixa do dono como "patrocinio") ----
async function receberPatrocinio(req, env, origin) {
  let b;
  try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  const empresa = limpa(b.empresa, 60), nome = limpa(b.nome, 40), cidade = limpa(b.cidade, 40), ramo = limpa(b.ramo, 60);
  const zap = limpa(b.whatsapp, 24), dig = zap.replace(/\D/g, ''), email = limpa(b.email, 80), msg = limpa(b.mensagem, 600);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (empresa.length < 2 || nome.length < 2) return json({ erro: 'dados' }, 400, origin);
  if ((dig.length < 10 || dig.length > 13) && !emailOk) return json({ erro: 'contato' }, 400, origin);
  if (b.aceite !== true) return json({ erro: 'aceite' }, 400, origin);
  const interesses = (Array.isArray(b.interesse) ? b.interesse : []).filter(x => INTERESSES[x]).slice(0, 4).map(x => INTERESSES[x]);
  const marca = await marcaDoDia(req, env);
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM mensagens WHERE marca = ? AND criado_em > ?').bind(marca, Date.now() - 3600000).first();
  if (r && r.n >= LIMITE_POR_HORA) return json({ erro: 'muitas' }, 429, origin);
  const texto = [`Empresa: ${empresa}`, ramo && `Ramo: ${ramo}`, cidade && `Cidade: ${cidade}`, interesses.length && `Interesse: ${interesses.join(', ')}`,
    dig.length >= 10 && `WhatsApp: ${zap}`, emailOk && `E-mail: ${email}`, msg && `Mensagem: ${msg}`].filter(Boolean).join('\n');
  await env.DB.prepare(
    'INSERT INTO mensagens (criado_em, tipo, texto, nome, contato, versao, aparelho, marca, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(Date.now(), 'patrocinio', texto, nome, dig.length >= 10 ? zap : email, limpa(b.versao, 12), limpa(b.aparelho, 80), marca, 'novo').run();
  return json({ ok: true }, 201, origin);
}

async function receberMensagem(req, env, origin) {
  let b;
  try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  const texto = limpa(b.texto, 1000);
  if (texto.length < 3) return json({ erro: 'texto-curto' }, 400, origin);
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'outro';
  const marca = await marcaDoDia(req, env);
  const desde = Date.now() - 60 * 60 * 1000;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM mensagens WHERE marca = ? AND criado_em > ?').bind(marca, desde).first();
  if (r && r.n >= LIMITE_POR_HORA) return json({ erro: 'muitas' }, 429, origin);
  await env.DB.prepare(
    'INSERT INTO mensagens (criado_em, tipo, texto, nome, contato, versao, aparelho, marca, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(Date.now(), tipo, texto, limpa(b.nome, 20), limpa(b.contato, 60), limpa(b.versao, 12), limpa(b.aparelho, 80), marca, 'novo').run();
  return json({ ok: true }, 201, origin);
}

async function listarMensagens(req, env, origin, url) {
  if (!(await ehDono(req, env))) return json({ erro: 'nao-autorizado' }, 401, origin);
  const filtro = url.searchParams.get('status');
  const CAMPOS = 'SELECT id, criado_em, tipo, texto, nome, contato, versao, aparelho, status FROM mensagens';
  const q = filtro === 'patrocinio'
    ? env.DB.prepare(`${CAMPOS} WHERE tipo = 'patrocinio' AND status != 'apagado' ORDER BY criado_em DESC LIMIT 200`)
    : filtro && STATUS.includes(filtro)
    ? env.DB.prepare(`${CAMPOS} WHERE status = ? ORDER BY criado_em DESC LIMIT 200`).bind(filtro)
    : env.DB.prepare(`${CAMPOS} WHERE status != 'apagado' ORDER BY criado_em DESC LIMIT 200`);
  const { results } = await q.all();
  const novas = await env.DB.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE status = 'novo'").first();
  const patro = await env.DB.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE status = 'novo' AND tipo = 'patrocinio'").first();
  return json({ mensagens: results || [], novas: (novas && novas.n) || 0, patrocinios: (patro && patro.n) || 0 }, 200, origin);
}

// ---- Lembretes para jogar (Web Push) ----
const LEMBRETES = [
  { titulo: 'A mesa tá montada', texto: 'A turma do bairro tá te esperando. Bora uma partida?' },
  { titulo: 'Tá de bubuia?', texto: 'Então bora uma partidinha de dominó. A turma tá esperando.' },
  { titulo: 'Tá brocado?', texto: 'Pega um X‑caboquinho e vem pra mesa. A turma tá esperando.' },
  { titulo: 'A turma mandou avisar', texto: 'Disseram que hoje ninguém ganha deles. Vai deixar?' },
  { titulo: 'Bora bater uma?', texto: 'Uma partidinha de dominó antes da janta.' },
  { titulo: 'Cadê você?', texto: 'A turma já embaralhou as pedras. Só falta você na mesa.' },
  { titulo: 'Hoje tem galo?', texto: 'Faz tempo que você não aplica um galo. Bora tentar?' },
  { titulo: 'Partida rápida', texto: 'Cinco minutinhos de dominó para relaxar. A mesa é sua.' },
  { titulo: 'A turma tá folgada', texto: 'Dizem que você correu da mesa. Mostra pra eles.' }
];
const DIA = 24 * 60 * 60 * 1000;
function validaInscricao(b) {
  const sub = b && b.sub, k = sub && sub.keys;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return null;
  if (!k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 60) return null;
  return { endpoint: sub.endpoint, p256dh: k.p256dh, auth: k.auth };
}
async function avisosInscrever(req, env, origin) {
  let b; try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  const s = validaInscricao(b); if (!s) return json({ erro: 'inscricao' }, 400, origin);
  await env.DB.prepare(`INSERT INTO avisos (endpoint, p256dh, auth, aparelho, criado_em, ultimo_jogo) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, aparelho = excluded.aparelho`)
    .bind(s.endpoint, s.p256dh, s.auth, limpa(b.aparelho, 80), Date.now(), Date.now()).run();
  // código do aparelho (o mesmo do plano): só para avisar quando o Plano Apoiador estiver acabando
  if (/^[a-z0-9-]{8,40}$/i.test(String(b.id || '')))
    await env.DB.prepare('INSERT INTO avisos_id (endpoint, aparelho) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET aparelho = excluded.aparelho').bind(s.endpoint, String(b.id)).run();
  return json({ ok: true }, 201, origin);
}
async function avisosCancelar(req, env, origin) {
  let b; try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  if (typeof (b && b.endpoint) !== 'string') return json({ erro: 'formato' }, 400, origin);
  await env.DB.prepare('DELETE FROM avisos WHERE endpoint = ?').bind(b.endpoint).run();
  await env.DB.prepare('DELETE FROM avisos_id WHERE endpoint = ?').bind(b.endpoint).run();
  return json({ ok: true }, 200, origin);
}
async function avisosJogou(req, env, origin) {
  let b; try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  if (typeof (b && b.endpoint) !== 'string') return json({ erro: 'formato' }, 400, origin);
  await env.DB.prepare('UPDATE avisos SET ultimo_jogo = ? WHERE endpoint = ?').bind(Date.now(), b.endpoint).run();
  return json({ ok: true }, 200, origin);
}
// 3.41: caixa de notificações. Guarda a mensagem uma vez (a chave evita repetir o aviso do mesmo evento no mesmo dia)
// e devolve o número dela, que vai junto na notificação (o celular não mostra duas vezes a mesma na caixa).
async function guardarNaCaixa(env, chave, msg) {
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO caixa (chave, titulo, texto, url, em) VALUES (?, ?, ?, ?, ?)')
      .bind(chave, String(msg.titulo || 'Dominó Manauara').slice(0, 80), String(msg.texto || '').slice(0, 240), String(msg.url || '/').slice(0, 120), Date.now()).run();
    const r = chave ? await env.DB.prepare('SELECT id FROM caixa WHERE chave = ?').bind(chave).first()
      : await env.DB.prepare('SELECT id FROM caixa ORDER BY id DESC LIMIT 1').first();
    return r ? r.id : null;
  } catch (e) { return null; }
}
// GET /caixa -> as mensagens dos últimos 30 dias (no máximo 30)
async function caixaLista(env, origin) {
  let lista = [];
  try { const { results } = await env.DB.prepare('SELECT id, titulo, texto, url, em FROM caixa WHERE em > ? ORDER BY id DESC LIMIT 30').bind(Date.now() - 30 * DIA).all(); lista = results || []; } catch (e) {}
  return json({ lista }, 200, origin);
}
// Manda para uma lista e limpa as inscrições que o navegador já desativou.
async function mandarPara(lista, msgDe, env) {
  let ok = 0, falhas = 0;
  for (const s of lista) {
    let st = 0;
    try { st = await enviarPush(s, msgDe(s), env); } catch (e) { st = 0; }
    // 3.41: escrita que falha (limite do dia do banco) não interrompe mais o envio para o resto da lista
    if (st === 404 || st === 410) {
      try { await env.DB.prepare('DELETE FROM avisos WHERE id = ?').bind(s.id).run(); await env.DB.prepare('DELETE FROM avisos_id WHERE endpoint = ?').bind(s.endpoint).run(); } catch (e) {}
    }
    if (st >= 200 && st < 300) {
      ok++;
      try { await env.DB.prepare('UPDATE avisos SET ultimo_envio = ?, envios = envios + 1 WHERE id = ?').bind(Date.now(), s.id).run(); } catch (e) {}
    } else falhas++;
  }
  return { ok, falhas };
}
// Lembrete automático: só para quem não joga há 2 dias, no máximo um a cada 3 dias.
async function lembretesDoDia(env) {
  // faxina: registros do limite de mesas com mais de 2 dias
  try { await env.DB.prepare('DELETE FROM mesas_criadas WHERE criado_em < ?').bind(Date.now() - 2 * 86400000).run(); } catch (e) {}
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return { ok: 0, falhas: 0, motivo: 'sem-chaves' };
  const agora = Date.now();
  const { results } = await env.DB.prepare(`SELECT id, endpoint, p256dh, auth FROM avisos
    WHERE COALESCE(ultimo_jogo, criado_em) < ? AND COALESCE(ultimo_envio, 0) < ? ORDER BY COALESCE(ultimo_envio, 0) LIMIT 15`)
    .bind(agora - 2 * DIA, agora - 3 * DIA).all();
  const dia = Math.floor(agora / DIA);
  return mandarPara(results || [], s => Object.assign({ url: '/' }, LEMBRETES[(dia + s.id) % LEMBRETES.length]), env);
}
// Avisos de evento: um aviso para todo mundo que ligou os lembretes (no máximo um por aparelho no dia), mesmo quem jogou
// ontem. 3.37.2: saem de manhã (9h, 10h e 11h em Manaus) e o que faltar sai no fim da tarde, junto com os lembretes.
//   datas especiais (24/10, aniversário de Manaus)
//   o primeiro dia do Desafio das Confrarias (1º/11)
//   toda segunda-feira, o Rei da Calçada: o Rei recebe "Você é o Rei" e os outros, "Tem Rei novo" (sem nome de ninguém)
// Plano grátis do Cloudflare: no máximo 50 envios para fora por rodada (somando os lembretes e o plano), por isso cada
// rodada manda poucos e a seguinte continua de onde parou.
const DATAS = {
  '2026-10-24': { titulo: 'Manaus faz 357 anos hoje!', texto: 'Parabéns, Manaus! Bora celebrar com uma partida de dominó.' }
};
export const EVENTO_POR_RODADA = { manha: 45, tarde: 15 };   // à tarde: + plano (até 8 + 6) + lembretes (15) + Asaas (1) = 45 de 50
const MANAUS_MS = 4 * 3600000;
const diaManaus = t => new Date(t - MANAUS_MS).toISOString().slice(0, 10);
const diaMesDe = t => { const d = new Date(t - MANAUS_MS); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
export const AVISO_REI = { titulo: 'Você é o Rei da Calçada! 👑', texto: 'Você foi o 1º da semana. A coroa fica no seu avatar na mesa online até domingo. Bora defender?', url: '/?abrir=ranking' };
export async function eventoDoDia(env, agora) {
  const hoje = diaManaus(agora);
  if (DATAS[hoje]) return { tipo: 'data', msg: Object.assign({ url: '/' }, DATAS[hoje]) };
  const ed = turmas.edicao(env, agora);
  if (diaManaus(ed.inicio) === hoje) return { tipo: 'desafio', msg: { titulo: 'Começou o Desafio das Confrarias!', texto: `Até ${diaMesDe(ed.fim - 1)}, cada vitória online contra outra Turma vale ponto para a sua. Junte a turma e bora!`, url: '/?abrir=turma' } };
  if (new Date(agora - MANAUS_MS).getUTCDay() === 1) {
    let rei = null; try { rei = await rk.reiDaSemana(env); } catch (e) {}
    if (rei) return { tipo: 'rei', rei, msg: { titulo: 'Tem Rei novo na Calçada 👑', texto: 'Veja quem levou a coroa da semana. Ganhe partidas online e a próxima pode ser sua.', url: '/?abrir=ranking' } };
  }
  return null;
}
async function lembreteDaData(env, limite, agora) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return null;
  agora = agora || Date.now(); limite = limite || EVENTO_POR_RODADA.tarde;
  const ev = await eventoDoDia(env, agora);
  if (!ev) return null;
  const inicio = Date.parse(diaManaus(agora) + 'T00:00:00-04:00');
  let ok = 0, falhas = 0;
  if (ev.tipo === 'rei') {
    // o Rei primeiro (todos os aparelhos dele que ligaram os lembretes), com o aviso dele
    const { results } = await env.DB.prepare(`SELECT a.id, a.endpoint, a.p256dh, a.auth FROM avisos a JOIN avisos_id i ON i.endpoint = a.endpoint
      WHERE i.aparelho = ? AND COALESCE(a.ultimo_envio, 0) < ? LIMIT 3`).bind(ev.rei.aparelho, inicio).all();
    const r = await mandarPara(results || [], () => AVISO_REI, env);
    ok += r.ok; falhas += r.falhas; limite -= (results || []).length;
  }
  const { results } = ev.tipo === 'rei'
    ? await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM avisos WHERE COALESCE(ultimo_envio, 0) < ? AND endpoint NOT IN (SELECT endpoint FROM avisos_id WHERE aparelho = ?) ORDER BY RANDOM() LIMIT ?')
      .bind(inicio, ev.rei.aparelho, Math.max(0, limite)).all()
    : await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM avisos WHERE COALESCE(ultimo_envio, 0) < ? ORDER BY RANDOM() LIMIT ?').bind(inicio, Math.max(0, limite)).all();
  const caixa = await guardarNaCaixa(env, 'ev:' + diaManaus(agora) + ':' + ev.tipo, ev.msg);   // 3.41: também na caixa do app
  const r = await mandarPara(results || [], () => Object.assign({ id: caixa }, ev.msg), env);
  return { tipo: ev.tipo, ok: ok + r.ok, falhas: falhas + r.falhas };
}
// Plano Apoiador acabando (até 3 dias antes): um aviso por vencimento, só para quem ligou os lembretes.
const diaMes = ms => { const d = new Date(ms - 4 * 3600000); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
async function lembretesPlano(env) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return { ok: 0, falhas: 0, motivo: 'sem-chaves' };
  const agora = Date.now();
  const { results } = await env.DB.prepare(`SELECT a.id, a.endpoint, a.p256dh, a.auth, p.aparelho, p.ate FROM planos p
    JOIN avisos_id i ON i.aparelho = p.aparelho JOIN avisos a ON a.endpoint = i.endpoint
    WHERE p.ate > ? AND p.ate <= ? AND NOT EXISTS (SELECT 1 FROM lembretes_plano l WHERE l.aparelho = p.aparelho AND l.ate = p.ate)
    ORDER BY p.ate LIMIT 8`).bind(agora, agora + 3 * DIA).all();
  const lista = results || [];
  for (const s of lista) await env.DB.prepare('INSERT OR IGNORE INTO lembretes_plano (aparelho, ate, enviado_em) VALUES (?, ?, ?)').bind(s.aparelho, s.ate, agora).run();
  const r1 = await mandarPara(lista, s => ({ titulo: 'Seu tempo de Apoiador está acabando', texto: `Ele vale até ${diaMes(s.ate)}. Toque para continuar com a foto na mesa e os extras.`, url: '/?apoio=renovar' }), env);
  // 3.38: no dia em que acaba (nas últimas 24 horas), mais um aviso, também um por vencimento
  const { results: fim } = await env.DB.prepare(`SELECT a.id, a.endpoint, a.p256dh, a.auth, p.aparelho, p.ate FROM planos p
    JOIN avisos_id i ON i.aparelho = p.aparelho JOIN avisos a ON a.endpoint = i.endpoint
    WHERE p.ate > 0 AND p.ate <= ? AND p.ate > ? AND NOT EXISTS (SELECT 1 FROM lembretes_plano_fim l WHERE l.aparelho = p.aparelho AND l.ate = p.ate)
    ORDER BY p.ate LIMIT 6`).bind(agora, agora - DIA).all();
  const lf = fim || [];
  for (const s of lf) await env.DB.prepare('INSERT OR IGNORE INTO lembretes_plano_fim (aparelho, ate, enviado_em) VALUES (?, ?, ?)').bind(s.aparelho, s.ate, agora).run();
  const r2 = await mandarPara(lf, () => ({ titulo: 'Seu tempo de Apoiador acabou', texto: 'Renove para voltar com a foto na mesa, o selo ★ e os avatares exclusivos. A tradição agradece!', url: '/?apoio=renovar' }), env);
  return { ok: r1.ok + r2.ok, falhas: r1.falhas + r2.falhas, fim: r2.ok };
}
async function donoAvisos(req, env, origin) {
  if (!(await ehDono(req, env))) return json({ erro: 'nao-autorizado' }, 401, origin);
  const r = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(envios) AS envios FROM avisos').first();
  return json({ inscritos: (r && r.n) || 0, envios: (r && r.envios) || 0, pronto: !!(env.VAPID_PRIVATE_JWK && env.VAPID_PUBLIC) }, 200, origin);
}
// O dono manda uma mensagem para todo mundo, aos poucos (15 por vez, por causa do limite do plano grátis).
async function donoAvisosEnviar(req, env, origin) {
  if (!(await ehDono(req, env))) return json({ erro: 'nao-autorizado' }, 401, origin);
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return json({ erro: 'sem-chaves' }, 503, origin);
  let b; try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  const titulo = limpa(b.titulo, 60), texto = limpa(b.texto, 180), depois = Number(b.depois) || 0;
  if (!titulo || !texto) return json({ erro: 'texto' }, 400, origin);
  // 3.41: a mensagem vai também para a caixa de notificações do app (uma vez, no primeiro lote)
  const caixa = depois ? (Number(b.caixa) || null) : await guardarNaCaixa(env, null, { titulo, texto, url: '/' });
  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM avisos WHERE id > ? ORDER BY id LIMIT 15').bind(depois).all();
  const lista = results || [];
  const r = await mandarPara(lista, () => ({ id: caixa, titulo, texto, url: '/' }), env);
  return json(Object.assign(r, { caixa, proximo: lista.length === 15 ? lista[lista.length - 1].id : null }), 200, origin);
}

async function mudarStatus(req, env, origin, id) {
  if (!(await ehDono(req, env))) return json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  const st = b.status === 'apagado' ? 'apagado' : STATUS.includes(b.status) ? b.status : null;
  if (!st) return json({ erro: 'status' }, 400, origin);
  if (st === 'apagado') await env.DB.prepare('DELETE FROM mensagens WHERE id = ?').bind(id).run();
  else await env.DB.prepare('UPDATE mensagens SET status = ? WHERE id = ?').bind(st, id).run();
  return json({ ok: true }, 200, origin);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    try {
      if (url.pathname === '/saude') return json({ ok: true, servico: 'dominomanauara', mesa: !!env.MESA, pagamentos: !!env.ASAAS_API_KEY, ia: !!env.AI, versao: env.VERSAO || null }, 200, origin);
      if (url.pathname === '/mesa/nova' && req.method === 'POST') return await novaMesa(req, env, origin);
      if (url.pathname === '/mesa/rapida' && req.method === 'POST') return await mesaRapida(req, env, origin);
      if (url.pathname === '/mesa/rapida/status' && req.method === 'GET') {
        return json(await daFila(env, '/fila/status'), 200, origin);
      }
      const mc = url.pathname.match(/^\/mesa\/(\d{5})(\/ws)?$/);
      if (mc && req.method === 'GET') return await rotaMesa(req, env, origin, mc[1], !!mc[2]);
      if (url.pathname === '/mensagens' && req.method === 'POST') return await receberMensagem(req, env, origin);
      if (url.pathname === '/patrocinio' && req.method === 'POST') return await receberPatrocinio(req, env, origin);
      // Plano Apoiador e doações (Asaas)
      const H = { json, marcaDoDia, ehDono, SITE };
      if (url.pathname === '/saude/ia' && req.method === 'GET') return await fotos.saudeIA(env, origin, H);
      if ((url.pathname === '/turma' || url.pathname === '/desafio') && req.method === 'GET') return await turmas.ver(env, origin, H, url);
      if (url.pathname === '/turma/nova' && req.method === 'POST') return await turmas.nova(req, env, origin, H);
      if (url.pathname === '/turma/entrar' && req.method === 'POST') return await turmas.entrar(req, env, origin, H);
      if (url.pathname === '/turma/sair' && req.method === 'POST') return await turmas.sair(req, env, origin, H);
      if (url.pathname === '/pagar' && req.method === 'POST') return await pagar(req, env, origin, H);
      const pd = url.pathname.match(/^\/pedido\/([0-9a-f]{20})$/);
      if (pd && req.method === 'GET') return await pedido(env, origin, H, pd[1]);
      if (url.pathname === '/plano' && req.method === 'GET') return await plano(env, origin, H, url);
      if (url.pathname === '/plano/trazer' && req.method === 'POST') return await trazerPlano(req, env, origin, H);
      if (url.pathname === '/progresso' && req.method === 'POST') return await guardarProgresso(req, env, origin, H);   // 3.39
      if (url.pathname === '/progresso' && req.method === 'GET') return await verProgresso(env, origin, H, url);
      if (url.pathname === '/asaas/webhook' && req.method === 'POST') return await webhook(req, env, origin, H);
      if (url.pathname === '/dono/pagamentos' && req.method === 'GET') return await donoPagamentos(req, env, origin, H);
      if (url.pathname === '/dono/apoiadores' && req.method === 'GET') return await donoApoiadores(req, env, origin, H);   // 3.41
      if (url.pathname === '/dono/cortesia' && req.method === 'POST') return await donoCortesia(req, env, origin, H);
      if (url.pathname === '/dono/jogadores' && req.method === 'GET') return await donoJogadores(req, env, origin, H);
      if (url.pathname === '/dono/bloquear' && req.method === 'POST') return await donoBloquear(req, env, origin, H);
      if (url.pathname === '/dono/desbloquear' && req.method === 'POST') return await donoDesbloquear(req, env, origin, H);
      if (url.pathname === '/dono/papo' && req.method === 'GET') return await donoPapo(req, env, origin, H);   // 3.42: papo denunciado
      if (url.pathname === '/dono/papo/apagar' && req.method === 'POST') return await donoPapoApagar(req, env, origin, H);
      if (url.pathname === '/dono/apelido' && req.method === 'POST') return await donoApelido(req, env, origin, H);   // 3.41
      if (url.pathname === '/dono/robos' && req.method === 'GET') return await donoRobos(req, env, origin, H);   // 3.41
      const dv = url.pathname.match(/^\/dono\/pagamentos\/([0-9a-f]{20})\/devolver$/);
      if (dv && req.method === 'POST') return await donoDevolver(req, env, origin, H, dv[1]);
      // Foto na mesa online (Plano Apoiador)
      if (url.pathname === '/foto' && req.method === 'POST') return await fotos.enviar(req, env, origin, H);
      if (url.pathname === '/foto/status' && req.method === 'GET') return await fotos.status(env, origin, H, url, ctx);
      if (url.pathname === '/foto/apagar' && req.method === 'POST') return await fotos.apagar(req, env, origin, H);
      if (url.pathname === '/foto/denunciar' && req.method === 'POST') return await fotos.denunciar(req, env, origin, H, ctx);
      const fi = url.pathname.match(/^\/foto\/([0-9a-f]{16})$/);
      if (fi && req.method === 'GET') return await fotos.imagem(env, fi[1]);
      if (url.pathname === '/dono/fotos' && req.method === 'GET') return await fotos.donoLista(req, env, origin, H);
      const fd = url.pathname.match(/^\/dono\/fotos\/([0-9a-f]{16})$/);
      if (fd && req.method === 'POST') return await fotos.donoDecidir(req, env, origin, H, fd[1]);
      // Patrocinadores
      const HP = { json, ehDono, limpa };
      if (url.pathname === '/patrocinio/atual' && req.method === 'GET') return await atuais(req, env, origin, HP);
      const pi = url.pathname.match(/^\/patro\/img\/(\d+)$/);
      if (pi && req.method === 'GET') return await imagem(env, Number(pi[1]));
      if (url.pathname === '/patro/contar' && req.method === 'POST') return await contar(req, env, origin, HP);
      if (url.pathname === '/dono/patrocinadores' && req.method === 'GET') return await donoLista(req, env, origin, HP, url);
      if (url.pathname === '/dono/patrocinadores' && req.method === 'POST') return await donoSalvar(req, env, origin, HP);
      if (url.pathname === '/dono/patro-img' && req.method === 'POST') return await donoImagem(req, env, origin, HP);
      const pa = url.pathname.match(/^\/dono\/patrocinadores\/(\d+)\/apagar$/);
      if (pa && req.method === 'POST') return await donoApagar(req, env, origin, HP, Number(pa[1]));
      // "Hoje no Dominó Manauara": números do dia
      if (url.pathname === '/presenca' && req.method === 'POST') return await presenca.avisar(req, env, origin, H);
      // Ranking da calçada (3.29)
      if (url.pathname === '/ranking' && req.method === 'GET') return await rk.ranking(req, env, origin, H, url);
      if (url.pathname === '/ranking/fora' && req.method === 'POST') return await rk.sairDoRanking(req, env, origin, H);
      if (url.pathname === '/dono/presenca' && req.method === 'GET') return await presenca.donoPresenca(req, env, origin, H);
      if (url.pathname === '/vivo/hoje' && req.method === 'GET') return await vivo.hoje(env, origin, H);
      if (url.pathname === '/dono/mesas' && req.method === 'GET') {
        if (!(await ehDono(req, env))) return json({ erro: 'nao-autorizado' }, 401, origin);
        const r = await env.MESA.get(env.MESA.idFromName('fila')).fetch('https://mesa/fila/vivo?todas=1'); return json(await r.json(), 200, origin);
      }
      if (url.pathname === '/vivo/mesas' && req.method === 'GET') return json(await daFila(env, '/fila/vivo'), 200, origin);
      if (url.pathname === '/vivo/conta' && req.method === 'POST') return await vivo.conta(req, env, origin, H);
      if (url.pathname === '/caixa' && req.method === 'GET') return await caixaLista(env, origin);   // 3.41
      if (url.pathname === '/avisos/chave' && req.method === 'GET') return json({ chave: env.VAPID_PUBLIC || null }, env.VAPID_PUBLIC ? 200 : 503, origin);
      if (url.pathname === '/avisos/inscrever' && req.method === 'POST') return await avisosInscrever(req, env, origin);
      if (url.pathname === '/avisos/cancelar' && req.method === 'POST') return await avisosCancelar(req, env, origin);
      if (url.pathname === '/avisos/jogou' && req.method === 'POST') return await avisosJogou(req, env, origin);
      if (url.pathname === '/dono/avisos' && req.method === 'GET') return await donoAvisos(req, env, origin);
      if (url.pathname === '/dono/avisos/enviar' && req.method === 'POST') return await donoAvisosEnviar(req, env, origin);
      if (url.pathname === '/dono/mensagens' && req.method === 'GET') return await listarMensagens(req, env, origin, url);
      const m = url.pathname.match(/^\/dono\/mensagens\/(\d+)$/);
      if (m && req.method === 'POST') return await mudarStatus(req, env, origin, Number(m[1]));
      return json({ erro: 'nao-encontrado' }, 404, origin);
    } catch (e) {
      // Registro do erro (só o caminho e a mensagem, sem dados de jogador) para enxergar a causa nos logs.
      try { console.error('falha', url.pathname, (e && e.name) || '', String((e && e.message) || e).slice(0, 300)); } catch (x) {}
      return json({ erro: 'servidor' }, 500, origin);
    }
  },
  // Agendado (Cron do Cloudflare): lembretes no fim da tarde de Manaus (e a leitura diária que mantém a chave do Asaas ativa).
  // 3.37.2: de manhã (9h às 11h em Manaus) só os avisos de evento (data especial, Desafio, Rei da Calçada).
  async scheduled(evento, env, ctx) {
    const hora = new Date((evento && evento.scheduledTime) || Date.now()).getUTCHours();
    if (hora >= 12 && hora < 18) { ctx.waitUntil((async () => { try { await lembreteDaData(env, EVENTO_POR_RODADA.manha); } catch (e) {} })()); return; }
    ctx.waitUntil((async () => { try { await lembretesPlano(env); } catch (e) {} try { await lembreteDaData(env, EVENTO_POR_RODADA.tarde); } catch (e) {} try { await fotos.moderarPendentes(env); } catch (e) {} try { await turmas.fecharDesafio(env); } catch (e) {} try { await manterChaveAsaas(env); } catch (e) {} try { await vivo.limparVivo(env); } catch (e) {} try { await limparVistos(env); } catch (e) {} try { await presenca.limparPresenca(env); } catch (e) {} await lembretesDoDia(env);  try { await rk.limparRanking(env); } catch (e) {} })());
  }
};
export { lembretesDoDia, lembretesPlano, lembreteDaData };
