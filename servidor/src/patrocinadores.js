// Patrocinadores: o dono cadastra pelo celular (Área do dono), o app mostra em cada espaço e conta vistas e cliques.
// Espaços: inicio (banner na tela inicial), mesa ("Mesa oferecida por" no meio da mesa), fim (tela do resultado
// quando uma partida termina) e montar (tela "Monte a mesa"). Imagens ficam no próprio banco, já reduzidas no celular.
export const ESPACOS = ['inicio', 'mesa', 'fim', 'montar'];
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMG = 700000;   // base64 (≈ 500 KB de imagem)
const hojeManaus = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
const diaManaus = ms => new Date(ms - 4 * 3600000).toISOString().slice(0, 10);

function linkOk(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s.slice(0, 300);
  const dig = s.replace(/\D/g, '');
  if (/^[\d\s()+-]+$/.test(s) && dig.length >= 10 && dig.length <= 13) return 'https://wa.me/' + (dig.length >= 12 ? dig : '55' + dig);
  if (/^@?[a-z0-9._]{2,30}$/i.test(s)) return 'https://instagram.com/' + s.replace(/^@/, '');
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return 'https://' + s.slice(0, 290);
  return '';
}
function publico(p, base) {
  const img = id => id ? `${base}/patro/img/${id}` : null;
  let banners = [];
  try { banners = JSON.parse(p.banners || '[]'); } catch (e) {}
  let espacos = [];
  try { espacos = JSON.parse(p.espacos || '[]'); } catch (e) {}
  return { id: p.id, nome: p.nome, texto: p.texto || '', link: p.link || '', logo: img(p.logo), alt: p.nome,
    banners: banners.filter(b => b && b.img).map(b => ({ src: img(b.img), ms: b.ms || 4500, img: b.img })), espacos, peso: p.peso || 1 };
}

// GET /patrocinio/atual -> quem está no ar agora (o app guarda e roda entre eles)
export async function atuais(req, env, origin, h) {
  const agora = Date.now(), base = new URL(req.url).origin;
  const { results } = await env.DB.prepare(
    'SELECT * FROM patrocinadores WHERE ativo = 1 AND (inicio IS NULL OR inicio <= ?) AND (fim IS NULL OR fim >= ?) ORDER BY id'
  ).bind(agora, agora).all();
  const lista = (results || []).map(p => { const o = publico(p, base); o.banners.forEach(b => delete b.img); return o; });
  const r = h.json({ patrocinadores: lista, agora }, 200, origin);
  r.headers.set('cache-control', 'public, max-age=120');
  return r;
}

