// 12/11 (pedido do dono): conversa com o suporte. Antes, o "Fale com a gente" era de mão única (o dono lia no painel e, se a
// pessoa deixou WhatsApp, respondia por fora). Agora cada mensagem mandada pelo app fica ligada ao aparelho de quem mandou;
// o dono responde pelo painel e a resposta aparece no app (com aviso no celular, se os avisos estiverem ligados).
// suporte: de = 'j' (jogador) ou 'd' (dono); msg = a mensagem da caixa do dono (mensagens.id); lida = quando o jogador viu.
// No painel, cada mensagem chega com o contexto do aparelho (sócio até quando, último pagamento, bloqueio), para resolver
// sem precisar perguntar. Nada disso aparece para o jogador.
import { enviarPush } from './webpush.js';

const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const limpa = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

// a mensagem que acabou de entrar na caixa fica ligada ao aparelho de quem mandou
export async function anotarSuporte(env, msg, aparelho, texto) {
  if (!idOk(aparelho) || !msg) return;
  try {
    await env.DB.prepare("INSERT INTO suporte (msg, aparelho, de, texto, em) VALUES (?, ?, 'j', ?, ?)").bind(msg, aparelho, String(texto || '').slice(0, 1000), Date.now()).run();
  } catch (e) {}
}

// GET /suporte?id=APARELHO: a conversa deste aparelho (as últimas 60 falas) e quantas respostas ainda não foram vistas
export async function suporteDoAparelho(req, env, origin, h, url) {
  const ap = url.searchParams.get('id') || '';
  if (!idOk(ap)) return h.json({ erro: 'id' }, 400, origin);
  let itens = [], novas = 0;
  try {
    const { results } = await env.DB.prepare('SELECT id, de, texto, em, lida FROM suporte WHERE aparelho = ? ORDER BY em DESC LIMIT 60').bind(ap).all();
    itens = (results || []).reverse().map(x => ({ id: x.id, de: x.de, texto: x.texto, em: x.em, lida: x.de === 'd' ? !!x.lida : undefined }));
    novas = itens.filter(x => x.de === 'd' && !x.lida).length;
  } catch (e) {}
  return h.json({ itens, novas }, 200, origin);
}

// POST /suporte/lido {id}: o jogador abriu a conversa (as respostas ficam como vistas)
export async function suporteLido(req, env, origin, h) {
  let b = {}; try { b = await req.json(); } catch (e) {}
  if (!idOk(b.id)) return h.json({ erro: 'id' }, 400, origin);
  try { await env.DB.prepare("UPDATE suporte SET lida = ? WHERE aparelho = ? AND de = 'd' AND lida IS NULL").bind(Date.now(), b.id).run(); } catch (e) {}
  return h.json({ ok: true }, 200, origin);
}

// POST /dono/mensagens/:id/responder {texto}: a resposta vai para a conversa de quem mandou e chega no celular
export async function donoResponder(req, env, origin, h, id) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const texto = limpa(b.texto, 1500);
  if (texto.length < 2) return h.json({ erro: 'texto-curto' }, 400, origin);
  const j = await env.DB.prepare("SELECT aparelho FROM suporte WHERE msg = ? AND de = 'j' LIMIT 1").bind(id).first();
  if (!j || !j.aparelho) return h.json({ erro: 'sem-conversa' }, 404, origin);   // mensagem antiga (antes da conversa): só por fora
  const agora = Date.now();
  await env.DB.prepare("INSERT INTO suporte (msg, aparelho, de, texto, em) VALUES (?, ?, 'd', ?, ?)").bind(id, j.aparelho, texto, agora).run();
  await env.DB.prepare("UPDATE mensagens SET status = 'resolvido' WHERE id = ? AND status <> 'apagado'").bind(id).run();
  // aviso no celular de quem mandou (todos os avisos ligados a este aparelho)
  let avisados = 0;
  try {
    const { results } = await env.DB.prepare('SELECT DISTINCT a.id, a.endpoint, a.p256dh, a.auth FROM avisos a JOIN avisos_id i ON i.endpoint = a.endpoint WHERE i.aparelho = ? LIMIT 5').bind(j.aparelho).all();
    const curto = texto.length > 110 ? texto.slice(0, 107).trimEnd() + '…' : texto;
    for (const s of results || []) {
      let r = 0; try { r = await enviarPush(s, { titulo: 'Resposta do Dominó Manauara', texto: curto, url: '/?abrir=suporte' }, env); } catch (e) {}
      if (r === 404 || r === 410) { try { await env.DB.prepare('DELETE FROM avisos WHERE id = ?').bind(s.id).run(); await env.DB.prepare('DELETE FROM avisos_id WHERE endpoint = ?').bind(s.endpoint).run(); } catch (e) {} }
      if (r >= 200 && r < 300) avisados++;
    }
  } catch (e) {}
  return h.json({ ok: true, avisados }, 200, origin);
}

