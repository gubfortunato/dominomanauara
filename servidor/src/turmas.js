// Turmas e o Desafio das Confrarias.
// Turma: um grupo de amigos que se junta por um código (6 letras e números). Cada aparelho fica em uma Turma por vez.
// Desafio das Confrarias: de 1º/11 a 20/12 (horário de Manaus), cada vitória numa partida online contra alguém de
// outra Turma vale 1 ponto para a Turma de quem ganhou (no máximo 5 por dia contra a mesma Turma, para ninguém
// combinar resultado). A Turma com mais pontos leva o título do ano; com 3 títulos, a Grande Taça.
import { bloqueado, pegaPeloApelido, termoDoDono } from './bloqueio.js';
import { nomeOfensivo } from './motor.js';
import { enviarPush } from './webpush.js';
import { temPlano } from './planos.js';
import { JANELA_PRESENCA } from './presenca.js';
// 24/11 (ideia de jogador, aprovada pelo dono): o escudo da Turma. Quem criou (ou, se saiu, quem está há mais tempo)
// escolhe a cor e o símbolo, se for sócio. Os escudos escolhidos vão para todo mundo (são poucos), pelo nome da Turma
export const ESCUDO = { cores: 12, simbolos: ['ini', 'estrela', 'coroa', 'raio', 'peixe', 'pedra'] };
async function escudos(env) {
  try {
    const { results } = await env.DB.prepare('SELECT t.nome, e.cor, e.simbolo FROM turma_escudo e JOIN turmas t ON t.codigo = e.turma LIMIT 500').all();
    const o = {}; for (const r of results || []) { const n = nomeSeguro(r.nome); if (n && n !== 'Turma sem nome') o[n] = { c: r.cor, s: r.simbolo }; }
    return o;
  } catch (e) { return {}; }
}

