// Pagamentos pelo Asaas (Pix ou cartão): Plano Apoiador (30 dias ou 1 ano, sem renovação automática) e doações.
// Doação de R$ 20 leva 30 dias de plano de presente. Quem doa ganha selo ♥ (♥♥ a partir de R$ 30, ♥♥♥ a partir de R$ 100)
// e um código para levar plano e doações para outro celular.
// O Asaas avisa o pagamento pelo webhook (CHECKOUT_PAID); só então o plano liga. O jogo nunca vê CPF nem cartão:
// quem paga preenche tudo na página do Asaas. Aqui fica só o código do aparelho, o produto, o valor e as datas.
import { promoValendo, promoAte } from './planos.js';
const DIA = 86400000;
export const PRODUTOS = {
  // 3.22: um jeito só de apoiar. Cada valor compra tempo de Apoiador (foto na mesa, selo ★, avatares exclusivos e o
  // Personalizar liberado) e soma para o selo ♥, que fica para sempre. Quanto mais, mais tempo e mais barato o mês.
  // 3.37.2: nome e descrição curtos e sem símbolos (com 45 letras no nome e 162 na descrição, o Asaas recusava a cobrança;
  // os que funcionaram tinham até 25 e 133). O teste da publicação abre e cancela uma cobrança de cada um da lista A_VENDA.
  // 3.37.2 (valores do dono): R$ 9,90 = 1 mês, R$ 19,90 = 3 meses, R$ 29,90 = 6 meses e "Quer dar mais?", um valor livre
  // de R$ 30 a R$ 500 em que cada R$ 5 vale 1 mês de Apoiador (R$ 60 = 1 ano). O servidor recusa valor fora da faixa.
  // 28/10 (planos, valores e nome do dono): só o Sócio da Calçada (antes Apoiador), em 1 mês, 3 meses ou 1 ano (R$ 9,90, R$ 24,90 e R$ 79,90), pago uma vez,
  // sem renovação automática. Além do que já tinha, o Apoiador cria mesas e joga partidas sem limite nas mesas com os
  // amigos e escreve no papo de mesa. Os de antes (abaixo) continuam valendo para os pedidos já feitos.
  // 28/10 (regras e preços do dono): mensal, trimestral e anual renovam sozinhos no cartão (assinatura do Asaas; cancela
  // quando quiser pelo app e o tempo pago vale até o fim). O "1 mês" avulso (Pix ou cartão, sem renovar) fica para quem
  // prefere o Pix. Preço normal em valor; na promoção de lançamento (até 05/11, 00:00 de Brasília), quem assina paga
  // promo.valor nas primeiras promo.vezes cobranças (mensal: 3 meses a R$ 9,90; trimestral: o 1º trimestre a R$ 24,90;
  // anual: o 1º ano a R$ 74,90) e depois o normal (o servidor muda o valor da assinatura no Asaas).
  apm: { nome: 'Dominó Manauara - mensal', desc: 'Sócio da Calçada todo mês: partidas sem limite, papo de mesa, ranking completo, estatísticas, foto, selo e avatares.', valor: 14.90, dias: 31, recorrente: 'MONTHLY', promo: { valor: 9.90, vezes: 3 } },
  ap3: { nome: 'Dominó Manauara - 3 meses', desc: 'Sócio da Calçada trimestral: partidas sem limite, papo de mesa, ranking completo, estatísticas, foto, selo e avatares.', valor: 37.90, dias: 92, recorrente: 'QUARTERLY', promo: { valor: 24.90, vezes: 1 } },
  ap12: { nome: 'Dominó Manauara - 1 ano', desc: 'Sócio da Calçada anual: partidas sem limite, papo de mesa, ranking completo, estatísticas, foto, selo e avatares.', valor: 99.90, dias: 366, recorrente: 'YEARLY', promo: { valor: 74.90, vezes: 1 } },
  ap1: { nome: 'Dominó Manauara - 1 mês', desc: 'Sócio da Calçada por 1 mês: partidas sem limite, papo de mesa, ranking completo, estatísticas, foto, selo e avatares.', valor: 14.90, dias: 31, promo: { valor: 9.90, vezes: 1 } },
  apoio990: { nome: 'Dominó Manauara - 1 mês', desc: 'Apoiador do Dominó Manauara por 1 mês: foto na mesa online, selo e avatares exclusivos.', valor: 9.90, dias: 31 },
  apoio1990: { nome: 'Dominó Manauara - 3 meses', desc: 'Apoiador do Dominó Manauara por 3 meses: foto na mesa online, selo e avatares exclusivos.', valor: 19.90, dias: 92 },
  apoio2990: { nome: 'Dominó Manauara - 6 meses', desc: 'Apoiador do Dominó Manauara por 6 meses: foto na mesa online, selo e avatares exclusivos.', valor: 29.90, dias: 183 },
  livre: { nome: 'Dominó Manauara - apoio', livre: true },
  // até a 3.37.1 (continuam valendo para os pedidos já feitos e para algum celular que ainda não atualizou)
  apoio5: { nome: 'Dominó Manauara - 1 mês', desc: 'Apoiador do Dominó Manauara por 1 mês: foto na mesa online, selo e avatares exclusivos.', valor: 5, dias: 31 },
  apoio12: { nome: 'Dominó Manauara - 3 meses', desc: 'Apoiador do Dominó Manauara por 3 meses: foto na mesa online, selo e avatares exclusivos.', valor: 12, dias: 92 },
  apoio40: { nome: 'Dominó Manauara - 1 ano', desc: 'Apoiador do Dominó Manauara por 1 ano: foto na mesa online, selo e avatares exclusivos.', valor: 40, dias: 366 },
  // antigos (até a 3.21): continuam valendo para os pedidos já feitos e para algum celular que ainda não atualizou
  mensal: { nome: 'Plano Apoiador · 30 dias', desc: 'Dominó Manauara: sua foto na mesa online, selo de apoiador, avatares exclusivos e tudo do Personalizar liberado na hora, por 30 dias.', valor: 4.90, dias: 31 },
  anual: { nome: 'Plano Apoiador · 1 ano', desc: 'Dominó Manauara: sua foto na mesa online, selo de apoiador, avatares exclusivos e tudo do Personalizar liberado na hora, por 1 ano.', valor: 39.90, dias: 366 },
  doacao5: { nome: 'Doação ao Dominó Manauara', desc: 'Obrigado por ajudar a manter viva a tradição do dominó.', valor: 5 },
  doacao10: { nome: 'Doação ao Dominó Manauara', desc: 'Obrigado por ajudar a manter viva a tradição do dominó.', valor: 10 },
  doacao20: { nome: 'Doação ao Dominó Manauara', desc: 'Obrigado por ajudar a manter viva a tradição do dominó. Quem doa pode mostrar a foto na mesa online. De presente: 30 dias de Plano Apoiador.', valor: 20, brinde: 31 }
};
// Os botões que estão no app agora (o teste da publicação abre uma cobrança de cada)
export const A_VENDA = ['apm', 'ap3', 'ap12', 'ap1'];   // 28/10: mensal, trimestral e anual (renovam no cartão) e 1 mês avulso
// O preço de agora (na promoção de lançamento, o promocional)
export const emPromo = (prod, env, agora) => !!(prod && prod.promo && promoValendo(env, agora));
export const precoDe = (prod, env, agora) => emPromo(prod, env, agora) ? prod.promo.valor : prod.valor;
// GET /precos -> os preços de agora (o app mostra estes; sem internet, usa os dele)
export function precos(env, origin, h) {
  const itens = {};
  for (const k of A_VENDA) { const p = PRODUTOS[k], pr = emPromo(p, env); itens[k] = { valor: precoDe(p, env), normal: p.valor, vezes: pr ? p.promo.vezes : 0, ciclo: p.recorrente || null }; }
  return h.json({ promoAte: promoAte(env), promo: promoValendo(env), itens, agora: Date.now() }, 200, origin);
}
// Valor livre: de R$ 30 a R$ 500; cada R$ 5 vale 1 mês (R$ 60 = 12 meses = 1 ano)
export const LIVRE = { min: 30, max: 500, porMes: 5 };
export function valorLivre(v) {
  const n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  if (Math.abs(c - n * 100) > 1e-6 || c < LIVRE.min * 100 || c > LIVRE.max * 100) return null;
  return c / 100;
}
export const mesesDoValor = v => Math.floor((v + 1e-9) / LIVRE.porMes);
export const diasDosMeses = m => Math.ceil(m * 30.5);   // 1 = 31, 3 = 92, 6 = 183, 12 = 366
function textoMeses(m) { const a = Math.floor(m / 12), r = m % 12; return [a ? `${a} ${a === 1 ? 'ano' : 'anos'}` : '', r ? `${r} ${r === 1 ? 'mês' : 'meses'}` : ''].filter(Boolean).join(' e '); }
// o produto de um pedido (no valor livre, o tempo sai do valor pago)
export function produtoDoPedido(produto, valor) {
  const p = PRODUTOS[produto];
  if (!p) return null;
  if (!p.livre) return p;
  const meses = mesesDoValor(Number(valor) || 0);
  return Object.assign({}, p, { valor: Number(valor), dias: diasDosMeses(meses), desc: `Apoiador do Dominó Manauara por ${textoMeses(meses)}: foto na mesa online, selo e avatares exclusivos.` });
}
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
// A "conta de apoio" do aparelho é a linha em planos (ate = 0 quando só doou): é ela que tem o código para trocar de celular.
async function novaConta(env, aparelho, ate) {
  for (let k = 0; k < 5; k++) {
    try { await env.DB.prepare('INSERT INTO planos (aparelho, ate, desde, codigo) VALUES (?, ?, ?, ?)').bind(aparelho, ate, Date.now(), novoCodigo()).run(); return; }
    catch (e) { if (k === 4) throw e; }   // código repetido (raríssimo): tenta outro
  }
}
async function ligarPlano(env, aparelho, dias) {
  const agora = Date.now(), p = await planoDe(env, aparelho);
  const ate = Math.max(agora, (p && p.ate) || 0) + dias * DIA;
  if (p) await env.DB.prepare('UPDATE planos SET ate = ? WHERE aparelho = ?').bind(ate, aparelho).run();
  else await novaConta(env, aparelho, ate);
  return ate;
}
// data para o Asaas, no horário de Brasília (UTC-3): "AAAA-MM-DD HH:MM:SS"
const dataAsaas = t => new Date(t - 3 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
const diaBRde = t => new Date(t - 3 * 3600000).toISOString().slice(0, 10);
async function garantirConta(env, aparelho) { if (!(await planoDe(env, aparelho))) await novaConta(env, aparelho, 0); }

// Selo ♥: soma de todos os apoios pagos (desde a 3.22 qualquer pagamento conta; antes, só as doações), desde quando e o último
export const nivelDoador = t => t >= 100 ? 3 : t >= 30 ? 2 : t > 0 ? 1 : 0;
// 3.25: cortesia do dono (o aparelho do administrador): selo de doador e tempo de Apoiador sem pagamento — não entra
// em nenhuma soma de dinheiro nem na contagem de planos do painel.
export async function cortesiaDe(env, aparelho) {
  try { return await env.DB.prepare('SELECT nivel, desde FROM cortesias WHERE aparelho = ?').bind(aparelho).first(); } catch (e) { return null; }
}
export async function doadorDe(env, aparelho) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS total, MAX(pago_em) AS ultima FROM pedidos WHERE aparelho = ? AND status = 'pago'").bind(aparelho).first();
  const c = await cortesiaDe(env, aparelho);
  if ((!r || !r.n) && c) return { n: 0, total: 0, desde: c.desde, ultima: null, ultimoValor: null, nivel: c.nivel, cortesia: true };
  if (!r || !r.n) return null;
  const u = await env.DB.prepare("SELECT valor FROM pedidos WHERE aparelho = ? AND status = 'pago' ORDER BY pago_em DESC LIMIT 1").bind(aparelho).first();
  const d = await env.DB.prepare("SELECT MIN(pago_em) AS desde FROM pedidos WHERE aparelho = ? AND status = 'pago'").bind(aparelho).first();
  const total = Math.round(r.total * 100) / 100;
  return Object.assign({ n: r.n, total, desde: d && d.desde, ultima: r.ultima, ultimoValor: u ? u.valor : null, nivel: nivelDoador(total) },
    c ? { nivel: Math.max(nivelDoador(total), c.nivel), cortesia: true } : {});
}
// POST /dono/cortesia {aparelho, nivel?} — só com a chave do administrador
export async function donoCortesia(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  const nivel = Math.max(1, Math.min(3, Math.floor(Number(b.nivel) || 1)));
  await env.DB.prepare('INSERT INTO cortesias (aparelho, nivel, desde) VALUES (?, ?, ?) ON CONFLICT (aparelho) DO UPDATE SET nivel = excluded.nivel').bind(b.aparelho, nivel, Date.now()).run();
  const ate = Date.now() + 10 * 365 * DIA, pl = await planoDe(env, b.aparelho);
  if (!pl) await novaConta(env, b.aparelho, ate);
  else if (!(pl.ate > ate - 365 * DIA)) await env.DB.prepare('UPDATE planos SET ate = ? WHERE aparelho = ?').bind(ate, b.aparelho).run();
  return h.json(await contaDe(env, b.aparelho), 200, origin);
}
async function contaDe(env, aparelho) {
  const p = await planoDe(env, aparelho);
  const conta = { ate: p && p.ate ? p.ate : null, codigo: p ? p.codigo : null, doador: await doadorDe(env, aparelho), renova: await renovaDe(env, aparelho) };
  // 28/10: presente de quem já tinha pago antes do Sócio da Calçada (o app mostra o agradecimento uma vez)
  try { const g = await env.DB.prepare("SELECT dias, ate FROM presentes WHERE aparelho = ? AND tipo = 'fundador'").bind(aparelho).first(); if (g) conta.presente = { tipo: 'fundador', dias: g.dias, ate: g.ate }; } catch (e) {}
  return conta;
}

