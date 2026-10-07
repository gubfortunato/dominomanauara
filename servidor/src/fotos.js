// Foto na mesa online (Plano Apoiador): o jogador manda a foto do perfil (já reduzida no celular, 240×240),
// ela só aparece para os outros depois que o administrador aprova, e qualquer jogador pode denunciar
// (a foto sai da mesa na hora e volta para revisão). Menor de 18 anos nunca manda (o app nem oferece).
// Para os outros, a foto tem um código público próprio: o código do aparelho nunca aparece.
const MAX = 120000;   // base64 (≈ 90 KB)
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const temPlano = async (env, ap) => { const p = await env.DB.prepare('SELECT ate FROM planos WHERE aparelho = ?').bind(ap).first(); return !!(p && p.ate > Date.now()); };

// POST /foto {aparelho, dados} -> fica "pendente" até o administrador ver
export async function enviar(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (!(await temPlano(env, b.aparelho))) return h.json({ erro: 'sem-plano' }, 403, origin);
  const m = String(b.dados || '').match(/^data:(image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > MAX) return h.json({ erro: 'imagem' }, 400, origin);
  const marca = await h.marcaDoDia(req, env);
  const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM tentativas WHERE marca = ? AND tipo = 'foto' AND criado_em > ?").bind(marca, Date.now() - 86400000).first();
  if (t && t.n >= 8) return h.json({ erro: 'muitas' }, 429, origin);
  await env.DB.prepare("INSERT INTO tentativas (marca, tipo, criado_em) VALUES (?, 'foto', ?)").bind(marca, Date.now()).run();
  await env.DB.prepare(`INSERT INTO fotos (aparelho, pub, mime, dados, status, criado_em, denuncias) VALUES (?, ?, ?, ?, 'pendente', ?, 0)
    ON CONFLICT(aparelho) DO UPDATE SET pub = excluded.pub, mime = excluded.mime, dados = excluded.dados, status = 'pendente', criado_em = excluded.criado_em, revisado_em = NULL, denuncias = 0`)
    .bind(b.aparelho, hex(8), m[1], m[2], Date.now()).run();
  return h.json({ status: 'pendente' }, 201, origin);
}
// GET /foto/status?aparelho=
export async function status(env, origin, h, url) {
  const ap = url.searchParams.get('aparelho');
  if (!idOk(ap)) return h.json({ erro: 'aparelho' }, 400, origin);
  const f = await env.DB.prepare('SELECT status FROM fotos WHERE aparelho = ?').bind(ap).first();
  return h.json({ status: f ? f.status : null }, 200, origin);
}
// POST /foto/apagar {aparelho}
export async function apagar(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  await env.DB.prepare('DELETE FROM fotos WHERE aparelho = ?').bind(b.aparelho).run();
  return h.json({ ok: true }, 200, origin);
}
// GET /foto/:pub -> a imagem, só se estiver aprovada
export async function imagem(env, pub) {
  const f = await env.DB.prepare("SELECT mime, dados FROM fotos WHERE pub = ? AND status = 'aprovada'").bind(pub).first();
  if (!f) return new Response('nao-encontrada', { status: 404, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
  const bin = Uint8Array.from(atob(f.dados), c => c.charCodeAt(0));
  return new Response(bin, { headers: { 'content-type': f.mime, 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } });
}
// POST /foto/denunciar {pub} -> sai da mesa na hora e volta para o administrador revisar
export async function denunciar(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const pub = String(b.pub || '');
  if (!/^[0-9a-f]{16}$/.test(pub)) return h.json({ erro: 'foto' }, 400, origin);
  const marca = await h.marcaDoDia(req, env);
  const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM tentativas WHERE marca = ? AND tipo = 'denuncia' AND criado_em > ?").bind(marca, Date.now() - 3600000).first();
  if (t && t.n >= 10) return h.json({ erro: 'muitas' }, 429, origin);
  await env.DB.prepare("INSERT INTO tentativas (marca, tipo, criado_em) VALUES (?, 'denuncia', ?)").bind(marca, Date.now()).run();
  await env.DB.prepare("UPDATE fotos SET status = CASE WHEN status = 'aprovada' THEN 'denunciada' ELSE status END, denuncias = denuncias + 1 WHERE pub = ?").bind(pub).run();
  return h.json({ ok: true }, 200, origin);
}
// Para a mesa: a foto que os outros podem ver (aprovada e com plano em dia)
export async function fotoPublica(env, aparelho) {
  const f = await env.DB.prepare("SELECT pub FROM fotos WHERE aparelho = ? AND status = 'aprovada'").bind(aparelho).first();
  return f && (await temPlano(env, aparelho)) ? f.pub : null;
}
// ---------- Área do administrador ----------
// GET /dono/fotos -> as que esperam aprovação e as denunciadas
export async function donoLista(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const { results } = await env.DB.prepare("SELECT pub, mime, dados, status, criado_em, denuncias FROM fotos WHERE status IN ('pendente', 'denunciada') ORDER BY criado_em LIMIT 30").all();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM fotos WHERE status = 'aprovada'").first();
  return h.json({ fotos: (results || []).map(f => ({ pub: f.pub, status: f.status, criado_em: f.criado_em, denuncias: f.denuncias, img: `data:${f.mime};base64,${f.dados}` })), aprovadas: (n && n.n) || 0 }, 200, origin);
}
// POST /dono/fotos/:pub {acao: 'aprovar' | 'recusar'}
export async function donoDecidir(req, env, origin, h, pub) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (b.acao === 'aprovar') await env.DB.prepare("UPDATE fotos SET status = 'aprovada', revisado_em = ? WHERE pub = ?").bind(Date.now(), pub).run();
  else if (b.acao === 'recusar') await env.DB.prepare("UPDATE fotos SET status = 'recusada', dados = '', revisado_em = ? WHERE pub = ?").bind(Date.now(), pub).run();
  else return h.json({ erro: 'acao' }, 400, origin);
  return h.json({ ok: true }, 200, origin);
}
