// Servidor do Dominó Manauara (Cloudflare Workers + D1).
// Caixa de mensagens "Fale com a gente", lembretes para jogar (Web Push) e o painel do dono.
// Depois: ranking, turmas e mesa online.
import { enviarPush } from './webpush.js';

const SITE = 'https://dominomanauara.com.br';
const TIPOS = ['problema', 'ideia', 'elogio', 'outro'];
const STATUS = ['novo', 'lido', 'resolvido'];
const LIMITE_POR_HORA = 6;

function cors(origin) {
  const ok = origin === SITE || /^http:\/\/localhost(:\d+)?$/.test(origin || '');
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

async function receberMensagem(req, env, origin) {
  let b;
  try { b = await req.json(); } catch (e) { return json({ erro: 'formato' }, 400, origin); }
  const texto = limpa(b.texto, 1000);
  if (texto.length < 3) return json({ erro: 'texto-curto' }, 400, origin);
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'outro';
  // Limite contra spam: por aparelho de rede, sem guardar o endereço (só um resumo que muda todo dia).
  const ip = req.headers.get('cf-connecting-ip') || 'sem-ip';
  const dia = new Date().toISOString().slice(0, 10);
  const marca = (await sha256(ip + '|' + dia + '|' + (env.ADMIN_HASH || ''))).slice(0, 24);
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
  const q = filtro && STATUS.includes(filtro)
    ? env.DB.prepare('SELECT id, criado_em, tipo, texto, nome, contato, versao, aparelho, status FROM mensagens WHERE status = ? ORDER BY criado_em DESC LIMIT 200').bind(filtro)
    : env.DB.prepare("SELECT id, criado_em, tipo, texto, nome, contato, versao, aparelho, status FROM mensagens WHERE status != 'apagado' ORDER BY criado_em DESC LIMIT 200");
  const { results } = await q.all();
  const novas = await env.DB.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE status = 'novo'").first();
  return json({ mensagens: results || [], novas: (novas && novas.n) || 0 }, 200, origin);
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
      if (url.pathname === '/saude') return json({ ok: true, servico: 'dominomanauara' }, 200, origin);
      if (url.pathname === '/mensagens' && req.method === 'POST') return await receberMensagem(req, env, origin);
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
