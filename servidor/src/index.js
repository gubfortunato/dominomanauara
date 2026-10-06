// Servidor do Dominó Manauara (Cloudflare Workers + D1).
// Por enquanto: caixa de mensagens "Fale com a gente" e leitura pelo dono.
// Depois: ranking, turmas e mesa online.

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
      if (url.pathname === '/dono/mensagens' && req.method === 'GET') return await listarMensagens(req, env, origin, url);
      const m = url.pathname.match(/^\/dono\/mensagens\/(\d+)$/);
      if (m && req.method === 'POST') return await mudarStatus(req, env, origin, Number(m[1]));
      return json({ erro: 'nao-encontrado' }, 404, origin);
    } catch (e) {
      return json({ erro: 'servidor' }, 500, origin);
    }
  }
};