// O Asaas desliga a chave de API que fica 3 meses sem uso (e apaga em 6). Uma leitura por dia (só os dados da conta)
// mantém a chave viva mesmo num mês sem vendas. Roda na rotina diária, só na passada das 21h UTC.
export async function manterChaveAsaas(env) {
  if (!env.ASAAS_API_KEY || new Date().getUTCHours() !== 21) return;
  await asaas(env, '/myAccount/commercialInfo');
}

// POST /pagar {produto, aparelho} -> cria a página de pagamento do Asaas e devolve o link
export async function pagar(req, env, origin, h) {
  if (!env.ASAAS_API_KEY) return h.json({ erro: 'sem-pagamento' }, 503, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!PRODUTOS[b.produto]) return h.json({ erro: 'produto' }, 400, origin);
  if (PRODUTOS[b.produto].livre && valorLivre(b.valor) == null) return h.json({ erro: 'valor', min: LIVRE.min, max: LIVRE.max }, 400, origin);
  const prod = produtoDoPedido(b.produto, PRODUTOS[b.produto].livre ? valorLivre(b.valor) : undefined);
  if (prod.dias && !idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  const agora = Date.now(), promo = emPromo(prod, env, agora), valor = precoDe(prod, env, agora);   // 28/10: promoção de lançamento
  const marca = await h.marcaDoDia(req, env);
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM pedidos WHERE marca = ? AND criado_em > ?').bind(marca, Date.now() - 3600000).first();
  if (r && r.n >= PEDIDOS_POR_HORA) return h.json({ erro: 'muitos' }, 429, origin);
  const id = hex(10), site = (env.SITE_URL || h.SITE).replace(/\/$/, '');
  // Sem externalReference de propósito: a conta do Asaas é a mesma do alug+, e o aviso de pagamento do alug+ usa esse campo
  // como id de usuário (sem ele, o alug+ ignora a cobrança). O pedido é achado pelo id do checkout.
  // 28/10: o que renova é uma assinatura do Asaas (só cartão: no Pix a pessoa teria de pagar na mão a cada vez)
  const corpo = {
    billingTypes: prod.recorrente ? ['CREDIT_CARD'] : ['PIX', 'CREDIT_CARD'], chargeTypes: [prod.recorrente ? 'RECURRENT' : 'DETACHED'], minutesToExpire: 60,
    callback: { successUrl: `${site}/?pago=${id}`, cancelUrl: `${site}/?pago=cancelado`, expiredUrl: `${site}/?pago=expirado` },
    items: [{ name: prod.nome, description: prod.desc, quantity: 1, value: valor }]
  };
  if (prod.recorrente) corpo.subscription = { cycle: prod.recorrente, nextDueDate: dataAsaas(agora) };
  const res = await asaas(env, '/checkouts', 'POST', corpo);
  if (res.status !== 200 || !res.j.link || !res.j.id) {
    const det = res.j && res.j.errors && res.j.errors[0] ? res.j.errors[0].description : 'código ' + res.status;
    return h.json({ erro: 'asaas', detalhe: String(det).slice(0, 200) }, 502, origin);
  }
  await env.DB.prepare('INSERT INTO pedidos (id, checkout, aparelho, produto, valor, status, criado_em, marca) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, String(res.j.id), idOk(b.aparelho) ? b.aparelho : null, b.produto, valor, 'aberto', Date.now(), marca).run();
  if (prod.recorrente) await env.DB.prepare("INSERT INTO assinaturas (pedido, aparelho, checkout, status, criado_em, produto, valor, promo, pagos) VALUES (?, ?, ?, 'aberta', ?, ?, ?, ?, 0)")
    .bind(id, b.aparelho, String(res.j.id), Date.now(), b.produto, valor, promo ? prod.promo.vezes : 0).run();
  return h.json({ pedido: id, link: res.j.link, checkout: res.j.id, valor }, 201, origin);
}

// GET /pedido/:id -> situação do pagamento (o app pergunta quando volta do Asaas)
export async function pedido(env, origin, h, id) {
  const p = await env.DB.prepare('SELECT produto, status, aparelho, valor FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return h.json({ erro: 'nao-encontrado' }, 404, origin);
  const prod = produtoDoPedido(p.produto, p.valor) || {};
  const out = { status: p.status, produto: p.produto, plano: !!prod.dias, brinde: !!prod.brinde };
  if (p.status === 'pago' && p.aparelho) {
    const c = await contaDe(env, p.aparelho);
    if (c.codigo) out.codigo = c.codigo;
    if (c.ate) out.ate = c.ate;
    if (c.doador) out.doador = c.doador;
    out.renova = c.renova;   // 28/10
  }
  return h.json(out, 200, origin);
}

// GET /plano?aparelho= -> até quando o plano vale (e o código para trocar de celular)
export async function plano(env, origin, h, url) {
  const ap = url.searchParams.get('aparelho');
  if (!idOk(ap)) return h.json({ erro: 'aparelho' }, 400, origin);
  return h.json(await contaDe(env, ap), 200, origin);
}

// ---------- 3.39: progresso do jogo guardado para quem apoia ----------
// Só as partes do progresso (nada de chave do dono, código do aparelho, plano ou pedidos). Até 64 KB.
export const PROGRESSO_CHAVES = ['dmz-perfil', 'dmz-historico', 'dmz-nivel', 'dmz-missoes', 'dmz-avatar-montado', 'dmz-conquistas-vistas',
  'dmz-mesa-cor', 'dmz-copa357', 'dmz-laterais', 'dmz-torneio', 'dmz-mesas-rodizio'];
const PROGRESSO_MAX = 64 * 1024;
async function apoia(env, aparelho) {
  if (await env.DB.prepare('SELECT 1 AS x FROM planos WHERE aparelho = ?').bind(aparelho).first()) return true;
  return !!(await cortesiaDe(env, aparelho));
}
async function progressoDe(env, aparelho) {
  const r = await env.DB.prepare('SELECT dados, atualizado FROM progresso WHERE aparelho = ?').bind(aparelho).first();
  if (!r) return null;
  try { return { dados: JSON.parse(r.dados), atualizado: r.atualizado }; } catch (e) { return null; }
}
// POST /progresso {aparelho, dados: {chave: texto}} -> guarda (só quem apoia)
export async function guardarProgresso(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!b || !idOk(b.aparelho) || !b.dados || typeof b.dados !== 'object') return h.json({ erro: 'dados' }, 400, origin);
  if (!(await apoia(env, b.aparelho))) return h.json({ erro: 'so-apoiador' }, 403, origin);
  const dados = {};
  for (const k of PROGRESSO_CHAVES) if (typeof b.dados[k] === 'string') dados[k] = b.dados[k];
  const txt = JSON.stringify(dados);
  if (txt.length > PROGRESSO_MAX) return h.json({ erro: 'grande' }, 413, origin);
  await env.DB.prepare('INSERT INTO progresso (aparelho, dados, atualizado) VALUES (?, ?, ?) ON CONFLICT(aparelho) DO UPDATE SET dados = excluded.dados, atualizado = excluded.atualizado')
    .bind(b.aparelho, txt, Date.now()).run();
  return h.json({ ok: true }, 200, origin);
}
// GET /progresso?aparelho= -> o progresso guardado deste aparelho
export async function verProgresso(env, origin, h, url) {
  const ap = url.searchParams.get('aparelho');
  if (!idOk(ap)) return h.json({ erro: 'aparelho' }, 400, origin);
  const p = await progressoDe(env, ap);
  return p ? h.json(p, 200, origin) : h.json({ erro: 'nao-encontrado' }, 404, origin);
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
    // as doações vêm junto (o selo ♥ e o avatar do doador acompanham o código)
    await env.DB.prepare('UPDATE pedidos SET aparelho = ? WHERE aparelho = ?').bind(b.aparelho, p.aparelho).run();
    // e a foto da mesa online também
    if (await env.DB.prepare('SELECT 1 FROM fotos WHERE aparelho = ?').bind(p.aparelho).first()) {
      await env.DB.prepare('DELETE FROM fotos WHERE aparelho = ?').bind(b.aparelho).run();
      await env.DB.prepare('UPDATE fotos SET aparelho = ? WHERE aparelho = ?').bind(b.aparelho, p.aparelho).run();
    }
    try { await env.DB.prepare('UPDATE OR IGNORE presentes SET aparelho = ? WHERE aparelho = ?').bind(b.aparelho, p.aparelho).run(); } catch (e) {}
    // 28/10: e a assinatura (a renovação do mês continua caindo no aparelho novo)
    await env.DB.prepare('UPDATE assinaturas SET aparelho = ? WHERE aparelho = ?').bind(b.aparelho, p.aparelho).run();
    // 3.39: e o progresso do jogo guardado
    if (await env.DB.prepare('SELECT 1 FROM progresso WHERE aparelho = ?').bind(p.aparelho).first()) {
      await env.DB.prepare('DELETE FROM progresso WHERE aparelho = ?').bind(b.aparelho).run();
      await env.DB.prepare('UPDATE progresso SET aparelho = ? WHERE aparelho = ?').bind(b.aparelho, p.aparelho).run();
    }
  }
  const conta = await contaDe(env, b.aparelho), prog = await progressoDe(env, b.aparelho);
  return h.json(Object.assign(conta, prog ? { progresso: prog } : {}), 200, origin);
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
    const p = await env.DB.prepare('SELECT id, aparelho, produto, status, valor FROM pedidos WHERE checkout = ? OR id = ?').bind(String(c.id || ''), String(c.externalReference || '')).first();
    if (p) await pedidoPago(env, p);
    // 28/10: assinatura (mensal que renova): guarda o cliente do Asaas e procura a assinatura criada pelo checkout
    if (p) {
      const a = await env.DB.prepare('SELECT * FROM assinaturas WHERE pedido = ?').bind(p.id).first();
      if (a) {
        await env.DB.prepare("UPDATE assinaturas SET status = CASE WHEN status = 'aberta' THEN 'ativa' ELSE status END, pago_em = COALESCE(pago_em, ?), cliente = COALESCE(cliente, ?), pagos = MAX(pagos, 1) WHERE pedido = ?")
          .bind(Date.now(), c.customer ? String(c.customer) : null, p.id).run();
        if (!a.assinatura) await ligarAssinatura(env, p.id);
        await reajustar(env, p.id);
      }
    }
  }
  // 28/10: assinatura criada / cancelada no Asaas
  if (b.subscription && /^SUBSCRIPTION_/.test(b.event || '')) {
    const s = b.subscription;
    if (b.event === 'SUBSCRIPTION_CREATED') { const a = await achaAssinatura(env, { assinatura: s.id, checkout: s.checkoutSession || s.checkout, cliente: s.customer, valor: s.value, ciclo: s.cycle }); if (a) await reajustar(env, a.pedido); }
    if (b.event === 'SUBSCRIPTION_DELETED' || b.event === 'SUBSCRIPTION_INACTIVATED')
      await env.DB.prepare("UPDATE assinaturas SET status = 'cancelada', cancelada_em = COALESCE(cancelada_em, ?) WHERE assinatura = ?").bind(Date.now(), String(s.id || '')).run();
  }
  // 28/10: cobrança de uma assinatura paga (o primeiro mês e os seguintes)
  if ((b.event === 'PAYMENT_CONFIRMED' || b.event === 'PAYMENT_RECEIVED') && b.payment && b.payment.subscription) await mesDaAssinatura(env, b.payment);
  if ((b.event === 'CHECKOUT_CANCELED' || b.event === 'CHECKOUT_EXPIRED') && b.checkout) {
    await env.DB.prepare("UPDATE pedidos SET status = ? WHERE checkout = ? AND status = 'aberto'").bind(b.event === 'CHECKOUT_CANCELED' ? 'cancelado' : 'expirado', String(b.checkout.id || '')).run();
    await env.DB.prepare("UPDATE assinaturas SET status = 'desistiu' WHERE checkout = ? AND status = 'aberta'").bind(String(b.checkout.id || '')).run();   // 28/10
  }
  return new Response('ok');
}

