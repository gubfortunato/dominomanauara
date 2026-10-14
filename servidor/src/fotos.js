// Foto na mesa online: qualquer adulto pode mandar a foto do perfil (já reduzida no celular, 240×240).
// Uma IA confere na hora: foto comum aparece para os outros; nudez, violência, ofensa, preconceito, política, droga e
// propaganda são recusadas (e apagadas). Quando a IA fica em dúvida, a foto espera o administrador. Qualquer jogador
// pode denunciar: a foto sai da mesa na hora, a IA olha de novo, e o administrador decide.
// Menor de 18 anos nunca manda (o app nem oferece). Para os outros, a foto tem um código público próprio.
import { moderar, MOTIVOS, TESTE } from './moderar.js';
const MAX = 120000;   // base64 (≈ 90 KB)
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const espera = env => Number(env.IA_ESPERA ?? 600000);   // quanto esperar antes de pedir de novo para a IA
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
// Passa a foto pela IA e aplica o resultado. denuncia: a foto foi denunciada (a IA só pode recusar; aprovar fica com o administrador)
async function conferir(env, aparelho, denuncia) {
  const f = await env.DB.prepare('SELECT pub, mime, dados, status, denuncias FROM fotos WHERE aparelho = ?').bind(aparelho).first();
  if (!f || !f.dados || !['pendente', 'denunciada'].includes(f.status)) return f ? f.status : null;
  await env.DB.prepare(`INSERT INTO fotos_ia (aparelho, pub, tentou_em) VALUES (?, ?, ?) ON CONFLICT(aparelho) DO UPDATE SET pub = excluded.pub, tentou_em = excluded.tentou_em, veredito = NULL, categoria = NULL`).bind(aparelho, f.pub, Date.now()).run();
  const v = await moderar(env, f.mime, f.dados);
  if (!v) return f.status;
  await env.DB.prepare('UPDATE fotos_ia SET veredito = ?, categoria = ?, modelo = ?, em = ?, denuncias_vistas = ? WHERE aparelho = ?').bind(v.veredito, v.categoria, v.modelo, Date.now(), f.denuncias || 0, aparelho).run();
  // só aplica se a foto ainda é a mesma (o jogador pode ter trocado enquanto a IA olhava)
  if (v.veredito === 'recusar') { await env.DB.prepare("UPDATE fotos SET status = 'recusada', dados = '', revisado_em = ? WHERE aparelho = ? AND pub = ?").bind(Date.now(), aparelho, f.pub).run(); return 'recusada'; }
  if (v.veredito === 'aprovar' && !denuncia && f.status === 'pendente') { await env.DB.prepare("UPDATE fotos SET status = 'aprovada', revisado_em = ? WHERE aparelho = ? AND pub = ? AND status = 'pendente'").bind(Date.now(), aparelho, f.pub).run(); return 'aprovada'; }
  return f.status;
}
async function motivoDe(env, aparelho) {
  const r = await env.DB.prepare('SELECT categoria FROM fotos_ia WHERE aparelho = ?').bind(aparelho).first();
  return r && MOTIVOS[r.categoria] ? MOTIVOS[r.categoria] : null;
}
// Cron: as que ficaram pendentes (a IA não respondeu na hora) e as denunciadas que a IA ainda não reviu
export async function moderarPendentes(env) {
  if (!env.AI) return;
  const { results } = await env.DB.prepare(`SELECT f.aparelho, f.status FROM fotos f LEFT JOIN fotos_ia i ON i.aparelho = f.aparelho
    WHERE ((f.status = 'pendente' AND (i.aparelho IS NULL OR i.veredito IS NULL OR i.pub IS NOT f.pub)) OR (f.status = 'denunciada' AND COALESCE(i.denuncias_vistas, -1) < f.denuncias))
    AND COALESCE(i.tentou_em, 0) <= ? ORDER BY f.criado_em LIMIT 8`).bind(Date.now() - espera(env)).all();
  for (const f of results || []) { try { await conferir(env, f.aparelho, f.status === 'denunciada'); } catch (e) {} }
}
// GET /saude/ia -> a IA está respondendo? (testa uma paisagem desenhada; no máximo uma vez a cada 30 minutos)
export async function saudeIA(env, origin, h) {
  if (!env.AI) return h.json({ ia: false }, 200, origin);
  const ult = await env.DB.prepare('SELECT em, resultado FROM ia_teste WHERE id = 1').first();
  if (ult && Date.now() - ult.em < 1800000) return h.json({ ia: true, ...JSON.parse(ult.resultado), em: ult.em, guardado: true }, 200, origin);
  const t0 = Date.now(), v = await moderar(env, TESTE.mime, TESTE.dados);
  const res = v ? { modelo: v.modelo, veredito: v.veredito, ms: Date.now() - t0 } : { erro: 'sem-resposta', ms: Date.now() - t0 };
  await env.DB.prepare('INSERT INTO ia_teste (id, em, resultado) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET em = excluded.em, resultado = excluded.resultado').bind(Date.now(), JSON.stringify(res)).run();
  return h.json({ ia: true, ...res }, 200, origin);
}