const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MEMBROS = 40, MAX_POR_PAR_DIA = 5;
// 11/11 (pedido do dono): para pontuar no Desafio, a Turma precisa de pelo menos 2 pessoas (a Turma de 1 não pontua;
// os pontos que já tinha ficam). A Turma sem ninguém sai do ranking (os pontos ficam guardados e voltam se alguém entrar).
const MIN_PONTUAR = 2;
const COM_GENTE = 'EXISTS (SELECT 1 FROM turma_membros m WHERE m.turma = t.codigo)';
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const codOk = v => new RegExp(`^[${LETRAS}]{6}$`).test(String(v || ''));
const limpa = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const MANAUS = 4 * 3600000;
const diaManaus = t => new Date(t - MANAUS).toISOString().slice(0, 10);
// 04/11 (dono): nome de Turma com termo de baixo calão não aparece em lugar nenhum (fica "Turma sem nome")
// 24/11: o nome que o administrador tirou fica "Turma sem nome <código>" no banco (o nome é único) e aparece como "Turma sem nome"
const SEM_NOME_RE = /^turma sem nome( [a-z0-9]+)?$/i;
const nomeSeguro = n => n && (nomeOfensivo(n) || SEM_NOME_RE.test(String(n).trim())) ? 'Turma sem nome' : n;
// 04/11 (dono): Turma que perdeu o nome (palavrão) pode escolher outro, uma vez, por quem criou (ou, se essa pessoa
// saiu, por quem está há mais tempo). Os pontos e os membros ficam.
const SEM_NOME = 'turma sem nome';
const nomeRetirado = n => !n || String(n).trim().toLowerCase() === SEM_NOME || SEM_NOME_RE.test(String(n).trim()) || nomeOfensivo(n);
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
// 17/11 (pedido do dono: "o Desafio está meio devagar"): Hora do Desafio. Todo dia, das 21h às 22h (Manaus), cada vitória
// contra outra Turma vale 1 ponto a mais (2; na reta final, com sócio na dupla, 3). Junta todo mundo no mesmo horário.
export const HORA = { ini: 21, fim: 22, extra: 1 };
export const horaDesafio = agora => { const h = new Date(agora - MANAUS).getUTCHours(); return h >= HORA.ini && h < HORA.fim; };
export function edicao(env, agora) {
  agora = agora ?? (Number(env.DESAFIO_AGORA) || Date.now());
  const ano = +diaManaus(agora).slice(0, 4);
  const inicio = Date.UTC(ano, 10, 1) + MANAUS, fim = Date.UTC(ano, 11, 21) + MANAUS, dobroDesde = Date.UTC(ano, RETA.mes, RETA.dia) + MANAUS;
  const aberto = agora >= inicio && agora < fim;
  return { ano, inicio, fim, dobroDesde, dobro: aberto && agora >= dobroDesde, aberto, antes: agora < inicio, depois: agora >= fim, agora, hora: aberto && horaDesafio(agora) };
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
  const top = await env.DB.prepare(`SELECT p.turma, p.pontos FROM desafio_pontos p JOIN turmas t ON t.codigo = p.turma WHERE p.edicao = ? AND p.pontos > 0 AND ${COM_GENTE} ORDER BY p.pontos DESC, p.ultimo ASC LIMIT 1`).bind(e.ano).first();   // 11/11: a Turma sem ninguém não leva o título
  const r = await env.DB.prepare('INSERT OR IGNORE INTO desafio_campeas (edicao, turma, pontos, fechada_em) VALUES (?, ?, ?, ?)').bind(e.ano, top ? top.turma : null, top ? top.pontos : 0, Date.now()).run();
  const mudou = r && ((r.meta && r.meta.changes) || r.changes);
  if (top && mudou) await env.DB.prepare('UPDATE turmas SET titulos = titulos + 1 WHERE codigo = ?').bind(top.turma).run();
  // 10/11 (pedido do dono): quem está na Turma campeã agora leva o selo 🏆 e a Mesa da Campeã até o fim do próximo Desafio
  if (top) { try { await env.DB.prepare('INSERT OR IGNORE INTO desafio_campeas_membros (edicao, aparelho) SELECT ?, aparelho FROM turma_membros WHERE turma = ?').bind(e.ano, top.turma).run(); } catch (er) {} }
  return top;
}
// A campeã que vale agora: a do ano, depois que o Desafio fecha (até o fim do Desafio do ano seguinte); antes disso, a do
// ano anterior (até o fim do Desafio deste ano). -> { ed, ate }
function campeaVigente(e) { return e.depois ? { ed: e.ano, ate: Date.UTC(e.ano + 1, 11, 21) + MANAUS } : { ed: e.ano - 1, ate: e.fim }; }
// -> até quando esse aparelho tem o selo 🏆 e a Mesa da Campeã (0 = não tem)
export async function campeaDesafioAte(env, aparelho, agora) {
  if (!idOk(aparelho)) return 0;
  const e = edicao(env, agora); if (e.depois) { try { await fecharDesafio(env, agora); } catch (er) {} }
  const v = campeaVigente(e);
  try { const r = await env.DB.prepare('SELECT 1 AS x FROM desafio_campeas_membros WHERE edicao = ? AND aparelho = ?').bind(v.ed, aparelho).first(); return r ? v.ate : 0; } catch (er) { return 0; }
}
// -> a Turma campeã que vale agora { codigo, nome, ano, ate } (ou null)
async function campeaAtual(env, e) {
  const v = campeaVigente(e);
  try { const r = await env.DB.prepare('SELECT c.turma, t.nome FROM desafio_campeas c JOIN turmas t ON t.codigo = c.turma WHERE c.edicao = ?').bind(v.ed).first(); return r ? { codigo: r.turma, nome: nomeSeguro(r.nome), ano: v.ed, ate: v.ate } : null; } catch (er) { return null; }
}
// Fim de uma partida online: quem ganhou leva ponto para a Turma se perdeu alguém de outra Turma
// -> { turmas: nomes das Turmas que pontuaram, ids: quem ganhou e trouxe o ponto, sozinhos: quem ganhou mas a Turma é de 1 pessoa }
export async function pontuar(env, vencedores, perdedores) {
  const e = edicao(env);
  const nada = { turmas: [], ids: [], pontos: 0, sozinhos: [] };
  if (!e.aberto) return nada;
  const ids = [...new Set([...vencedores, ...perdedores].filter(idOk))];
  if (!ids.length) return nada;
  const { results } = await env.DB.prepare(`SELECT m.aparelho, t.codigo, t.nome FROM turma_membros m JOIN turmas t ON t.codigo = m.turma WHERE m.aparelho IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const de = new Map((results || []).map(r => [r.aparelho, r]));
  const contra = new Set(perdedores.map(id => de.get(id)).filter(Boolean).map(r => r.codigo));
  // 11/11: quantas pessoas tem cada Turma de quem ganhou (a de 1 pessoa não pontua)
  const tam = new Map();
  const tws = [...new Set(vencedores.map(id => de.get(id)).filter(Boolean).map(r => r.codigo))];
  if (tws.length) { const { results: tm } = await env.DB.prepare(`SELECT turma, COUNT(*) AS n FROM turma_membros WHERE turma IN (${tws.map(() => '?').join(',')}) GROUP BY turma`).bind(...tws).all(); (tm || []).forEach(r => tam.set(r.turma, r.n)); }
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
    if ((tam.get(t.codigo) || 0) < MIN_PONTUAR) continue;
    const delta = (mult > 1 && vencedores.some(w => de.get(w) && de.get(w).codigo === t.codigo && socios.has(w)) ? mult : 1) + (e.hora ? HORA.extra : 0);   // 17/11: Hora do Desafio
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
  return { turmas: [...feitas.values()].map(x => x.nome), ids: vencedores.filter(id => de.get(id) && feitas.has(de.get(id).codigo)), pontos: feitas.size ? Math.max(...[...feitas.values()].map(x => x.delta)) : 0,
    sozinhos: vencedores.filter(id => idOk(id) && de.get(id) && !feitas.has(de.get(id).codigo) && (tam.get(de.get(id).codigo) || 0) < MIN_PONTUAR && [...contra].some(c => c !== de.get(id).codigo)) };
}
async function ranking(env, ano, n) {
  const { results } = await env.DB.prepare(`SELECT t.codigo, t.nome, t.titulos, p.pontos, p.ultimo, (SELECT COUNT(*) FROM turma_membros m WHERE m.turma = t.codigo) AS membros
    FROM desafio_pontos p JOIN turmas t ON t.codigo = p.turma WHERE p.edicao = ? AND p.pontos > 0 AND ${COM_GENTE} ORDER BY p.pontos DESC, p.ultimo ASC LIMIT ?`).bind(ano, n).all();   // 11/11: sem a Turma vazia
  return results || [];
}
// 10/11: os pontos de hoje de cada Turma (pelas vitórias do dia) e a posição de ontem, para a seta de subiu/caiu
async function hojeEOntem(env, e, rk) {
  const dia = diaManaus(e.agora), mult = multDe(e.ano, dia);
  // antes da reta final, cada vitória do dia é 1 ponto; na reta final, vale o que ficou anotado no dia (1 ou 2 por vitória)
  // 17/11: sempre o que ficou anotado no dia (com a Hora do Desafio, a vitória pode valer 2 antes da reta final)
  const { results } = await env.DB.prepare('SELECT turma AS vencedora, pontos AS n FROM desafio_dia WHERE edicao = ? AND dia = ?').bind(e.ano, dia).all();
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
  const campea = await campeaAtual(env, e);
  const linha = (r, i) => ({ pos: i + 1, nome: nomeSeguro(r.nome), pontos: r.pontos, titulos: r.titulos, membros: r.membros, hoje: ho.hoje.get(r.codigo) || 0, campea: !!campea && campea.codigo === r.codigo,
    mov: ho.posOntem.has(r.codigo) ? ho.posOntem.get(r.codigo) - (i + 1) : (ho.hoje.get(r.codigo) ? 'novo' : 0) });
  const campeas = (await env.DB.prepare('SELECT c.edicao, c.pontos, t.nome FROM desafio_campeas c LEFT JOIN turmas t ON t.codigo = c.turma ORDER BY c.edicao DESC LIMIT 10').all()).results || [];
  const desafio = { ano: e.ano, inicio: e.inicio, fim: e.fim, aberto: e.aberto, antes: e.antes, depois: e.depois, dobroDesde: e.dobroDesde, dobro: e.dobro, mult: RETA.mult, minimo: MIN_PONTUAR, hora: e.hora, horaIni: HORA.ini, horaFim: HORA.fim, horaExtra: HORA.extra,
    campea: campea ? { nome: campea.nome, ano: campea.ano, ate: campea.ate } : null,
    total: rk.length, ranking: rk.slice(0, 10).map(linha),
    campeas: campeas.filter(c => c.nome).map(c => ({ ano: c.edicao, nome: nomeSeguro(c.nome), pontos: c.pontos })) };
  let turma = null;
  if (idOk(ap)) {
    const t = await turmaDoAparelho(env, ap);
    if (t) {
      // 24/11: e quem está com o app aberto agora (a bolinha verde na lista, só para quem é da Turma; menor de 18, nunca)
      const { results } = await env.DB.prepare('SELECT m.nome, m.aparelho, (SELECT p.visto_em FROM presenca p WHERE p.aparelho = m.aparelho AND COALESCE(p.menor, 0) = 0) AS visto FROM turma_membros m WHERE m.turma = ? ORDER BY m.entrou LIMIT ?').bind(t.codigo, MAX_MEMBROS).all()
        .catch(() => env.DB.prepare('SELECT nome FROM turma_membros WHERE turma = ? ORDER BY entrou LIMIT ?').bind(t.codigo, MAX_MEMBROS).all());
      const p = await env.DB.prepare('SELECT pontos FROM desafio_pontos WHERE edicao = ? AND turma = ?').bind(e.ano, t.codigo).first();
      const i = rk.findIndex(r => r.codigo === t.codigo);
      const agoraMs = Date.now();
      turma = { codigo: t.codigo, nome: nomeSeguro(t.nome), titulos: t.titulos, taca: t.titulos >= 3, membros: (results || []).map(r => r.nome), membrosOn: (results || []).map(r => r.aparelho === ap || (r.visto || 0) > agoraMs - JANELA_PRESENCA), pontos: (p && p.pontos) || 0, pos: i >= 0 ? i + 1 : null, campea: !!campea && campea.codigo === t.codigo };
      if (i >= 0) { const l = linha(rk[i], i); turma.hoje = l.hoje; turma.mov = l.mov; turma.acima = i > 0 ? { nome: nomeSeguro(rk[i - 1].nome), falta: rk[i - 1].pontos - rk[i].pontos } : null; }
      try { Object.assign(turma, await craquesERival(env, e, t)); } catch (er) {}
      try {   // 24/11: o escudo e quem pode escolher
        const es = await env.DB.prepare('SELECT cor, simbolo FROM turma_escudo WHERE turma = ?').bind(t.codigo).first();
        const r = await responsavel(env, t);
        turma.escudo = es ? { c: es.cor, s: es.simbolo } : null; turma.escolheEscudo = !!(r && r.aparelho === ap); turma.quemEscolhe = r ? r.nome : null;
      } catch (er) {}
      if (nomeRetirado(t.nome)) {
        const r = await responsavel(env, t);
        turma.retirado = true; turma.renomeia = !!(r && r.aparelho === ap); turma.quemRenomeia = r ? r.nome : null; turma.quemCriou = !!(r && r.aparelho === t.criador);
      }
    }
  }
  const extra = {}; await pedidosNoResumo(env, ap, idOk(ap) ? await turmaDoAparelho(env, ap) : null, turma, extra);   // 25/11: pedidos para entrar
  let campeaAte = 0; if (idOk(ap)) { try { campeaAte = await campeaDesafioAte(env, ap); } catch (er) {} }
  return Object.assign({ desafio, turma, campeaAte, escudos: await escudos(env) }, extra);
}
// GET /turma?aparelho=  e  GET /desafio
export async function ver(env, origin, h, url) { return h.json(await resumo(env, url.searchParams.get('aparelho')), 200, origin); }
function apelidoOk(v) { const n = limpa(v, 16); return n.length >= 2 && !nomeOfensivo(n) ? n : 'Jogador'; }
// POST /turma/nova {aparelho, nome, apelido}
export async function nova(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (await bloqueado(env, b.aparelho)) return h.json({ erro: 'bloqueado' }, 403, origin);   // 3.25
  if (await pegaPeloApelido(env, b.aparelho, b.apelido)) return h.json({ erro: 'bloqueado' }, 403, origin);   // 11/11: voltou com outro aparelho
  const nome = limpa(b.nome, 24);
  if (nome.length < 3 || nomeRetirado(nome) || await termoDoDono(env, nome)) return h.json({ erro: 'nome' }, 400, origin);   // 24/11: e os pedaços do dono
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
      await cancelarPedidos(env, b.aparelho);   // 25/11
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
  // 11/11: quem está bloqueado também não entra em Turma (antes só não criava), nem quem volta com outro aparelho
  if (await bloqueado(env, b.aparelho) || await pegaPeloApelido(env, b.aparelho, b.apelido)) return h.json({ erro: 'bloqueado' }, 403, origin);
  const t = await env.DB.prepare('SELECT codigo FROM turmas WHERE codigo = ?').bind(codigo).first();
  if (!t) return h.json({ erro: 'nao-existe' }, 404, origin);
  const ja = await turmaDoAparelho(env, b.aparelho);
  if (ja && ja.codigo === codigo) return h.json(await resumo(env, b.aparelho), 200, origin);
  if (ja) return h.json({ erro: 'ja-tem', turma: ja.nome }, 409, origin);
  try { if (await env.DB.prepare('SELECT 1 FROM turma_fora WHERE turma = ? AND aparelho = ?').bind(codigo, b.aparelho).first()) return h.json({ erro: 'tirado-codigo' }, 403, origin); } catch (e) {}   // 25/11
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM turma_membros WHERE turma = ?').bind(codigo).first();
  if (n && n.n >= MAX_MEMBROS) return h.json({ erro: 'cheia' }, 409, origin);
  await env.DB.prepare('INSERT INTO turma_membros (aparelho, turma, nome, entrou) VALUES (?, ?, ?, ?)').bind(b.aparelho, codigo, apelidoOk(b.apelido), Date.now()).run();
  await cancelarPedidos(env, b.aparelho);   // 25/11: entrou por código: o pedido para outra Turma sai
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
  if (nome.length < 3 || nomeRetirado(nome) || await termoDoDono(env, nome)) return h.json({ erro: 'nome' }, 400, origin);   // 24/11: e os pedaços do dono
  if (await env.DB.prepare('SELECT 1 FROM turmas WHERE lower(nome) = lower(?) AND codigo <> ?').bind(nome, t.codigo).first()) return h.json({ erro: 'nome-usado' }, 409, origin);
  try { await env.DB.prepare('UPDATE turmas SET nome = ? WHERE codigo = ?').bind(nome, t.codigo).run(); }
  catch (e) { return h.json({ erro: 'nome-usado' }, 409, origin); }
  return h.json(await resumo(env, b.aparelho), 200, origin);
}
// 24/11 (dono: "um comando para evitar nomes impróprios para as confrarias"): GET /dono/turmas (as Turmas, com o nome
// de verdade, quantos membros e pontos) e POST /dono/turmas/nome {codigo}: tira o nome (vira "Turma sem nome" em todo lugar
// e quem criou escolhe outro, como quando o filtro pega o nome; os pontos e os membros ficam)
export async function donoTurmas(req, env, origin, h, url) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
    const cod = String((b && b.codigo) || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    const t = cod && await env.DB.prepare('SELECT codigo, nome FROM turmas WHERE codigo = ?').bind(cod).first();
    if (!t) return h.json({ erro: 'nao-existe' }, 404, origin);
    if (!nomeRetirado(t.nome)) await env.DB.prepare('UPDATE turmas SET nome = ? WHERE codigo = ?').bind('Turma sem nome ' + t.codigo.toLowerCase(), t.codigo).run();
    return h.json({ ok: true }, 200, origin);
  }
  const ed = edicao(env);
  const { results } = await env.DB.prepare(`SELECT t.codigo, t.nome, t.criada, (SELECT COUNT(*) FROM turma_membros m WHERE m.turma = t.codigo) AS membros,
      (SELECT p.pontos FROM desafio_pontos p WHERE p.edicao = ? AND p.turma = t.codigo) AS pontos FROM turmas t ORDER BY t.criada DESC LIMIT 300`).bind(ed.ano).all();
  return h.json({ turmas: (results || []).map(r => ({ codigo: r.codigo, nome: r.nome, retirado: nomeRetirado(r.nome), filtro: !!nomeOfensivo(r.nome), membros: r.membros || 0, pontos: r.pontos || 0, criada: r.criada })) }, 200, origin);
}
// POST /turma/escudo {aparelho, cor, simbolo}: quem criou a Turma (sócio) escolhe o escudo
export async function escudo(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (await bloqueado(env, b.aparelho)) return h.json({ erro: 'bloqueado' }, 403, origin);
  const cor = Number(b.cor), simbolo = String(b.simbolo || '');
  if (!Number.isInteger(cor) || cor < 0 || cor >= ESCUDO.cores || !ESCUDO.simbolos.includes(simbolo)) return h.json({ erro: 'escudo' }, 400, origin);
  const t = await turmaDoAparelho(env, b.aparelho);
  if (!t) return h.json({ erro: 'sem-turma' }, 404, origin);
  const r = await responsavel(env, t);
  if (!r || r.aparelho !== b.aparelho) return h.json({ erro: 'so-quem-criou-escudo' }, 403, origin);
  if (!(await temPlano(env, b.aparelho))) return h.json({ erro: 'socio-escudo' }, 403, origin);
  await env.DB.prepare('INSERT INTO turma_escudo (turma, cor, simbolo, por, em) VALUES (?, ?, ?, ?, ?) ON CONFLICT (turma) DO UPDATE SET cor = excluded.cor, simbolo = excluded.simbolo, por = excluded.por, em = excluded.em')
    .bind(t.codigo, cor, simbolo, b.aparelho, Date.now()).run();
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

// 11/11 (pedido do dono: "como vou saber quando estiverem rolando os jogos das confrarias?"): começou um confronto do
// Desafio (gente de duas Turmas na mesa), sai um aviso no celular para quem é das duas Turmas e não está jogando, e para o
// dono. Cada pessoa recebe no máximo 1 aviso por dia para o mesmo par de Turmas (a mesa com fila começa várias partidas).
// O toque no aviso abre a partida para assistir (?abrir=aovivo&ver=…), sem o número da mesa.
export async function avisarConfronto(env, cf, sentados) {
  if (!cf || !cf.ver || !env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return { ok: 0 };
  const agora = Date.now(), sent = [...new Set((sentados || []).filter(idOk))];
  const cods = new Set();
  for (const ap of sent) { try { const t = await turmaDoAparelho(env, ap); if (t) cods.add(t.codigo); } catch (e) {} }
  if (cods.size < 2) return { ok: 0 };
  const turmas = [...cods].sort();
  const q = turmas.map(() => '?').join(',');
  const { results: ms } = await env.DB.prepare(`SELECT aparelho FROM turma_membros WHERE turma IN (${q})`).bind(...turmas).all();
  let donos = []; try { const { results } = await env.DB.prepare('SELECT aparelho FROM dono_aparelhos').all(); donos = (results || []).map(x => x.aparelho); } catch (e) {}
  const membros = new Set((ms || []).map(x => x.aparelho));
  const aps = [...new Set([...membros, ...donos])].filter(ap => !sent.includes(ap)).slice(0, 120);
  if (!aps.length) return { ok: 0 };
  const chave = `cf:${diaManaus(agora)}:${turmas.join('-')}`;
  const { results } = await env.DB.prepare(`SELECT DISTINCT a.id, a.endpoint, a.p256dh, a.auth, i.aparelho FROM avisos a JOIN avisos_id i ON i.endpoint = a.endpoint
    WHERE i.aparelho IN (${aps.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM avisos_ev e WHERE e.aviso = a.id AND e.chave = ?) LIMIT 300`).bind(...aps, chave).all();
  const vistos = new Set(), lista = (results || []).filter(x => !vistos.has(x.id) && vistos.add(x.id));
  if (!lista.length) return { ok: 0 };
  const st = env.DB.prepare('INSERT OR IGNORE INTO avisos_ev (aviso, chave, em) VALUES (?, ?, ?)');
  await env.DB.batch(lista.map(x => st.bind(x.id, chave, agora)));   // anota antes: ninguém recebe duas vezes
  const titulo = `⚔️ Ao vivo: ${nomeSeguro(cf.a)} × ${nomeSeguro(cf.b)}`, url = `/?abrir=aovivo&ver=${cf.ver}`;
  let ok = 0;
  for (const s of lista) {
    const msg = { titulo, url, texto: membros.has(s.aparelho) ? 'A sua Turma está jogando agora no Desafio das Confrarias. Toque para assistir e torcer!'
      : 'Começou um confronto do Desafio das Confrarias. Toque para assistir ao vivo.' };
    let r = 0; try { r = await enviarPush(s, msg, env); } catch (e) {}
    if (r === 404 || r === 410) { try { await env.DB.prepare('DELETE FROM avisos WHERE id = ?').bind(s.id).run(); await env.DB.prepare('DELETE FROM avisos_id WHERE endpoint = ?').bind(s.endpoint).run(); } catch (e) {} }
    if (r >= 200 && r < 300) { ok++; try { await env.DB.prepare('UPDATE avisos SET ultimo_envio = ?, envios = envios + 1 WHERE id = ?').bind(agora, s.id).run(); } catch (e) {} }
  }
  return { ok };
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
  // 17/11: começou a Hora do Desafio (às 21h), para quem é de Turma, uma vez por dia
  if (h === HORA.ini) return [{ chave: `ds:${dia}:hora`, para: 'turmas',
    msg: { titulo: '⏰ Começou a Hora do Desafio!', texto: `Até as ${HORA.fim}h, cada vitória online contra outra Turma vale 1 ponto a mais. Bora pra mesa rápida!`, url: '/?abrir=turma' } }];
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

// ===== 25/11 (ideia de jogador no "Fale com a gente", aprovada pelo dono): pedir para entrar numa Turma =====
// Quem é sócio e ainda não tem Turma pede para entrar (sem precisar do código); quem decide aceita ou recusa. Quem decide:
// quem criou, se ainda está na Turma e jogou nos últimos 14 dias; senão, quem está há mais tempo e jogou nesse tempo.
// Quem decide também tira alguém da Turma: os pontos ficam na Turma, e quem saiu só volta por pedido aceito (depois de 7 dias).
// Turma com menor de 18 não recebe pedidos, e menor de 18 não pede (ninguém de fora chega até menor por aqui).
// O código continua igual: quem recebe o código de alguém da Turma entra direto (o código já é o convite).
const PEDIDO = { vence: 3 * 86400000, porDia: 5, espera: 7 * 86400000, inativo: 14 * 86400000 };
async function chaveMembro(ap) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('turma|' + ap)));
  return [...b.slice(0, 6)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function decisor(env, t) {
  const agora = Date.now();
  const { results } = await env.DB.prepare('SELECT m.aparelho, m.nome, m.entrou, (SELECT p.visto_em FROM presenca p WHERE p.aparelho = m.aparelho) AS visto FROM turma_membros m WHERE m.turma = ? ORDER BY m.entrou').bind(t.codigo).all();
  const ms = results || []; if (!ms.length) return null;
  const ativo = m => (m.visto || 0) > agora - PEDIDO.inativo, cri = ms.find(m => m.aparelho === t.criador);
  if (cri && ativo(cri)) return cri;
  return ms.find(ativo) || cri || ms[0];
}
async function temMenor(env, codigo) {
  try { return !!(await env.DB.prepare('SELECT 1 FROM turma_membros m JOIN presenca p ON p.aparelho = m.aparelho WHERE m.turma = ? AND p.menor = 1 LIMIT 1').bind(codigo).first()); }
  catch (e) { return true; }   // na dúvida, não recebe pedido
}
async function ehMenor(env, ap) { try { const r = await env.DB.prepare('SELECT menor FROM presenca WHERE aparelho = ?').bind(ap).first(); return !!(r && r.menor); } catch (e) { return false; } }
// um aviso no celular para um aparelho (uma vez por chave)
async function pushPara(env, ap, chave, msg) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC || !idOk(ap)) return 0;
  const agora = Date.now();
  let lista = [];
  try { const { results } = await env.DB.prepare('SELECT DISTINCT a.id, a.endpoint, a.p256dh, a.auth FROM avisos a JOIN avisos_id i ON i.endpoint = a.endpoint WHERE i.aparelho = ? AND NOT EXISTS (SELECT 1 FROM avisos_ev e WHERE e.aviso = a.id AND e.chave = ?) LIMIT 5').bind(ap, chave).all(); lista = results || []; } catch (e) { return 0; }
  let ok = 0;
  for (const s of lista) {
    try { await env.DB.prepare('INSERT OR IGNORE INTO avisos_ev (aviso, chave, em) VALUES (?, ?, ?)').bind(s.id, chave, agora).run(); } catch (e) {}
    let r = 0; try { r = await enviarPush(s, msg, env); } catch (e) {}
    if (r === 404 || r === 410) { try { await env.DB.prepare('DELETE FROM avisos WHERE id = ?').bind(s.id).run(); await env.DB.prepare('DELETE FROM avisos_id WHERE endpoint = ?').bind(s.endpoint).run(); } catch (e) {} }
    if (r >= 200 && r < 300) { ok++; try { await env.DB.prepare('UPDATE avisos SET ultimo_envio = ?, envios = envios + 1 WHERE id = ?').bind(agora, s.id).run(); } catch (e) {} }
  }
  return ok;
}
async function pedidoAberto(env, ap) {
  return await env.DB.prepare("SELECT p.id, p.turma, p.em, t.nome FROM turma_pedidos p JOIN turmas t ON t.codigo = p.turma WHERE p.aparelho = ? AND p.estado = 'aberto' AND p.em > ? ORDER BY p.em DESC LIMIT 1")
    .bind(ap, Date.now() - PEDIDO.vence).first();
}
const cancelarPedidos = (env, ap) => env.DB.prepare("UPDATE turma_pedidos SET estado = 'cancelado', decidido = ? WHERE aparelho = ? AND estado = 'aberto'").bind(Date.now(), ap).run().catch(() => {});
// as Turmas que recebem pedido (com gente, sem menor, com vaga), para quem ainda não tem Turma
async function abertas(env, ano) {
  try {
    const { results } = await env.DB.prepare(`SELECT t.codigo, t.nome, (SELECT COUNT(*) FROM turma_membros m WHERE m.turma = t.codigo) AS membros,
      COALESCE((SELECT p.pontos FROM desafio_pontos p WHERE p.turma = t.codigo AND p.edicao = ?), 0) AS pontos FROM turmas t WHERE ${COM_GENTE}
      AND NOT EXISTS (SELECT 1 FROM turma_membros m JOIN presenca p ON p.aparelho = m.aparelho WHERE m.turma = t.codigo AND p.menor = 1)
      ORDER BY pontos DESC, membros DESC LIMIT 60`).bind(ano).all();
    return (results || []).filter(r => r.membros < MAX_MEMBROS && nomeSeguro(r.nome) !== 'Turma sem nome').slice(0, 30).map(r => ({ nome: r.nome, membros: r.membros, pontos: r.pontos }));
  } catch (e) { return []; }
}
// o que vai no resumo: para quem decide, os pedidos e as chaves de quem está na Turma; para quem não tem Turma, o pedido e as Turmas
async function pedidosNoResumo(env, ap, t, turma, out) {
  try {
    if (t) {
      const d = await decisor(env, t);
      turma.decide = !!(d && d.aparelho === ap); turma.quemDecide = d ? d.nome : null;
      if (turma.decide) {
        const { results } = await env.DB.prepare("SELECT id, nome, em FROM turma_pedidos WHERE turma = ? AND estado = 'aberto' AND em > ? ORDER BY em LIMIT 20").bind(t.codigo, Date.now() - PEDIDO.vence).all();
        turma.pedidos = (results || []).map(r => ({ id: r.id, nome: nomeOfensivo(r.nome) ? 'Jogador' : r.nome, em: r.em, vence: r.em + PEDIDO.vence }));
        const { results: ms } = await env.DB.prepare('SELECT aparelho FROM turma_membros WHERE turma = ? ORDER BY entrou LIMIT ?').bind(t.codigo, MAX_MEMBROS).all();
        turma.membrosK = []; for (const m of ms || []) turma.membrosK.push(m.aparelho === ap ? null : await chaveMembro(m.aparelho));
      }
    } else if (idOk(ap)) {
      const p = await pedidoAberto(env, ap);
      out.pedido = p ? { turma: nomeSeguro(p.nome), em: p.em, vence: p.em + PEDIDO.vence } : null;
      out.abertas = await abertas(env, edicao(env).ano);
    }
  } catch (e) {}
}
// POST /turma/pedir {aparelho, nome (da Turma), apelido, menor}
export async function pedir(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (b.menor || await ehMenor(env, b.aparelho)) return h.json({ erro: 'menor' }, 403, origin);
  if (await bloqueado(env, b.aparelho) || await pegaPeloApelido(env, b.aparelho, b.apelido)) return h.json({ erro: 'bloqueado' }, 403, origin);
  if (!(await temPlano(env, b.aparelho))) return h.json({ erro: 'socio-pedir' }, 403, origin);
  const ja = await turmaDoAparelho(env, b.aparelho); if (ja) return h.json({ erro: 'ja-tem', turma: ja.nome }, 409, origin);
  const t = await env.DB.prepare(`SELECT t.codigo, t.nome, t.criador FROM turmas t WHERE lower(t.nome) = lower(?) AND ${COM_GENTE}`).bind(limpa(b.nome, 40)).first();
  if (!t || nomeSeguro(t.nome) === 'Turma sem nome' || await temMenor(env, t.codigo)) return h.json({ erro: 'nao-recebe' }, 404, origin);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM turma_membros WHERE turma = ?').bind(t.codigo).first();
  if (n && n.n >= MAX_MEMBROS) return h.json({ erro: 'cheia' }, 409, origin);
  const agora = Date.now();
  const ab = await pedidoAberto(env, b.aparelho); if (ab) return h.json({ erro: 'ja-pediu', turma: nomeSeguro(ab.nome) }, 409, origin);
  const dia = await env.DB.prepare('SELECT COUNT(*) AS n FROM turma_pedidos WHERE aparelho = ? AND em > ?').bind(b.aparelho, agora - 86400000).first();
  if (dia && dia.n >= PEDIDO.porDia) return h.json({ erro: 'muitos-pedidos' }, 429, origin);
  const rec = await env.DB.prepare("SELECT decidido FROM turma_pedidos WHERE aparelho = ? AND turma = ? AND estado = 'recusado' AND decidido > ? ORDER BY decidido DESC LIMIT 1").bind(b.aparelho, t.codigo, agora - PEDIDO.espera).first();
  if (rec) return h.json({ erro: 'recusado', volta: rec.decidido + PEDIDO.espera }, 409, origin);
  const fora = await env.DB.prepare('SELECT em FROM turma_fora WHERE turma = ? AND aparelho = ? AND em > ?').bind(t.codigo, b.aparelho, agora - PEDIDO.espera).first();
  if (fora) return h.json({ erro: 'tirado', volta: fora.em + PEDIDO.espera }, 409, origin);
  const nome = apelidoOk(b.apelido);
  const r = await env.DB.prepare("INSERT INTO turma_pedidos (turma, aparelho, nome, em, estado) VALUES (?, ?, ?, ?, 'aberto')").bind(t.codigo, b.aparelho, nome, agora).run();
  const id = r && r.meta ? r.meta.last_row_id : null;
  try { const d = await decisor(env, t); if (d) await pushPara(env, d.aparelho, `tp:${id}:dec`, { titulo: `🙋 ${nome} quer entrar na ${nomeT(nomeSeguro(t.nome))}`, texto: 'Toque para aceitar ou recusar. O pedido vence em 3 dias.', url: '/?abrir=turma' }); } catch (e) {}
  return h.json(await resumo(env, b.aparelho), 200, origin);
}
// POST /turma/pedido/cancelar {aparelho}
export async function cancelarPedido(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  await cancelarPedidos(env, b.aparelho);
  return h.json(await resumo(env, b.aparelho), 200, origin);
}
// POST /turma/pedido/responder {aparelho, id, aceitar}
export async function responderPedido(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho) || !Number.isInteger(Number(b.id))) return h.json({ erro: 'formato' }, 400, origin);
  if (await bloqueado(env, b.aparelho)) return h.json({ erro: 'bloqueado' }, 403, origin);
  const t = await turmaDoAparelho(env, b.aparelho); if (!t) return h.json({ erro: 'sem-turma' }, 404, origin);
  const d = await decisor(env, t); if (!d || d.aparelho !== b.aparelho) return h.json({ erro: 'so-quem-decide' }, 403, origin);
  const agora = Date.now();
  const p = await env.DB.prepare("SELECT id, aparelho, nome, em FROM turma_pedidos WHERE id = ? AND turma = ? AND estado = 'aberto' AND em > ?").bind(Number(b.id), t.codigo, agora - PEDIDO.vence).first();
  if (!p) return h.json(Object.assign(await resumo(env, b.aparelho), { aviso: 'pedido-fechado' }), 200, origin);
  const nomeTu = nomeT(nomeSeguro(t.nome));
  if (b.aceitar) {
    const ja = await turmaDoAparelho(env, p.aparelho);
    if (ja) { await env.DB.prepare("UPDATE turma_pedidos SET estado = 'cancelado', decidido = ? WHERE id = ?").bind(agora, p.id).run(); return h.json(Object.assign(await resumo(env, b.aparelho), { aviso: 'ja-tem-outra' }), 200, origin); }
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM turma_membros WHERE turma = ?').bind(t.codigo).first();
    if (n && n.n >= MAX_MEMBROS) return h.json({ erro: 'cheia' }, 409, origin);
    await env.DB.prepare('INSERT INTO turma_membros (aparelho, turma, nome, entrou) VALUES (?, ?, ?, ?)').bind(p.aparelho, t.codigo, apelidoOk(p.nome), agora).run();
    await env.DB.prepare("UPDATE turma_pedidos SET estado = 'aceito', decidido = ? WHERE id = ?").bind(agora, p.id).run();
    try { await env.DB.prepare('DELETE FROM turma_fora WHERE turma = ? AND aparelho = ?').bind(t.codigo, p.aparelho).run(); } catch (e) {}
    try { await pushPara(env, p.aparelho, `tp:${p.id}:res`, { titulo: `✅ Você entrou na ${nomeTu}!`, texto: 'Seu pedido foi aceito. Bora jogar com a Turma e somar pontos no Desafio das Confrarias!', url: '/?abrir=turma' }); } catch (e) {}
  } else {
    await env.DB.prepare("UPDATE turma_pedidos SET estado = 'recusado', decidido = ? WHERE id = ?").bind(agora, p.id).run();
    try { await pushPara(env, p.aparelho, `tp:${p.id}:res`, { titulo: 'Seu pedido de Turma', texto: `Desta vez a ${nomeTu} não aceitou. Tem outras Turmas esperando por você: toque para ver.`, url: '/?abrir=turma' }); } catch (e) {}
  }
  return h.json(await resumo(env, b.aparelho), 200, origin);
}
// POST /turma/tirar {aparelho, alvo (a chave de quem sai)}
export async function tirar(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho) || !/^[0-9a-f]{12}$/.test(String(b.alvo || ''))) return h.json({ erro: 'formato' }, 400, origin);
  if (await bloqueado(env, b.aparelho)) return h.json({ erro: 'bloqueado' }, 403, origin);
  const t = await turmaDoAparelho(env, b.aparelho); if (!t) return h.json({ erro: 'sem-turma' }, 404, origin);
  const d = await decisor(env, t); if (!d || d.aparelho !== b.aparelho) return h.json({ erro: 'so-quem-decide' }, 403, origin);
  const { results } = await env.DB.prepare('SELECT aparelho, nome FROM turma_membros WHERE turma = ?').bind(t.codigo).all();
  let alvo = null; for (const m of results || []) { if (m.aparelho !== b.aparelho && await chaveMembro(m.aparelho) === b.alvo) { alvo = m; break; } }
  if (!alvo) return h.json(await resumo(env, b.aparelho), 200, origin);
  const agora = Date.now();
  await env.DB.prepare('DELETE FROM turma_membros WHERE aparelho = ? AND turma = ?').bind(alvo.aparelho, t.codigo).run();
  try { await env.DB.prepare('DELETE FROM desafio_membros WHERE aparelho = ?').bind(alvo.aparelho).run(); } catch (e) {}   // os pontos ficam na Turma
  await env.DB.prepare('INSERT INTO turma_fora (turma, aparelho, em) VALUES (?, ?, ?) ON CONFLICT (turma, aparelho) DO UPDATE SET em = excluded.em').bind(t.codigo, alvo.aparelho, agora).run();
  try { await pushPara(env, alvo.aparelho, `tt:${t.codigo}:${diaManaus(agora)}`, { titulo: 'Mudança na sua Turma', texto: `Você não faz mais parte da ${nomeT(nomeSeguro(t.nome))}. Pode entrar em outra Turma ou criar a sua: toque para ver.`, url: '/?abrir=turma' }); } catch (e) {}
  return h.json(await resumo(env, b.aparelho), 200, origin);
}