// GET /patro/img/:id -> a imagem (não muda nunca: cada envio vira uma imagem nova)
export async function imagem(env, id) {
  const r = await env.DB.prepare('SELECT mime, dados FROM patro_imgs WHERE id = ?').bind(id).first();
  if (!r) return new Response('nao-encontrada', { status: 404 });
  const bin = Uint8Array.from(atob(r.dados), c => c.charCodeAt(0));
  return new Response(bin, { headers: { 'content-type': r.mime, 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' } });
}

// POST /patro/contar (texto) {itens:[{p, e, v, c}]} -> soma vistas e cliques do dia
export async function contar(req, env, origin, h) {
  let b; try { b = JSON.parse(await req.text()); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const itens = (Array.isArray(b && b.itens) ? b.itens : []).slice(0, 20);
  if (!itens.length) return h.json({ ok: true }, 200, origin);
  const ids = new Set(((await env.DB.prepare('SELECT id FROM patrocinadores').all()).results || []).map(x => x.id));
  const dia = hojeManaus();
  const st = env.DB.prepare('INSERT INTO patro_contagem (patro, dia, espaco, vistas, cliques) VALUES (?, ?, ?, ?, ?) ON CONFLICT (patro, dia, espaco) DO UPDATE SET vistas = vistas + excluded.vistas, cliques = cliques + excluded.cliques');
  let n = 0;
  for (const it of itens) {
    const p = Number(it.p), e = String(it.e), v = Math.max(0, Math.min(200, Math.floor(Number(it.v) || 0))), c = Math.max(0, Math.min(50, Math.floor(Number(it.c) || 0)));
    if (!ids.has(p) || !ESPACOS.includes(e) || (!v && !c)) continue;
    await st.bind(p, dia, e, v, c).run(); n++;
  }
  return h.json({ ok: true, n }, 200, origin);
}

// ---------- Área do dono ----------
async function numeros(env, id, dias) {
  const desde = diaManaus(Date.now() - (dias - 1) * 86400000);
  const { results } = await env.DB.prepare('SELECT espaco, SUM(vistas) AS vistas, SUM(cliques) AS cliques FROM patro_contagem WHERE patro = ? AND dia >= ? GROUP BY espaco').bind(id, desde).all();
  const out = {}; for (const e of ESPACOS) out[e] = { vistas: 0, cliques: 0 };
  for (const r of results || []) out[r.espaco] = { vistas: r.vistas || 0, cliques: r.cliques || 0 };
  return out;
}
// GET /dono/patrocinadores?dias=30 -> todos (no ar, pausados e vencidos) com os números
export async function donoLista(req, env, origin, h, url) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const dias = Math.max(1, Math.min(365, Number(url.searchParams.get('dias')) || 30));
  const base = new URL(req.url).origin;
  const { results } = await env.DB.prepare('SELECT * FROM patrocinadores ORDER BY ativo DESC, id DESC').all();
  const lista = [];
  for (const p of results || []) {
    const o = publico(p, base);
    Object.assign(o, { ativo: !!p.ativo, inicio: p.inicio, fim: p.fim, logoId: p.logo, numeros: await numeros(env, p.id, dias) });
    lista.push(o);
  }
  return h.json({ patrocinadores: lista, dias }, 200, origin);
}
// POST /dono/patro-img {dados (base64), mime} -> {id}
export async function donoImagem(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const dados = String(b.dados || '').replace(/^data:[^,]+,/, '');
  if (!MIMES.includes(b.mime) || !dados || dados.length > MAX_IMG || !/^[A-Za-z0-9+/=]+$/.test(dados)) return h.json({ erro: 'imagem' }, 400, origin);
  const r = await env.DB.prepare('INSERT INTO patro_imgs (mime, dados, criado_em) VALUES (?, ?, ?)').bind(b.mime, dados, Date.now()).run();
  const id = (r.meta && r.meta.last_row_id) || r.lastInsertRowid;
  return h.json({ id: Number(id) }, 201, origin);
}
// POST /dono/patrocinadores {id?, nome, texto, link, logo, banners:[{img, ms}], espacos, inicio, fim, ativo}
export async function donoSalvar(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const nome = h.limpa(b.nome, 40);
  if (nome.length < 2) return h.json({ erro: 'nome' }, 400, origin);
  const link = linkOk(b.link);
  if (b.link && !link) return h.json({ erro: 'link' }, 400, origin);
  const espacos = (Array.isArray(b.espacos) ? b.espacos : []).filter(e => ESPACOS.includes(e));
  if (!espacos.length) return h.json({ erro: 'espacos' }, 400, origin);
  const banners = (Array.isArray(b.banners) ? b.banners : []).slice(0, 3).filter(x => Number.isInteger(x.img)).map(x => ({ img: x.img, ms: Math.max(2500, Math.min(9000, Number(x.ms) || 4500)) }));
  const logo = Number.isInteger(b.logo) ? b.logo : null;
  const inicio = Number(b.inicio) || null, fim = Number(b.fim) || null;
  const vals = [nome, h.limpa(b.texto, 80), link, logo, JSON.stringify(banners), JSON.stringify(espacos), inicio, fim, b.ativo === false ? 0 : 1];
  let id = Number(b.id) || null;
  if (id) {
    const r = await env.DB.prepare('UPDATE patrocinadores SET nome = ?, texto = ?, link = ?, logo = ?, banners = ?, espacos = ?, inicio = ?, fim = ?, ativo = ? WHERE id = ?').bind(...vals, id).run();
    if (!((r.meta && r.meta.changes) || r.changes)) return h.json({ erro: 'nao-encontrado' }, 404, origin);
  } else {
    const r = await env.DB.prepare('INSERT INTO patrocinadores (nome, texto, link, logo, banners, espacos, inicio, fim, ativo, peso, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').bind(...vals, Date.now()).run();
    id = Number((r.meta && r.meta.last_row_id) || r.lastInsertRowid);
  }
  // imagens que ninguém mais usa saem do banco
  await faxinaImagens(env);
  return h.json({ id }, 200, origin);
}
// POST /dono/patrocinadores/:id/apagar
export async function donoApagar(req, env, origin, h, id) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  await env.DB.prepare('DELETE FROM patrocinadores WHERE id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM patro_contagem WHERE patro = ?').bind(id).run();
  await faxinaImagens(env);
  return h.json({ ok: true }, 200, origin);
}
async function faxinaImagens(env) {
  const usadas = new Set();
  for (const p of ((await env.DB.prepare('SELECT logo, banners FROM patrocinadores').all()).results || [])) {
    if (p.logo) usadas.add(p.logo);
    try { JSON.parse(p.banners || '[]').forEach(b => b && b.img && usadas.add(b.img)); } catch (e) {}
  }
  // só apaga imagem com mais de 1 hora (a que acabou de subir pode estar esperando o "Salvar")
  const velhas = ((await env.DB.prepare('SELECT id FROM patro_imgs WHERE criado_em < ?').bind(Date.now() - 3600000).all()).results || []).map(x => x.id);
  for (const id of velhas) if (!usadas.has(id)) await env.DB.prepare('DELETE FROM patro_imgs WHERE id = ?').bind(id).run();
}