// POST /foto {aparelho, dados} -> a IA confere na hora: {status: 'aprovada' | 'recusada' | 'pendente', motivo}
export async function enviar(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  const m = String(b.dados || '').match(/^data:(image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > MAX) return h.json({ erro: 'imagem' }, 400, origin);
  const marca = await h.marcaDoDia(req, env);
  const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM tentativas WHERE marca = ? AND tipo = 'foto' AND criado_em > ?").bind(marca, Date.now() - 86400000).first();
  if (t && t.n >= 8) return h.json({ erro: 'muitas' }, 429, origin);
  await env.DB.prepare("INSERT INTO tentativas (marca, tipo, criado_em) VALUES (?, 'foto', ?)").bind(marca, Date.now()).run();
  await env.DB.prepare(`INSERT INTO fotos (aparelho, pub, mime, dados, status, criado_em, denuncias) VALUES (?, ?, ?, ?, 'pendente', ?, 0)
    ON CONFLICT(aparelho) DO UPDATE SET pub = excluded.pub, mime = excluded.mime, dados = excluded.dados, status = 'pendente', criado_em = excluded.criado_em, revisado_em = NULL, denuncias = 0`)
    .bind(b.aparelho, hex(8), m[1], m[2], Date.now()).run();
  let st = 'pendente'; try { st = (await conferir(env, b.aparelho, false)) || 'pendente'; } catch (e) {}
  return h.json({ status: st, motivo: st === 'recusada' ? await motivoDe(env, b.aparelho) : null }, 201, origin);
}
// GET /foto/status?aparelho=  (se ainda está pendente, pede para a IA olhar de novo, sem fazer esperar)
export async function status(env, origin, h, url, ctx) {
  const ap = url.searchParams.get('aparelho');
  if (!idOk(ap)) return h.json({ erro: 'aparelho' }, 400, origin);
  const f = await env.DB.prepare('SELECT status FROM fotos WHERE aparelho = ?').bind(ap).first();
  if (f && f.status === 'pendente' && env.AI && ctx) {
    const i = await env.DB.prepare('SELECT tentou_em, veredito FROM fotos_ia WHERE aparelho = ?').bind(ap).first();
    if (!i || (!i.veredito && Date.now() - (i.tentou_em || 0) > espera(env))) ctx.waitUntil(conferir(env, ap, false).catch(() => {}));
  }
  return h.json({ status: f ? f.status : null, motivo: f && f.status === 'recusada' ? await motivoDe(env, ap) : null }, 200, origin);
}
// POST /foto/apagar {aparelho}
export async function apagar(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  await env.DB.prepare('DELETE FROM fotos WHERE aparelho = ?').bind(b.aparelho).run();
  await env.DB.prepare('DELETE FROM fotos_ia WHERE aparelho = ?').bind(b.aparelho).run();
  return h.json({ ok: true }, 200, origin);
}
// GET /foto/:pub -> a imagem, só se estiver aprovada
export async function imagem(env, pub) {
  const f = await env.DB.prepare("SELECT mime, dados FROM fotos WHERE pub = ? AND status = 'aprovada'").bind(pub).first();
  if (!f) return new Response('nao-encontrada', { status: 404, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
  const bin = Uint8Array.from(atob(f.dados), c => c.charCodeAt(0));
  return new Response(bin, { headers: { 'content-type': f.mime, 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } });
}
// POST /foto/denunciar {pub} -> sai da mesa na hora; a IA olha de novo (se ela recusar, a foto é apagada) e o administrador decide
export async function denunciar(req, env, origin, h, ctx) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const pub = String(b.pub || '');
  if (!/^[0-9a-f]{16}$/.test(pub)) return h.json({ erro: 'foto' }, 400, origin);
  const marca = await h.marcaDoDia(req, env);
  const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM tentativas WHERE marca = ? AND tipo = 'denuncia' AND criado_em > ?").bind(marca, Date.now() - 3600000).first();
  if (t && t.n >= 10) return h.json({ erro: 'muitas' }, 429, origin);
  await env.DB.prepare("INSERT INTO tentativas (marca, tipo, criado_em) VALUES (?, 'denuncia', ?)").bind(marca, Date.now()).run();
  await env.DB.prepare("UPDATE fotos SET status = CASE WHEN status = 'aprovada' THEN 'denunciada' ELSE status END, denuncias = denuncias + 1 WHERE pub = ?").bind(pub).run();
  if (env.AI && ctx) {
    const f = await env.DB.prepare("SELECT aparelho FROM fotos WHERE pub = ? AND status = 'denunciada'").bind(pub).first();
    if (f) ctx.waitUntil(conferir(env, f.aparelho, true).catch(() => {}));
  }
  return h.json({ ok: true }, 200, origin);
}
// Para a mesa: a foto que os outros podem ver (aprovada)
export async function fotoPublica(env, aparelho) {
  const f = await env.DB.prepare("SELECT pub FROM fotos WHERE aparelho = ? AND status = 'aprovada'").bind(aparelho).first();
  return f ? f.pub : null;
}
// ---------- Área do administrador ----------
// GET /dono/fotos -> as que esperam aprovação e as denunciadas
export async function donoLista(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const { results } = await env.DB.prepare("SELECT pub, mime, dados, status, criado_em, denuncias FROM fotos WHERE status IN ('pendente', 'denunciada') ORDER BY criado_em LIMIT 30").all();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM fotos WHERE status = 'aprovada'").first();
  const ia = await env.DB.prepare("SELECT SUM(veredito = 'aprovar') AS a, SUM(veredito = 'recusar') AS r FROM fotos_ia WHERE em > ?").bind(Date.now() - 30 * 86400000).first();
  return h.json({ fotos: (results || []).map(f => ({ pub: f.pub, status: f.status, criado_em: f.criado_em, denuncias: f.denuncias, img: `data:${f.mime};base64,${f.dados}` })), aprovadas: (n && n.n) || 0,
    ia: !!env.AI, iaAprovou: (ia && ia.a) || 0, iaRecusou: (ia && ia.r) || 0 }, 200, origin);
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