// Pedido pago (checkout ou primeira cobrança da assinatura): liga o plano uma vez só
async function pedidoPago(env, p) {
  if (!p || p.status === 'pago') return false;
  const res = await env.DB.prepare("UPDATE pedidos SET status = 'pago', pago_em = ? WHERE id = ? AND status <> 'pago'").bind(Date.now(), p.id).run();
  if (!mudou(res)) return false;
  const prod = produtoDoPedido(p.produto, p.valor);
  if (prod && p.aparelho) {
    if (prod.dias || prod.brinde) await ligarPlano(env, p.aparelho, prod.dias || prod.brinde);
    else await garantirConta(env, p.aparelho);
  }
  return true;
}
// ---------- 28/10: assinatura (Sócio da Calçada mensal, trimestral ou anual, renova sozinho no cartão) ----------
// O Asaas não diz no aviso do checkout qual assinatura ele criou; ligamos pelo que vier primeiro: o checkout de origem
// (checkoutSession), o cliente criado no pagamento ou a busca das assinaturas desse cliente.
async function achaAssinatura(env, { assinatura, checkout, cliente, valor, ciclo }) {
  if (!assinatura) return null;
  let a = await env.DB.prepare('SELECT * FROM assinaturas WHERE assinatura = ?').bind(String(assinatura)).first();
  if (!a && checkout) a = await env.DB.prepare('SELECT * FROM assinaturas WHERE checkout = ? AND assinatura IS NULL').bind(String(checkout)).first();
  if (!a && cliente) a = await env.DB.prepare('SELECT * FROM assinaturas WHERE cliente = ? AND assinatura IS NULL ORDER BY criado_em DESC LIMIT 1').bind(String(cliente)).first();
  // último recurso (só no aviso de assinatura criada): o único pedido de assinatura aberto nas últimas 2 horas com o mesmo
  // produto, se o valor e o ciclo baterem (a conta do Asaas é a mesma do alug+: assinatura de outro valor nunca liga aqui)
  const prodC = !a && ciclo ? Object.keys(PRODUTOS).find(k => PRODUTOS[k].recorrente === ciclo) : null;
  if (prodC) {
    const { results } = await env.DB.prepare("SELECT * FROM assinaturas WHERE assinatura IS NULL AND produto = ? AND status IN ('aberta', 'ativa') AND aparelho NOT LIKE 'teste-publicacao-%' AND criado_em > ? AND ABS(COALESCE(valor, 0) - ?) < 0.005 LIMIT 2")
      .bind(prodC, Date.now() - 2 * 3600000, Number(valor) || 0).all();
    if (results && results.length === 1) a = results[0];
  }
  if (!a) return null;
  if (!a.assinatura || (cliente && !a.cliente)) {
    await env.DB.prepare('UPDATE assinaturas SET assinatura = COALESCE(assinatura, ?), cliente = COALESCE(cliente, ?) WHERE pedido = ?').bind(String(assinatura), cliente ? String(cliente) : null, a.pedido).run();
    a = await env.DB.prepare('SELECT * FROM assinaturas WHERE pedido = ?').bind(a.pedido).first();
  }
  return a;
}
// Procura no Asaas a assinatura do cliente deste pedido (quando o aviso não trouxe)
async function ligarAssinatura(env, pedidoId) {
  const a = await env.DB.prepare('SELECT * FROM assinaturas WHERE pedido = ?').bind(pedidoId).first();
  if (!a) return null;
  if (a.assinatura) return a.assinatura;
  if (!env.ASAAS_API_KEY) return null;
  try {
    // pelo cliente; sem ele, as assinaturas mais novas da conta que vieram deste checkout
    const r = await asaas(env, a.cliente ? '/subscriptions?customer=' + encodeURIComponent(a.cliente) + '&limit=10' : '/subscriptions?limit=30');
    const lista = (r.j && r.j.data) || [];
    for (const s of lista) {
      if (!s || !s.id || s.deleted) continue;
      if (!a.cliente && String(s.checkoutSession || '') !== String(a.checkout || '-')) continue;
      if (await env.DB.prepare('SELECT 1 FROM assinaturas WHERE assinatura = ?').bind(String(s.id)).first()) continue;
      await env.DB.prepare('UPDATE assinaturas SET assinatura = ? WHERE pedido = ? AND assinatura IS NULL').bind(String(s.id), a.pedido).run();
      return String(s.id);
    }
  } catch (e) {}
  return null;
}
// Uma cobrança paga da assinatura. A primeira já ligou pelo checkout (ou liga aqui, se este aviso chegar antes); as
// seguintes viram um pedido pago novo (entram no painel e no selo ♥) e somam o tempo do plano (31, 92 ou 366 dias).
// Cada cobrança conta uma vez. Depois da última com o preço da promoção, o valor da assinatura passa para o normal.
async function mesDaAssinatura(env, pay) {
  const a = await achaAssinatura(env, { assinatura: pay.subscription, checkout: pay.checkoutSession, cliente: pay.customer });
  if (!a) return;   // não é do jogo (a conta do Asaas é a mesma do alug+)
  const prod = PRODUTOS[a.produto] || PRODUTOS.apm;
  const primeiro = !pay.dueDate || String(pay.dueDate).slice(0, 10) <= diaBRde(a.criado_em + 3 * DIA);
  if (primeiro) {
    const p = await env.DB.prepare('SELECT id, aparelho, produto, status, valor FROM pedidos WHERE id = ?').bind(a.pedido).first();
    if (p && p.status !== 'pago') await pedidoPago(env, p);
    await env.DB.prepare("UPDATE assinaturas SET status = CASE WHEN status = 'aberta' THEN 'ativa' ELSE status END, pago_em = COALESCE(pago_em, ?), pagos = MAX(pagos, 1) WHERE pedido = ?").bind(Date.now(), a.pedido).run();
    await reajustar(env, a.pedido);
    return;
  }
  const chave = 'pay:' + String(pay.id || ''), id = hex(10), agora = Date.now(), valor = Number(pay.value) || prod.valor;
  if (!pay.id) return;
  const res = await env.DB.prepare(`INSERT INTO pedidos (id, checkout, aparelho, produto, valor, status, criado_em, pago_em, marca)
    SELECT ?, ?, ?, ?, ?, 'pago', ?, ?, NULL WHERE NOT EXISTS (SELECT 1 FROM pedidos WHERE checkout = ?)`).bind(id, chave, a.aparelho, a.produto || 'apm', valor, agora, agora, chave).run();
  if (mudou(res)) {
    await ligarPlano(env, a.aparelho, prod.dias);
    await env.DB.prepare('UPDATE assinaturas SET pagos = MAX(pagos, 1) + 1 WHERE pedido = ?').bind(a.pedido).run();
    await reajustar(env, a.pedido);
  }
}
// Fim da promoção de uma assinatura: paga a última cobrança com o preço promocional, o valor da assinatura no Asaas passa
// para o normal (as cobranças já geradas e ainda não pagas também: updatePendingPayments). No cartão, o Asaas só deixa
// mudar o valor com a tokenização liberada na conta; se não der, guarda o erro (aparece na Área do dono) e tenta de novo
// na rotina (no máximo a cada 6 horas). Quem assina sem promoção já paga o normal desde o começo.
export async function reajustar(env, pedidoId, forcar) {
  const a = await env.DB.prepare('SELECT * FROM assinaturas WHERE pedido = ?').bind(pedidoId).first();
  if (!a || a.reajustada || !(a.promo > 0) || a.pagos < a.promo || a.status !== 'ativa') return false;
  const prod = PRODUTOS[a.produto]; if (!prod) return false;
  if (!forcar && a.reajuste_tentado && Date.now() - a.reajuste_tentado < 6 * 3600000) return false;
  const sub = a.assinatura || await ligarAssinatura(env, a.pedido);
  if (!sub || !env.ASAAS_API_KEY) return false;
  await env.DB.prepare('UPDATE assinaturas SET reajuste_tentado = ? WHERE pedido = ?').bind(Date.now(), a.pedido).run();
  let r;
  try { r = await asaas(env, '/subscriptions/' + encodeURIComponent(sub), 'PUT', { value: prod.valor, updatePendingPayments: true }); }
  catch (e) { r = { status: 0, j: {} }; }
  if (r.status === 200 && (!r.j || r.j.value == null || Math.abs(Number(r.j.value) - prod.valor) < 0.005)) {
    await env.DB.prepare('UPDATE assinaturas SET reajustada = ?, reajuste_erro = NULL WHERE pedido = ?').bind(Date.now(), a.pedido).run();
    return true;
  }
  const det = r.j && r.j.errors && r.j.errors[0] ? r.j.errors[0].description : 'código ' + r.status;
  await env.DB.prepare('UPDATE assinaturas SET reajuste_erro = ? WHERE pedido = ?').bind(String(det).slice(0, 160), a.pedido).run();
  return false;
}
// Na rotina: as assinaturas que já passaram da promoção e ainda não mudaram de valor (poucas por vez)
export async function reajustesPendentes(env) {
  if (!env.ASAAS_API_KEY) return 0;
  const { results } = await env.DB.prepare("SELECT pedido FROM assinaturas WHERE status = 'ativa' AND promo > 0 AND pagos >= promo AND reajustada IS NULL AND (reajuste_tentado IS NULL OR reajuste_tentado < ?) LIMIT 10")
    .bind(Date.now() - 6 * 3600000).all();
  let n = 0;
  for (const x of results || []) if (await reajustar(env, x.pedido)) n++;
  return n;
}
// POST /plano/cancelar {aparelho} -> cancela a renovação no Asaas; o tempo já pago vale até o fim
export async function cancelarAssinatura(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  const a = await env.DB.prepare("SELECT * FROM assinaturas WHERE aparelho = ? AND status = 'ativa' ORDER BY criado_em DESC LIMIT 1").bind(b.aparelho).first();
  if (!a) return h.json(Object.assign({ erro: 'sem-assinatura' }, await contaDe(env, b.aparelho)), 404, origin);
  const id = a.assinatura || await ligarAssinatura(env, a.pedido);
  if (!id) return h.json({ erro: 'asaas', detalhe: 'assinatura não encontrada' }, 502, origin);
  const r = await asaas(env, '/subscriptions/' + encodeURIComponent(id), 'DELETE');
  if (!(r.status === 200 || r.status === 404 || (r.j && r.j.deleted))) return h.json({ erro: 'asaas', detalhe: 'código ' + r.status }, 502, origin);
  await env.DB.prepare("UPDATE assinaturas SET status = 'cancelada', cancelada_em = ? WHERE pedido = ?").bind(Date.now(), a.pedido).run();
  return h.json(await contaDe(env, b.aparelho), 200, origin);
}
// Assinatura que renova: qual plano, quanto é a próxima cobrança e quantas ainda têm o preço da promoção (null = não renova)
async function renovaDe(env, aparelho) {
  try {
    const a = await env.DB.prepare("SELECT produto, valor, promo, pagos FROM assinaturas WHERE aparelho = ? AND status = 'ativa' ORDER BY criado_em DESC LIMIT 1").bind(aparelho).first();
    if (!a) return null;
    const prod = PRODUTOS[a.produto] || PRODUTOS.apm, falta = Math.max(0, (a.promo || 0) - (a.pagos || 0));
    return { produto: a.produto, ciclo: prod.recorrente, proxima: falta > 0 ? (a.valor || prod.valor) : prod.valor, normal: prod.valor, promoFalta: falta };
  } catch (e) { return null; }
}