// Para o painel: em cada mensagem da caixa, as respostas já dadas e o contexto do aparelho (só para o dono)
export async function juntarSuporte(env, mensagens) {
  const lista = mensagens || [];
  if (!lista.length) return lista;
  const ids = lista.map(m => Number(m.id)).filter(Boolean);
  let falas = [];
  try {
    const { results } = await env.DB.prepare(`SELECT msg, aparelho, de, texto, em, lida FROM suporte WHERE msg IN (${ids.map(() => '?').join(',')}) ORDER BY em`).bind(...ids).all();
    falas = results || [];
  } catch (e) { return lista; }
  const apDe = {}, resp = {};
  for (const f of falas) {
    if (f.de === 'j') apDe[f.msg] = f.aparelho;
    else (resp[f.msg] = resp[f.msg] || []).push({ texto: f.texto, em: f.em, lida: !!f.lida });
  }
  // 13/11: a sugestão de resposta da IA (só para as que ainda não foram respondidas)
  const sug = {};
  try { const { results } = await env.DB.prepare(`SELECT msg, texto FROM suporte_sugestao WHERE msg IN (${ids.map(() => '?').join(',')})`).bind(...ids).all(); for (const x of results || []) sug[x.msg] = x.texto; } catch (e) {}
  const aps = [...new Set(Object.values(apDe))];
  const ctx = {};
  if (aps.length) {
    const marcas = aps.map(() => '?').join(',');
    const todos = async (q) => { try { const { results } = await env.DB.prepare(q).bind(...aps).all(); return results || []; } catch (e) { return []; } };
    const [planos, pedidos, bloq, assin] = await Promise.all([
      todos(`SELECT aparelho, ate, desde FROM planos WHERE aparelho IN (${marcas})`),
      todos(`SELECT aparelho, produto, valor, status, criado_em, pago_em FROM pedidos WHERE aparelho IN (${marcas}) ORDER BY criado_em DESC LIMIT 400`),
      todos(`SELECT aparelho, motivo, em FROM bloqueios WHERE aparelho IN (${marcas})`),
      todos(`SELECT aparelho FROM avisos_id WHERE aparelho IN (${marcas})`)
    ]);
    for (const ap of aps) ctx[ap] = { socioAte: 0, pedido: null, pagos: 0, bloqueio: null, avisos: false };
    for (const p of planos) ctx[p.aparelho].socioAte = Number(p.ate) || 0;
    for (const p of pedidos) {
      const c = ctx[p.aparelho];
      if (!c.pedido) c.pedido = { produto: p.produto, valor: p.valor, status: p.status, em: p.pago_em || p.criado_em };
      if (p.status === 'pago') c.pagos++;
    }
    for (const b of bloq) ctx[b.aparelho].bloqueio = { motivo: b.motivo || '', em: b.em };
    for (const a of assin) ctx[a.aparelho].avisos = true;
  }
  return lista.map(m => {
    const ap = apDe[m.id];
    return ap ? Object.assign({}, m, { conversa: true, respostas: resp[m.id] || [], ctx: ctx[ap] || null, sugestao: (resp[m.id] || []).length ? null : (sug[m.id] || null) }) : m;
  });
}
