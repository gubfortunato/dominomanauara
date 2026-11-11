// Turmas e o Desafio das Confrarias.
// Turma: um grupo de amigos que se junta por um código (6 letras e números). Cada aparelho fica em uma Turma por vez.
// Desafio das Confrarias: de 1º/11 a 20/12 (horário de Manaus), cada vitória numa partida online contra alguém de
// outra Turma vale 1 ponto para a Turma de quem ganhou (no máximo 5 por dia contra a mesma Turma, para ninguém
// combinar resultado). A Turma com mais pontos leva o título do ano; com 3 títulos, a Grande Taça.
import { bloqueado } from './bloqueio.js';
import { nomeOfensivo } from './motor.js';

const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MEMBROS = 40, MAX_POR_PAR_DIA = 5;
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const codOk = v => new RegExp(`^[${LETRAS}]{6}$`).test(String(v || ''));
const limpa = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const MANAUS = 4 * 3600000;
const diaManaus = t => new Date(t - MANAUS).toISOString().slice(0, 10);
// 04/11 (dono): nome de Turma com termo de baixo calão não aparece em lugar nenhum (fica "Turma sem nome")
const nomeSeguro = n => n && nomeOfensivo(n) ? 'Turma sem nome' : n;
// 04/11 (dono): Turma que perdeu o nome (palavrão) pode escolher outro, uma vez, por quem criou (ou, se essa pessoa
// saiu, por quem está há mais tempo). Os pontos e os membros ficam.
const SEM_NOME = 'turma sem nome';
const nomeRetirado = n => !n || String(n).trim().toLowerCase() === SEM_NOME || nomeOfensivo(n);
async function responsavel(env, t) {
  if (t.criador) { const c = await env.DB.prepare('SELECT aparelho, nome FROM turma_membros WHERE turma = ? AND aparelho = ?').bind(t.codigo, t.criador).first(); if (c) return c; }
  return await env.DB.prepare('SELECT aparelho, nome FROM turma_membros WHERE turma = ? ORDER BY entrou LIMIT 1').bind(t.codigo).first();
}
function codigoNovo() { const b = crypto.getRandomValues(new Uint8Array(6)); return [...b].map(x => LETRAS[x % LETRAS.length]).join(''); }
// A edição do ano: começa 1º/11 0h e termina no fim de 20/12 (Manaus = UTC-4)
// 10/11 (pedido do dono: Desafio mais emocionante): reta final em dobro — de 14/12 até o fim, a vitória contra outra
// Turma vale 2 pontos quando tem sócio na dupla que ganhou (sem sócio, continua 1). O limite de 5 vitórias por dia contra
// a mesma Turma continua contando partidas.
export const RETA = { mes: 11, dia: 14, mult: 2 };
export function edicao(env, agora) {
  agora = agora ?? (Number(env.DESAFIO_AGORA) || Date.now());
  const ano = +diaManaus(agora).slice(0, 4);
  const inicio = Date.UTC(ano, 10, 1) + MANAUS, fim = Date.UTC(ano, 11, 21) + MANAUS, dobroDesde = Date.UTC(ano, RETA.mes, RETA.dia) + MANAUS;
  const aberto = agora >= inicio && agora < fim;
  return { ano, inicio, fim, dobroDesde, dobro: aberto && agora >= dobroDesde, aberto, antes: agora < inicio, depois: agora >= fim, agora };
}
const multDe = (ano, dia) => dia >= `${ano}-12-${String(RETA.dia).padStart(2, '0')}` ? RETA.mult : 1;
async function turmaDoAparelho(env, ap) {
  return await env.DB.prepare('SELECT t.codigo, t.nome, t.titulos, t.criador FROM turma_membros m JOIN turmas t ON t.codigo = m.turma WHERE m.aparelho = ?').bind(ap).first();
}
// Fecha a edição que acabou: a Turma com mais pontos (no empate, a que chegou primeiro) ganha um título
export async function fecharDesafio(env, agora) {
  const e = edicao(env, agora);
  if (!e.depois) return null;
  if (await env.DB.prepare('SELECT 1 FROM desafio_campeas WHERE edicao = ?').bind(e.ano).first()) return null;
  const top = await env.DB.prepare('SELECT turma, pontos FROM desafio_pontos WHERE edicao = ? AND pontos > 0 ORDER BY pontos DESC, ultimo ASC LIMIT 1').bind(e.ano).first();
  const r = await env.DB.prepare('INSERT OR IGNORE INTO desafio_campeas (edicao, turma, pontos, fechada_em) VALUES (?, ?, ?, ?)').bind(e.ano, top ? top.turma : null, top ? top.pontos : 0, Date.now()).run();
  const mudou = r && ((r.meta && r.meta.changes) || r.changes);
  if (top && mudou) await env.DB.prepare('UPDATE turmas SET titulos = titulos + 1 WHERE codigo = ?').bind(top.turma).run();
  return top;
}
// Fim de uma partida online: quem ganhou leva ponto para a Turma se perdeu alguém de outra Turma
// -> { turmas: nomes das Turmas que pontuaram, ids: quem ganhou e trouxe o ponto }
export async function pontuar(env, vencedores, perdedores) {
  const e = edicao(env);
  const nada = { turmas: [], ids: [], pontos: 0 };
  if (!e.aberto) return nada;
  const ids = [...new Set([...vencedores, ...perdedores].filter(idOk))];
  if (!ids.length) return nada;
  const { results } = await env.DB.prepare(`SELECT m.aparelho, t.codigo, t.nome FROM turma_membros m JOIN turmas t ON t.codigo = m.turma WHERE m.aparelho IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const de = new Map((results || []).map(r => [r.aparelho, r]));
  const contra = new Set(perdedores.map(id => de.get(id)).filter(Boolean).map(r => r.codigo));
  const feitas = new Map(), dia = diaManaus(e.agora), mult = multDe(e.ano, dia);
  // 10/11 (pedido do dono): na reta final, o dobro é de quem tem sócio na dupla
  const socios = new Set();
  if (mult > 1) {
    const ws = vencedores.filter(idOk);
    if (ws.length) { try { const { results: ps } = await env.DB.prepare(`SELECT aparelho FROM planos WHERE ate > ? AND aparelho IN (${ws.map(() => '?').join(',')})`).bind(Date.now(), ...ws).all(); (ps || []).forEach(r => socios.add(r.aparelho)); } catch (er) {} }
  }
  for (const id of vencedores) {
    const t = de.get(id); if (!t || feitas.has(t.codigo)) continue;
    const outra = [...contra].find(c => c !== t.codigo); if (!outra) continue;
    const delta = mult > 1 && vencedores.some(w => de.get(w) && de.get(w).codigo === t.codigo && socios.has(w)) ? mult : 1;
    const j = await env.DB.prepare('SELECT n FROM desafio_jogos WHERE edicao = ? AND dia = ? AND vencedora = ? AND perdedora = ?').bind(e.ano, dia, t.codigo, outra).first();
    if (j && j.n >= MAX_POR_PAR_DIA) continue;
    await env.DB.prepare('INSERT INTO desafio_jogos (edicao, dia, vencedora, perdedora, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT(edicao, dia, vencedora, perdedora) DO UPDATE SET n = n + 1').bind(e.ano, dia, t.codigo, outra).run();
    await env.DB.prepare('INSERT INTO desafio_pontos (edicao, turma, pontos, ultimo) VALUES (?, ?, ?, ?) ON CONFLICT(edicao, turma) DO UPDATE SET pontos = pontos + excluded.pontos, ultimo = excluded.ultimo').bind(e.ano, t.codigo, delta, Date.now()).run();
    try { await env.DB.prepare('INSERT INTO desafio_dia (edicao, dia, turma, pontos) VALUES (?, ?, ?, ?) ON CONFLICT(edicao, dia, turma) DO UPDATE SET pontos = pontos + excluded.pontos').bind(e.ano, dia, t.codigo, delta).run(); } catch (er) {}
    // 10/11: o craque da Turma — quem trouxe os pontos (os dois parceiros da mesma Turma levam)
    for (const w of vencedores) {
      const tw = de.get(w); if (!tw || tw.codigo !== t.codigo) continue;
      try { await env.DB.prepare('INSERT INTO desafio_membros (edicao, turma, aparelho, pontos, ultimo) VALUES (?, ?, ?, ?, ?) ON CONFLICT(edicao, turma, aparelho) DO UPDATE SET pontos = pontos + excluded.pontos, ultimo = excluded.ultimo').bind(e.ano, t.codigo, w, delta, Date.now()).run(); } catch (er) {}
    }
    feitas.set(t.codigo, { nome: t.nome, delta });
  }
  return { turmas: [...feitas.values()].map(x => x.nome), ids: vencedores.filter(id => de.get(id) && feitas.has(de.get(id).codigo)), pontos: feitas.size ? Math.max(...[...feitas.values()].map(x => x.delta)) : 0 };
}
async function ranking(env, ano, n) {
  const { results } = await env.DB.prepare(`SELECT t.codigo, t.nome, t.titulos, p.pontos, p.ultimo, (SELECT COUNT(*) FROM turma_membros m WHERE m.turma = t.codigo) AS membros
    FROM desafio_pontos p JOIN turmas t ON t.codigo = p.turma WHERE p.edicao = ? AND p.pontos > 0 ORDER BY p.pontos DESC, p.ultimo ASC LIMIT ?`).bind(ano, n).all();
  return results || [];
}
// 10/11: os pontos de hoje de cada Turma (pelas vitórias do dia) e a posição de ontem, para a seta de subiu/caiu
async function hojeEOntem(env, e, rk) {
  const dia = diaManaus(e.agora), mult = multDe(e.ano, dia);
  // antes da reta final, cada vitória do dia é 1 ponto; na reta final, vale o que ficou anotado no dia (1 ou 2 por vitória)
  const { results } = mult > 1
    ? await env.DB.prepare('SELECT turma AS vencedora, pontos AS n FROM desafio_dia WHERE edicao = ? AND dia = ?').bind(e.ano, dia).all()
    : await env.DB.prepare('SELECT vencedora, SUM(n) AS n FROM desafio_jogos WHERE edicao = ? AND dia = ? GROUP BY vencedora').bind(e.ano, dia).all();
  const hoje = new Map((results || []).map(r => [r.vencedora, r.n]));
  const ontem = rk.map(r => ({ codigo: r.codigo, p: r.pontos - (hoje.get(r.codigo) || 0), u: r.ultimo || 0 })).filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || a.u - b.u);
  const posOntem = new Map(ontem.map((x, i) => [x.codigo, i + 1]));
  return { hoje, posOntem };
}
// 10/11: o craque da Turma (quem mais trouxe pontos nesta edição; conta desde 10/11) e o confronto com a Turma rival
async function craquesERival(env, e, t) {
  const { results: cr } = await env.DB.prepare(`SELECT m.nome AS nome, d.pontos FROM desafio_membros d JOIN turma_membros m ON m.aparelho = d.aparelho AND m.turma = d.turma
    WHERE d.edicao = ? AND d.turma = ? AND d.pontos > 0 ORDER BY d.pontos DESC, d.ultimo ASC LIMIT 3`).bind(e.ano, t.codigo).all();
  const { results: jg } = await env.DB.prepare(`SELECT CASE WHEN vencedora = ? THEN perdedora ELSE vencedora END AS outra, SUM(CASE WHEN vencedora = ? THEN n ELSE 0 END) AS ganhou,
    SUM(CASE WHEN perdedora = ? THEN n ELSE 0 END) AS perdeu FROM desafio_jogos WHERE edicao = ? AND (vencedora = ? OR perdedora = ?) GROUP BY outra ORDER BY (ganhou + perdeu) DESC LIMIT 1`)
    .bind(t.codigo, t.codigo, t.codigo, e.ano, t.codigo, t.codigo).all();
  let rival = null;
  if (jg && jg[0]) { const o = await env.DB.prepare('SELECT nome FROM turmas WHERE codigo = ?').bind(jg[0].outra).first(); if (o) rival = { nome: nomeSeguro(o.nome), ganhou: jg[0].ganhou || 0, perdeu: jg[0].perdeu || 0 }; }
  return { craques: (cr || []).map(r => ({ nome: nomeOfensivo(r.nome) ? 'Jogador' : r.nome, pontos: r.pontos })), rival };
}
async function resumo(env, ap) {
  try { await fecharDesafio(env); } catch (e) {}
  const e = edicao(env);
  const rk = await ranking(env, e.ano, 50);
  let ho = { hoje: new Map(), posOntem: new Map() }; try { if (e.aberto) ho = await hojeEOntem(env, e, rk); } catch (er) {}
  const linha = (r, i) => ({ pos: i + 1, nome: nomeSeguro(r.nome), pontos: r.pontos, titulos: r.titulos, membros: r.membros, hoje: ho.hoje.get(r.codigo) || 0,
    mov: ho.posOntem.has(r.codigo) ? ho.posOntem.get(r.codigo) - (i + 1) : (ho.hoje.get(r.codigo) ? 'novo' : 0) });
  const campeas = (await env.DB.prepare('SELECT c.edicao, c.pontos, t.nome FROM desafio_campeas c LEFT JOIN turmas t ON t.codigo = c.turma ORDER BY c.edicao DESC LIMIT 10').all()).results || [];
  const desafio = { ano: e.ano, inicio: e.inicio, fim: e.fim, aberto: e.aberto, antes: e.antes, depois: e.depois, dobroDesde: e.dobroDesde, dobro: e.dobro, mult: RETA.mult,
    total: rk.length, ranking: rk.slice(0, 10).map(linha),
    campeas: campeas.filter(c => c.nome).map(c => ({ ano: c.edicao, nome: nomeSeguro(c.nome), pontos: c.pontos })) };
  let turma = null;
  if (idOk(ap)) {
    const t = await turmaDoAparelho(env, ap);
    if (t) {
      const { results } = await env.DB.prepare('SELECT nome FROM turma_membros WHERE turma = ? ORDER BY entrou LIMIT ?').bind(t.codigo, MAX_MEMBROS).all();
      const p = await env.DB.prepare('SELECT pontos FROM desafio_pontos WHERE edicao = ? AND turma = ?').bind(e.ano, t.codigo).first();
      const i = rk.findIndex(r => r.codigo === t.codigo);
      turma = { codigo: t.codigo, nome: nomeSeguro(t.nome), titulos: t.titulos, taca: t.titulos >= 3, membros: (results || []).map(r => r.nome), pontos: (p && p.pontos) || 0, pos: i >= 0 ? i + 1 : null };
      if (i >= 0) { const l = linha(rk[i], i); turma.hoje = l.hoje; turma.mov = l.mov; turma.acima = i > 0 ? { nome: nomeSeguro(rk[i - 1].nome), falta: rk[i - 1].pontos - rk[i].pontos } : null; }
      try { Object.assign(turma, await craquesERival(env, e, t)); } catch (er) {}
      if (nomeRetirado(t.nome)) {
        const r = await responsavel(env, t);
        turma.retirado = true; turma.renomeia = !!(r && r.aparelho === ap); turma.quemRenomeia = r ? r.nome : null; turma.quemCriou = !!(r && r.aparelho === t.criador);
      }
    }
  }
  return { desafio, turma };
}
// GET /turma?aparelho=  e  GET /desafio
export async function ver(env, origin, h, url) { return h.json(await resumo(env, url.searchParams.get('aparelho')), 200, origin); }
function apelidoOk(v) { const n = limpa(v, 16); return n.length >= 2 && !nomeOfensivo(n) ? n : 'Jogador'; }
// POST /turma/nova {aparelho, nome, apelido}
export async function nova(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (await bloqueado(env, b.aparelho)) return h.json({ erro: 'bloqueado' }, 403, origin);   // 3.25
  const nome = limpa(b.nome, 24);
  if (nome.length < 3 || nomeRetirado(nome)) return h.json({ erro: 'nome' }, 400, origin);
  if (await turmaDoAparelho(env, b.aparelho)) return h.json({ erro: 'ja-tem' }, 409, origin);
  if (await env.DB.prepare('SELECT 1 FROM turmas WHERE lower(nome) = lower(?)').bind(nome).first()) return h.json({ erro: 'nome-usado' }, 409, origin);
  const marca = await h.marcaDoDia(req, env);
  const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM tentativas WHERE marca = ? AND tipo = 'turma' AND criado_em > ?").bind(marca, Date.now() - 86400000).first();
  if (t && t.n >= 5) return h.json({ erro: 'muitas' }, 429, origin);
  await env.DB.prepare("INSERT INTO tentativas (marca, tipo, criado_em) VALUES (?, 'turma', ?)").bind(marca, Date.now()).run();
  for (let k = 0; k < 5; k++) {
    const codigo = codigoNovo();
    try {
      await env.DB.prepare('INSERT INTO turmas (codigo, nome, criador, criada, titulos) VALUES (?, ?, ?, ?, 0)').bind(codigo, nome, b.aparelho, Date.now()).run();
      await env.DB.prepare('INSERT INTO turma_membros (aparelho, turma, nome, entrou) VALUES (?, ?, ?, ?)').bind(b.aparelho, codigo, apelidoOk(b.apelido), Date.now()).run();
      return h.json(await resumo(env, b.aparelho), 201, origin);
    } catch (e) { /* código repetido: tenta outro */ }
  }
  return h.json({ erro: 'servidor' }, 500, origin);
}
// POST /turma/entrar {aparelho, codigo, apelido}
export async function entrar(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const codigo = String(b.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!idOk(b.aparelho) || !codOk(codigo)) return h.json({ erro: 'codigo' }, 400, origin);
  const t = await env.DB.prepare('SELECT codigo FROM turmas WHERE codigo = ?').bind(codigo).first();
  if (!t) return h.json({ erro: 'nao-existe' }, 404, origin);
  const ja = await turmaDoAparelho(env, b.aparelho);
  if (ja && ja.codigo === codigo) return h.json(await resumo(env, b.aparelho), 200, origin);
  if (ja) return h.json({ erro: 'ja-tem', turma: ja.nome }, 409, origin);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM turma_membros WHERE turma = ?').bind(codigo).first();
  if (n && n.n >= MAX_MEMBROS) return h.json({ erro: 'cheia' }, 409, origin);
  await env.DB.prepare('INSERT INTO turma_membros (aparelho, turma, nome, entrou) VALUES (?, ?, ?, ?)').bind(b.aparelho, codigo, apelidoOk(b.apelido), Date.now()).run();
  return h.json(await resumo(env, b.aparelho), 200, origin);
}
// POST /turma/nome {aparelho, nome}: novo nome para a Turma que teve o nome retirado
export async function renomear(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (await bloqueado(env, b.aparelho)) return h.json({ erro: 'bloqueado' }, 403, origin);
  const t = await turmaDoAparelho(env, b.aparelho);
  if (!t) return h.json({ erro: 'sem-turma' }, 404, origin);
  if (!nomeRetirado(t.nome)) return h.json({ erro: 'nao-pode' }, 403, origin);
  const r = await responsavel(env, t);
  if (!r || r.aparelho !== b.aparelho) return h.json({ erro: 'so-quem-criou' }, 403, origin);
  const marca = await h.marcaDoDia(req, env);
  const k = await env.DB.prepare("SELECT COUNT(*) AS n FROM tentativas WHERE marca = ? AND tipo = 'turma-nome' AND criado_em > ?").bind(marca, Date.now() - 86400000).first();
  if (k && k.n >= 15) return h.json({ erro: 'muitas' }, 429, origin);
  await env.DB.prepare("INSERT INTO tentativas (marca, tipo, criado_em) VALUES (?, 'turma-nome', ?)").bind(marca, Date.now()).run();
  const nome = limpa(b.nome, 24);
  if (nome.length < 3 || nomeRetirado(nome)) return h.json({ erro: 'nome' }, 400, origin);
  if (await env.DB.prepare('SELECT 1 FROM turmas WHERE lower(nome) = lower(?) AND codigo <> ?').bind(nome, t.codigo).first()) return h.json({ erro: 'nome-usado' }, 409, origin);
  try { await env.DB.prepare('UPDATE turmas SET nome = ? WHERE codigo = ?').bind(nome, t.codigo).run(); }
  catch (e) { return h.json({ erro: 'nome-usado' }, 409, origin); }
  return h.json(await resumo(env, b.aparelho), 200, origin);
}
// POST /turma/sair {aparelho}
export async function sair(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (await bloqueado(env, b.aparelho)) return h.json({ erro: 'bloqueado' }, 403, origin);   // 3.25
  await env.DB.prepare('DELETE FROM turma_membros WHERE aparelho = ?').bind(b.aparelho).run();
  try { await env.DB.prepare('DELETE FROM desafio_membros WHERE aparelho = ?').bind(b.aparelho).run(); } catch (e) {}   // 10/11: os pontos ficam na Turma; o nome sai do craque
  return h.json(await resumo(env, b.aparelho), 200, origin);
}
// Apelido na Turma acompanha o perfil (quando a pessoa joga online com outro apelido)
export async function apelido(env, ap, nome) {
  if (!idOk(ap)) return;
  await env.DB.prepare('UPDATE turma_membros SET nome = ? WHERE aparelho = ? AND nome <> ?').bind(nome, ap, nome).run();
}
// Nome da Turma de cada um, para a mesa mostrar
export async function nomeDaTurma(env, ap) {
  const t = idOk(ap) ? await turmaDoAparelho(env, ap) : null;
  return t ? nomeSeguro(t.nome) : null;
}

// 10/11 (pedido do dono): avisos do Desafio no celular, no máximo 1 por dia, às 18h (Manaus), só para quem está numa Turma:
// na véspera da reta final e no último dia, para todas as Turmas; nos outros dias, só para a Turma que mudou de posição desde
// o aviso anterior: entrou no pódio, ou outra Turma passou a sua (até o 10º lugar).
const nomeT = n => /^turma\b/i.test(String(n || '').trim()) ? n : 'Turma ' + n;
// as chamadas do Desafio para todo mundo (às 19h do dia), uma vez cada
const DIVULGA = {
  '2026-11-11': { titulo: '⚔️ Desafio das Confrarias: monte a sua Turma!', texto: 'Junte os amigos, desafie as outras Turmas de Manaus e leve a estrela de campeã. Os confrontos agora passam ao vivo na Calçada. Vale até 20/12.', url: '/?abrir=turma' },
  '2026-11-28': { titulo: '⚔️ Sua Turma já está no Desafio?', texto: 'Faltam 3 semanas para o fim do Desafio das Confrarias. Cada vitória online contra outra Turma vale ponto. Monte a sua e chame a turma!', url: '/?abrir=turma' }
};
export async function avisosDesafio(env, agora) {
  const e = edicao(env, agora); if (!e.aberto) return [];
  const d = new Date(e.agora - MANAUS), dia = d.toISOString().slice(0, 10), h = d.getUTCHours();
  const dd = n => `${e.ano}-12-${String(n).padStart(2, '0')}`;
  // 10/11 (pedido do dono: "vamos divulgar mais o Desafio"): chamada para todo mundo, com guarda na caixa de mensagens
  if (h === 19 && DIVULGA[dia]) return [{ chave: `ds:${dia}:divulga`, para: 'todos', caixa: true, msg: DIVULGA[dia] }];
  if (h !== 18) return [];
  if (dia === dd(RETA.dia - 1)) return [{ chave: `ds:${e.ano}:vespera`, para: 'todos', caixa: true,
    msg: { titulo: 'Amanhã começa a reta final do Desafio! 🔥', texto: `De ${RETA.dia}/12 a 20/12, a vitória contra outra Turma com sócio na dupla vale ${RETA.mult} pontos. Ainda não tem Turma? Monte a sua e chame os amigos.`, url: '/?abrir=turma' } }];
  if (dia === dd(20)) return [{ chave: `ds:${e.ano}:ultimo`, para: 'turmas',
    msg: { titulo: 'Último dia do Desafio das Confrarias! ⚔️', texto: `Hoje até meia-noite, a vitória contra outra Turma com sócio na dupla ainda vale ${RETA.mult} pontos. Bora fechar com chave de ouro!`, url: '/?abrir=turma' } }];
  const rk = await ranking(env, e.ano, 50), out = [];
  const { results } = await env.DB.prepare('SELECT turma, pos FROM desafio_pos WHERE edicao = ?').bind(e.ano).all();
  const antes = new Map((results || []).map(r => [r.turma, r.pos]));
  if (antes.size) {
    for (let i = 0; i < rk.length; i++) {
      const r = rk[i], pos = i + 1, ant = antes.get(r.codigo);
      let msg = null;
      if (pos <= 3 && (!ant || ant > 3)) msg = { titulo: `${nomeT(nomeSeguro(r.nome))} no pódio! 🏆`, texto: `Vocês estão em ${pos}º lugar no Desafio das Confrarias, com ${r.pontos} pontos. Segura essa posição!`, url: '/?abrir=turma' };
      else if (ant && pos > ant && ant <= 10 && i > 0) msg = { titulo: `A ${nomeT(nomeSeguro(rk[i - 1].nome))} passou vocês! ⚔️`, texto: `A ${nomeT(nomeSeguro(r.nome))} caiu para ${pos}º no Desafio das Confrarias. Faltam ${rk[i - 1].pontos - r.pontos + 1} ${rk[i - 1].pontos - r.pontos + 1 === 1 ? 'ponto' : 'pontos'} para recuperar. Bora pra mesa?`, url: '/?abrir=turma' };
      if (!msg) continue;
      const { results: ms } = await env.DB.prepare('SELECT aparelho FROM turma_membros WHERE turma = ?').bind(r.codigo).all();
      const aps = (ms || []).map(x => x.aparelho);
      if (aps.length) out.push({ chave: `ds:${dia}:${r.codigo}`, para: { aparelhos: aps }, msg });
    }
  }
  // guarda as posições de agora para comparar amanhã
  try {
    const st = env.DB.prepare('INSERT INTO desafio_pos (edicao, turma, pos, em) VALUES (?, ?, ?, ?) ON CONFLICT(edicao, turma) DO UPDATE SET pos = excluded.pos, em = excluded.em');
    if (rk.length) await env.DB.batch(rk.map((r, i) => st.bind(e.ano, r.codigo, i + 1, e.agora)));
  } catch (er) {}
  return out;
}