// POST /dono/pagamentos/:id/devolver -> o dono devolveu o dinheiro no Asaas: tira o selo de doador e os dias de plano desse pagamento
export async function donoDevolver(req, env, origin, h, id) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const p = await env.DB.prepare('SELECT id, aparelho, produto, status, valor FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return h.json({ erro: 'nao-encontrado' }, 404, origin);
  if (p.status !== 'pago') return h.json({ erro: 'nao-pago', status: p.status }, 409, origin);
  await env.DB.prepare("UPDATE pedidos SET status = 'devolvido' WHERE id = ?").bind(id).run();
  const prod = produtoDoPedido(p.produto, p.valor) || {}, dias = prod.dias || prod.brinde || 0;
  if (dias && p.aparelho) {
    const pl = await planoDe(env, p.aparelho);
    if (pl && pl.ate) await env.DB.prepare('UPDATE planos SET ate = ? WHERE aparelho = ?').bind(Math.max(0, pl.ate - dias * DIA), p.aparelho).run();
  }
  return h.json({ ok: true }, 200, origin);
}

// GET /dono/pagamentos -> resumo para a Área do dono (sem dados de quem pagou)
export async function donoPagamentos(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const d = new Date(); const inicioMes = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + 4 * 3600000;   // meia-noite em Manaus
  const mes = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS soma FROM pedidos WHERE status = 'pago' AND pago_em >= ?").bind(inicioMes).first();
  const tudo = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS soma FROM pedidos WHERE status = 'pago'").first();
  const ativos = await env.DB.prepare('SELECT COUNT(*) AS n FROM planos WHERE ate > ? AND aparelho NOT IN (SELECT aparelho FROM cortesias)').bind(Date.now()).first();
  const { results } = await env.DB.prepare("SELECT id, produto, valor, pago_em, status FROM pedidos WHERE status IN ('pago', 'devolvido') ORDER BY pago_em DESC LIMIT 20").all();
  // 28/10: assinaturas ativas e as que passaram da promoção sem conseguir mudar o valor no Asaas (com o último erro)
  let assin = null;
  try {
    const at = await env.DB.prepare("SELECT COUNT(*) AS n FROM assinaturas WHERE status = 'ativa' AND aparelho NOT LIKE 'teste-publicacao-%'").first();
    const pend = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(reajuste_erro) AS erro FROM assinaturas WHERE status = 'ativa' AND promo > 0 AND pagos >= promo AND reajustada IS NULL").first();
    assin = { ativas: (at && at.n) || 0, reajustePendente: (pend && pend.n) || 0, reajusteErro: (pend && pend.erro) || null };
  } catch (e) {}
  return h.json({ mes, tudo, planosAtivos: (ativos && ativos.n) || 0, ultimos: results || [], ligado: !!env.ASAAS_API_KEY, assinaturas: assin }, 200, origin);
}

