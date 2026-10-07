// Pagamentos pelo Asaas (Pix ou cartão): Plano Apoiador (30 dias ou 1 ano, sem renovação automática) e doações.
// O Asaas avisa o pagamento pelo webhook (CHECKOUT_PAID); só então o plano liga. O jogo nunca vê CPF nem cartão:
// quem paga preenche tudo na página do Asaas. Aqui fica só o código do aparelho, o produto, o valor e as datas.
const DIA = 86400000;
export const PRODUTOS = {
  mensal: { nome: 'Plano Apoiador · 30 dias', desc: 'Dominó Manauara: selo de apoiador, jogo sem anúncios, avatares e mesas exclusivos por 30 dias.', valor: 4.90, dias: 31 },
  anual: { nome: 'Plano Apoiador · 1 ano', desc: 'Dominó Manauara: selo de apoiador, jogo sem anúncios, avatares e mesas exclusivos por 1 ano.', valor: 39.90, dias: 366 },
  doacao5: { nome: 'Doação ao Dominó Manauara', desc: 'Obrigado por ajudar a manter o jogo de graça.', valor: 5 },
  doacao10: { nome: 'Doação ao Dominó Manauara', desc: 'Obrigado por ajudar a manter o jogo de graça.', valor: 10 },
  doacao20: { nome: 'Doação ao Dominó Manauara', desc: 'Obrigado por ajudar a manter o jogo de graça.', valor: 20 }
};
const PEDIDOS_POR_HORA = 12, TROCAS_POR_HORA = 10;
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
// Código para levar o plano para outro celular: 8 letras/números sem os que confundem (0/O, 1/I).
function novoCodigo() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map(x => A[x % A.length]).join('');
}
function base(env) { return /_hmlg_/.test(env.ASAAS_API_KEY || '') ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'; }
async function asaas(env, path, metodo, corpo) {
  const r = await fetch(base(env) + path, {
    method: metodo || 'GET',
    headers: { 'access_token': env.ASAAS_API_KEY, 'content-type': 'application/json', 'User-Agent': 'dominomanauara-servidor' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
const mudou = res => (res && res.meta && res.meta.changes != null ? res.meta.changes : res && res.changes) || 0;

async function planoDe(env, aparelho) {
  return await env.DB.prepare('SELECT ate, codigo FROM planos WHERE aparelho = ?').bind(aparelho).first();
}
async function ligarPlano(env, aparelho, dias) {
  const agora = Date.now(), p = await planoDe(env, aparelho);
  const ate = Math.max(agora, (p && p.ate) || 0) + dias * DIA;
  if (p) await env.DB.prepare('UPDATE planos SET ate = ? WHERE aparelho = ?').bind(ate, aparelho).run();
  else {
    for (let k = 0; k < 5; k++) {
      try { await env.DB.prepare('INSERT INTO planos (aparelho, ate, desde, codigo) VALUES (?, ?, ?, ?)').bind(aparelho, ate, agora, novoCodigo()).run(); break; }
      catch (e) { if (k === 4) throw e; }   // código repetido (raríssimo): tenta outro
    }
  }
  return ate;
}

// POST /pagar {produto, aparelho} -> cria a página de pagamento do Asaas e devolve o link
export async function pagar(req, env, origin, h) {
  if (!env.ASAAS_API_KEY) return h.json({ erro: 'sem-pagamento' }, 503, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const prod = PRODUTOS[b.produto];
  if (!prod) return h.json({ erro: 'produto' }, 400, origin);
  if (prod.dias && !idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  const marca = await h.marcaDoDia(req, env);
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM pedidos WHERE marca = ? AND criado_em > ?').bind(marca, Date.now() - 3600000).first();
  if (r && r.n >= PEDIDOS_POR_HORA) return h.json({ erro: 'muitos' }, 429, origin);
  const id = hex(10), site = (env.SITE_URL || h.SITE).replace(/\/$/, '');
  const res = await asaas(env, '/checkouts', 'POST', {
    billingTypes: ['PIX', 'CREDIT_CARD'], chargeTypes: ['DETACHED'], minutesToExpire: 60, externalReference: id,
    callback: { successUrl: `${site}/?pago=${id}`, cancelUrl: `${site}/?pago=cancelado`, expiredUrl: `${site}/?pago=expirado` },
    items: [{ name: prod.nome, description: prod.desc, quantity: 1, value: prod.valor }]
  });
  if (res.status !== 200 || !res.j.link) {
    const det = res.j && res.j.errors && res.j.errors[0] ? res.j.errors[0].description : 'código ' + res.status;
    return h.json({ erro: 'asaas', detalhe: String(det).slice(0, 200) }, 502, origin);
  }
  await env.DB.prepare('INSERT INTO pedidos (id, checkout, aparelho, produto, valor, status, criado_em, marca) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, res.j.id || null, idOk(b.aparelho) ? b.aparelho : null, b.produto, prod.valor, 'aberto', Date.now(), marca).run();
  return h.json({ pedido: id, link: res.j.link, checkout: res.j.id }, 201, origin);
}

// GET /pedido/:id -> situação do pagamento (o app pergunta quando volta do Asaas)
export async function pedido(env, origin, h, id) {
  const p = await env.DB.prepare('SELECT produto, status, aparelho FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return h.json({ erro: 'nao-encontrado' }, 404, origin);
  const out = { status: p.status, produto: p.produto, plano: !!(PRODUTOS[p.produto] && PRODUTOS[p.produto].dias) };
  if (out.plano && p.status === 'pago' && p.aparelho) { const pl = await planoDe(env, p.aparelho); if (pl) Object.assign(out, { ate: pl.ate, codigo: pl.codigo }); }
  return h.json(out, 200, origin);
}

// GET /plano?aparelho= -> até quando o plano vale (e o código para trocar de celular)
export async function plano(env, origin, h, url) {
  const ap = url.searchParams.get('aparelho');
  if (!idOk(ap)) return h.json({ erro: 'aparelho' }, 400, origin);
  const p = await planoDe(env, ap);
  return h.json(p ? { ate: p.ate, codigo: p.codigo } : { ate: null }, 200, origin);
}

// POST /plano/trazer {codigo, aparelho} -> leva o plano de outro celular para este
export async function trazerPlano(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const codigo = String(b.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!idOk(b.aparelho) || codigo.length !== 8) return h.json({ erro: 'dados' }, 400, origin);
  const marca = await h.marcaDoDia(req, env);
  const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM tentativas WHERE marca = ? AND tipo = 'trazer' AND criado_em > ?").bind(marca, Date.now() - 3600000).first();
  if (t && t.n >= TROCAS_POR_HORA) return h.json({ erro: 'muitas' }, 429, origin);
  await env.DB.prepare("INSERT INTO tentativas (marca, tipo, criado_em) VALUES (?, 'trazer', ?)").bind(marca, Date.now()).run();
  const p = await env.DB.prepare('SELECT aparelho, ate, desde FROM planos WHERE codigo = ?').bind(codigo).first();
  if (!p) return h.json({ erro: 'codigo' }, 404, origin);
  if (p.aparelho !== b.aparelho) {
    const aqui = await planoDe(env, b.aparelho);
    const ate = Math.max(p.ate, (aqui && aqui.ate) || 0);
    await env.DB.prepare('DELETE FROM planos WHERE aparelho = ?').bind(b.aparelho).run();
    await env.DB.prepare('UPDATE planos SET aparelho = ?, ate = ? WHERE codigo = ?').bind(b.aparelho, ate, codigo).run();
  }
  const novo = await planoDe(env, b.aparelho);
  return h.json({ ate: novo.ate, codigo: novo.codigo }, 200, origin);
}

// POST /asaas/webhook -> o Asaas avisa que o pagamento foi feito
export async function webhook(req, env, origin, h) {
  const tok = req.headers.get('asaas-access-token') || '';
  if (!env.ASAAS_WEBHOOK_TOKEN || tok !== env.ASAAS_WEBHOOK_TOKEN) return new Response('nao-autorizado', { status: 401 });
  let b; try { b = await req.json(); } catch (e) { return new Response('ok'); }
  // o Asaas pode mandar o mesmo aviso mais de uma vez: cada evento conta uma vez só
  if (b.id) {
    const res = await env.DB.prepare('INSERT OR IGNORE INTO eventos_asaas (id, recebido_em) VALUES (?, ?)').bind(String(b.id), Date.now()).run();
    if (!mudou(res)) return new Response('ok');
  }
  if (b.event === 'CHECKOUT_PAID' && b.checkout) {
    const c = b.checkout;
    const p = await env.DB.prepare('SELECT id, aparelho, produto, status FROM pedidos WHERE checkout = ? OR id = ?').bind(String(c.id || ''), String(c.externalReference || '')).first();
    if (p && p.status !== 'pago') {
      await env.DB.prepare("UPDATE pedidos SET status = 'pago', pago_em = ? WHERE id = ?").bind(Date.now(), p.id).run();
      const prod = PRODUTOS[p.produto];
      if (prod && prod.dias && p.aparelho) await ligarPlano(env, p.aparelho, prod.dias);
    }
  }
  if ((b.event === 'CHECKOUT_CANCELED' || b.event === 'CHECKOUT_EXPIRED') && b.checkout) {
    await env.DB.prepare("UPDATE pedidos SET status = ? WHERE checkout = ? AND status = 'aberto'").bind(b.event === 'CHECKOUT_CANCELED' ? 'cancelado' : 'expirado', String(b.checkout.id || '')).run();
  }
  return new Response('ok');
}

// GET /dono/pagamentos -> resumo para a Área do dono (sem dados de quem pagou)
export async function donoPagamentos(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const d = new Date(); const inicioMes = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + 4 * 3600000;   // meia-noite em Manaus
  const mes = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS soma FROM pedidos WHERE status = 'pago' AND pago_em >= ?").bind(inicioMes).first();
  const tudo = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS soma FROM pedidos WHERE status = 'pago'").first();
  const ativos = await env.DB.prepare('SELECT COUNT(*) AS n FROM planos WHERE ate > ?').bind(Date.now()).first();
  const { results } = await env.DB.prepare("SELECT produto, valor, pago_em FROM pedidos WHERE status = 'pago' ORDER BY pago_em DESC LIMIT 15").all();
  return h.json({ mes, tudo, planosAtivos: (ativos && ativos.n) || 0, ultimos: results || [], ligado: !!env.ASAAS_API_KEY }, 200, origin);
}
