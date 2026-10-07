// Servidor do Dominó Manauara (Cloudflare Workers + D1 + Durable Objects).
// Caixa de mensagens "Fale com a gente", lembretes para jogar (Web Push), painel do dono e mesa online por convite.
import { enviarPush } from './webpush.js';
import { Mesa } from './mesa.js';
import { pagar, pedido, plano, trazerPlano, webhook, donoPagamentos } from './pagamentos.js';
import { atuais, imagem, contar, donoLista, donoImagem, donoSalvar, donoApagar } from './patrocinadores.js';
export { Mesa };

const SITE = 'https://dominomanauara.com.br';
const TIPOS = ['problema', 'ideia', 'elogio', 'outro'];
const INTERESSES = { banner: 'Banner no início', mesa: 'Mesa com a marca', fim: 'Fim de partida', naosei: 'Ainda não sei' };
const STATUS = ['novo', 'lido', 'resolvido'];
const LIMITE_POR_HORA = 6;
const MESAS_POR_HORA = 20;

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
  const marca = await marcaDoDia(req, env);
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM mesas_criadas WHERE marca = ? AND criado_em > ?').bind(marca, Date.now() - 3600000).first();
  if (r && r.n >= MESAS_POR_HORA) return json({ erro: 'muitas' }, 429, origin);
  for (let k = 0; k < 8; k++) {
    const codigo = String(10000 + Math.floor(Math.random() * 90000));
    const stub = env.MESA.get(env.MESA.idFromName(codigo));
    const res = await stub.fetch('https://mesa/criar', { method: 'POST', body: JSON.stringify({ id: b.id, nome: b.nome, av: b.av, codigo }) });
    if (res.status === 201) {
      await env.DB.prepare('INSERT INTO mesas_criadas (marca, criado_em) VALUES (?, ?)').bind(marca, Date.now()).run();
      return json({ codigo }, 201, origin);
    }
    if (res.status === 400) return json({ erro: 'dados' }, 400, origin);
  }
  return json({ erro: 'tente-de-novo' }, 503, origin);
}
async function rotaMesa(req, env, origin, codigo, ws) {
  const stub = env.MESA.get(env.MESA.idFromName(codigo));
  if (ws) {
    if ((req.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return json({ erro: 'ws' }, 426, origin);
    if (origin && !origemOk(origin)) return new Response('origem', { status: 403 });
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
  { titulo: 'Seu Raimundo mandou avisar', texto: 'Disse que hoje ninguém ganha dele. Vai deixar?' },
  { titulo: 'Bora bater uma?', texto: 'Uma partidinha de dominó antes da janta.' },
  { titulo: 'Cadê você?', texto: 'Dona Socorro já embaralhou as pedras. Só falta você na mesa.' },
  { titulo: 'Hoje tem galo?', texto: 'Faz tempo que você não aplica um galo. Bora tentar?' },
  { titulo: 'Partida rápida', texto: 'Cinco minutinhos de dominó para relaxar. A mesa é sua.' },
  { titulo: 'O Tonhão tá folgado', texto: 'Ele diz que você correu da mesa. Mostra pra ele.' }
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
  return json({ ok: true }, 201, origin);
}
async function avisosCancelar(req, env, origin) {
  let b; try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  if (typeof (b && b.endpoint) !== 'string') return json({ erro: 'formato' }, 400, origin);
  await env.DB.prepare('DELETE FROM avisos WHERE endpoint = ?').bind(b.endpoint).run();
  return json({ ok: true }, 200, origin);
}
async function avisosJogou(req, env, origin) {
  let b; try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  if (typeof (b && b.endpoint) !== 'string') return json({ erro: 'formato' }, 400, origin);
  await env.DB.prepare('UPDATE avisos SET ultimo_jogo = ? WHERE endpoint = ?').bind(Date.now(), b.endpoint).run();
  return json({ ok: true }, 200, origin);
}
// Manda para uma lista e limpa as inscrições que o navegador já desativou.
async function mandarPara(lista, msgDe, env) {
  let ok = 0, falhas = 0;
  for (const s of lista) {
    let st = 0;
    try { st = await enviarPush(s, msgDe(s), env); } catch (e) { st = 0; }
    if (st === 404 || st === 410) await env.DB.prepare('DELETE FROM avisos WHERE id = ?').bind(s.id).run();
    if (st >= 200 && st < 300) {
      ok++;
      await env.DB.prepare('UPDATE avisos SET ultimo_envio = ?, envios = envios + 1 WHERE id = ?').bind(Date.now(), s.id).run();
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
  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM avisos WHERE id > ? ORDER BY id LIMIT 15').bind(depois).all();
  const lista = results || [];
  const r = await mandarPara(lista, () => ({ titulo, texto, url: '/' }), env);
  return json(Object.assign(r, { proximo: lista.length === 15 ? lista[lista.length - 1].id : null }), 200, origin);
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
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    try {
      if (url.pathname === '/saude') return json({ ok: true, servico: 'dominomanauara', mesa: !!env.MESA, pagamentos: !!env.ASAAS_API_KEY, versao: env.VERSAO || null }, 200, origin);
      if (url.pathname === '/mesa/nova' && req.method === 'POST') return await novaMesa(req, env, origin);
      const mc = url.pathname.match(/^\/mesa\/(\d{5})(\/ws)?$/);
      if (mc && req.method === 'GET') return await rotaMesa(req, env, origin, mc[1], !!mc[2]);
      if (url.pathname === '/mensagens' && req.method === 'POST') return await receberMensagem(req, env, origin);
      if (url.pathname === '/patrocinio' && req.method === 'POST') return await receberPatrocinio(req, env, origin);
      // Plano Apoiador e doações (Asaas)
      const H = { json, marcaDoDia, ehDono, SITE };
      if (url.pathname === '/pagar' && req.method === 'POST') return await pagar(req, env, origin, H);
      const pd = url.pathname.match(/^\/pedido\/([0-9a-f]{20})$/);
      if (pd && req.method === 'GET') return await pedido(env, origin, H, pd[1]);
      if (url.pathname === '/plano' && req.method === 'GET') return await plano(env, origin, H, url);
      if (url.pathname === '/plano/trazer' && req.method === 'POST') return await trazerPlano(req, env, origin, H);
      if (url.pathname === '/asaas/webhook' && req.method === 'POST') return await webhook(req, env, origin, H);
      if (url.pathname === '/dono/pagamentos' && req.method === 'GET') return await donoPagamentos(req, env, origin, H);
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
      return json({ erro: 'servidor' }, 500, origin);
    }
  },
  // Agendado (Cron do Cloudflare): lembretes no fim da tarde de Manaus.
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(lembretesDoDia(env));
  }
};
export { lembretesDoDia };