// 3.41 (pedido do dono): quem apoia — plano ativo até quando, quanto já apoiou, quantas vezes e quando foi o último apoio.
// O apelido e o avatar vêm do último lugar em que a pessoa apareceu (no app, na mesa online ou no ranking).
export async function donoApoiadores(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const { results } = await env.DB.prepare(`SELECT a.aparelho,
      (SELECT ate FROM planos p WHERE p.aparelho = a.aparelho) AS ate,
      (SELECT desde FROM planos p WHERE p.aparelho = a.aparelho) AS desde,
      COALESCE((SELECT SUM(valor) FROM pedidos d WHERE d.aparelho = a.aparelho AND d.status = 'pago'), 0) AS total,
      (SELECT COUNT(*) FROM pedidos d WHERE d.aparelho = a.aparelho AND d.status = 'pago') AS n,
      (SELECT MAX(pago_em) FROM pedidos d WHERE d.aparelho = a.aparelho AND d.status = 'pago') AS ultimo,
      (SELECT 1 FROM cortesias c WHERE c.aparelho = a.aparelho) AS cortesia,
      (SELECT 1 FROM assinaturas s WHERE s.aparelho = a.aparelho AND s.status = 'ativa') AS renova,
      COALESCE((SELECT nome FROM presenca WHERE aparelho = a.aparelho AND nome IS NOT NULL), (SELECT nome FROM jogadores_vistos WHERE aparelho = a.aparelho),
        (SELECT nome FROM ranking WHERE aparelho = a.aparelho ORDER BY atualizado DESC LIMIT 1)) AS nome,
      COALESCE((SELECT av FROM presenca WHERE aparelho = a.aparelho AND av IS NOT NULL), (SELECT av FROM jogadores_vistos WHERE aparelho = a.aparelho),
        (SELECT av FROM ranking WHERE aparelho = a.aparelho ORDER BY atualizado DESC LIMIT 1)) AS av
    FROM (SELECT aparelho FROM pedidos WHERE status = 'pago' AND aparelho IS NOT NULL AND aparelho <> '' UNION SELECT aparelho FROM planos) a
    ORDER BY COALESCE(ultimo, desde) DESC LIMIT 300`).all();
  return h.json({ lista: results || [], agora: Date.now() }, 200, origin);
}
