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
function codigoNovo() { const b = crypto.getRandomValues(new Uint8Array(6)); return [...b].map(x => LETRAS[x % LETRAS.length]).join(''); }
// A edição do ano: começa 1º/11 0h e termina no fim de 20/12 (Manaus = UTC-4)
export function edicao(env, agora) {
  agora = agora ?? (Number(env.DESAFIO_AGORA) || Date.now());
  const ano = +diaManaus(agora).slice(0, 4);
  const inicio = Date.UTC(ano, 10, 1) + MANAUS, fim = Date.UTC(ano, 11, 21) + MANAUS;
  return { ano, inicio, fim, aberto: agora >= inicio && agora < fim, antes: agora < inicio, depois: agora >= fim, agora };
}
async function turmaDoAparelho(env, ap) {
  return await env.DB.prepare('SELECT t.codigo, t.nome, t.titulos FROM turma_membros m JOIN turmas t ON t.codigo = m.turma WHERE m.aparelho = ?').bind(ap).first();
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
  const nada = { turmas: [], ids: [] };
  if (!e.aberto) return nada;
  const ids = [...new Set([...vencedores, ...perdedores].filter(idOk))];
  if (!ids.length) return nada;
  const { results } = await env.DB.prepare(`SELECT m.aparelho, t.codigo, t.nome FROM turma_membros m JOIN turmas t ON t.codigo = m.turma WHERE m.aparelho IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const de = new Map((results || []).map(r => [r.aparelho, r]));
  const contra = new Set(perdedores.map(id => de.get(id)).filter(Boolean).map(r => r.codigo));
  const feitas = new Map();
  for (const id of vencedores) {
    const t = de.get(id); if (!t || feitas.has(t.codigo)) continue;
    const outra = [...contra].find(c => c !== t.codigo); if (!outra) continue;
    const dia = diaManaus(e.agora);
    const j = await env.DB.prepare('SELECT n FROM desafio_jogos WHERE edicao = ? AND dia = ? AND vencedora = ? AND perdedora = ?').bind(e.ano, dia, t.codigo, outra).first();
    if (j && j.n >= MAX_POR_PAR_DIA) continue;
    await env.DB.prepare('INSERT INTO desafio_jogos (edicao, dia, vencedora, perdedora, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT(edicao, dia, vencedora, perdedora) DO UPDATE SET n = n + 1').bind(e.ano, dia, t.codigo, outra).run();
    await env.DB.prepare('INSERT INTO desafio_pontos (edicao, turma, pontos, ultimo) VALUES (?, ?, 1, ?) ON CONFLICT(edicao, turma) DO UPDATE SET pontos = pontos + 1, ultimo = excluded.ultimo').bind(e.ano, t.codigo, Date.now()).run();
    feitas.set(t.codigo, t.nome);
  }
  return { turmas: [...feitas.values()], ids: vencedores.filter(id => de.get(id) && feitas.has(de.get(id).codigo)) };
}
async function ranking(env, ano, n) {
  const { results } = await env.DB.prepare(`SELECT t.codigo, t.nome, t.titulos, p.pontos, (SELECT COUNT(*) FROM turma_membros m WHERE m.turma = t.codigo) AS membros
    FROM desafio_pontos p JOIN turmas t ON t.codigo = p.turma WHERE p.edicao = ? AND p.pontos > 0 ORDER BY p.pontos DESC, p.ultimo ASC LIMIT ?`).bind(ano, n).all();
  return results || [];
}
async function resumo(env, ap) {
  try { await fecharDesafio(env); } catch (e) {}
  const e = edicao(env);
  const rk = await ranking(env, e.ano, 50);
  const campeas = (await env.DB.prepare('SELECT c.edicao, c.pontos, t.nome FROM desafio_campeas c LEFT JOIN turmas t ON t.codigo = c.turma ORDER BY c.edicao DESC LIMIT 10').all()).results || [];
  const desafio = { ano: e.ano, inicio: e.inicio, fim: e.fim, aberto: e.aberto, antes: e.antes, depois: e.depois,
    ranking: rk.slice(0, 10).map((r, i) => ({ pos: i + 1, nome: r.nome, pontos: r.pontos, titulos: r.titulos, membros: r.membros })),
    campeas: campeas.filter(c => c.nome).map(c => ({ ano: c.edicao, nome: c.nome, pontos: c.pontos })) };
  let turma = null;
  if (idOk(ap)) {
    const t = await turmaDoAparelho(env, ap);
    if (t) {
      const { results } = await env.DB.prepare('SELECT nome FROM turma_membros WHERE turma = ? ORDER BY entrou LIMIT ?').bind(t.codigo, MAX_MEMBROS).all();
      const p = await env.DB.prepare('SELECT pontos FROM desafio_pontos WHERE edicao = ? AND turma = ?').bind(e.ano, t.codigo).first();
      const i = rk.findIndex(r => r.codigo === t.codigo);
      turma = { codigo: t.codigo, nome: t.nome, titulos: t.titulos, taca: t.titulos >= 3, membros: (results || []).map(r => r.nome), pontos: (p && p.pontos) || 0, pos: i >= 0 ? i + 1 : null };
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
  if (nome.length < 3 || nomeOfensivo(nome)) return h.json({ erro: 'nome' }, 400, origin);
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
// POST /turma/sair {aparelho}
export async function sair(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (await bloqueado(env, b.aparelho)) return h.json({ erro: 'bloqueado' }, 403, origin);   // 3.25
  await env.DB.prepare('DELETE FROM turma_membros WHERE aparelho = ?').bind(b.aparelho).run();
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
  return t ? t.nome : null;
}
