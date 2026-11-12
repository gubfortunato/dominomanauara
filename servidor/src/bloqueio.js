// Bloqueio de jogadores (3.25): o administrador bloqueia quem usar apelido ou foto ofensiva. Quem está bloqueado sai
// da mesa na hora (um robô assume a cadeira), perde a foto e não entra mais na mesa online, na mesa rápida nem nas
// turmas. O jogo offline continua. O servidor guarda só o código aleatório do aparelho, o apelido e quando foi.
const DIA = 86400000;
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));

// ---- 11/11 (pedido do dono: "a usuária bloqueada voltou; quero derrubar e endurecer") ----
// Apelido bloqueado: quem foi bloqueado e volta com outro aparelho (apagou os dados do app, outro navegador, outro celular)
// com o mesmo apelido é bloqueado sozinho, assim que abre o app, confere o jogo offline ou tenta entrar numa mesa ou Turma.
//  - apelido inteiro: entra sozinho quando o administrador bloqueia alguém (só apelido pouco comum: até 3 aparelhos com ele).
//    Vale o mesmo apelido sem acento, espaço, número e letra repetida, e com 4→a, 0→o, 1→i, 3→e.
//  - parte do apelido: o administrador escreve um pedaço (5 letras ou mais) e todo apelido que o contém fica bloqueado.
// Sócio não cai nessa regra (o administrador bloqueia na mão, se precisar).
const LEET = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't' };
const juntas = x => x.replace(/(.)\1+/g, '$1');
export function chavesApelido(n) {
  const s = String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const a = s.replace(/[^a-z]/g, ''), b = s.replace(/[4@31!05$7]/g, ch => LEET[ch]).replace(/[^a-z]/g, '');
  return [...new Set([a, b, juntas(a), juntas(b)])].filter(Boolean);
}
export const termoLimpo = n => juntas(String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[4@31!05$7]/g, ch => LEET[ch]).replace(/[^a-z]/g, ''));
const TERMOS = { lista: null, em: 0 };
export function termosMudaram() { TERMOS.em = 0; }
async function termos(env) {
  if (TERMOS.lista && Date.now() - TERMOS.em < 60000) return TERMOS.lista;
  try {
    const { results } = await env.DB.prepare('SELECT termo, parte FROM apelidos_bloqueados').all();
    TERMOS.lista = (results || []).map(r => ({ termo: r.termo, t: termoLimpo(r.termo), parte: !!r.parte })).filter(x => x.t.length >= 4);
    TERMOS.em = Date.now();
  } catch (e) { TERMOS.lista = TERMOS.lista || []; }
  return TERMOS.lista;
}
export function bateTermo(nome, lista) {
  const ks = chavesApelido(nome).map(juntas);
  return (lista || []).find(x => ks.some(k => x.parte ? k.includes(x.t) : k === x.t)) || null;
}
export async function pegaPeloApelido(env, aparelho, nome) {
  if (!aparelho || !idOk(aparelho) || !nome) return false;
  const t = bateTermo(nome, await termos(env)); if (!t) return false;
  try { const p = await env.DB.prepare('SELECT ate FROM planos WHERE aparelho = ?').bind(aparelho).first(); if (p && p.ate > Date.now()) return false; } catch (e) {}
  try {
    await env.DB.prepare('INSERT INTO bloqueios (aparelho, nome, motivo, em) VALUES (?, ?, ?, ?) ON CONFLICT (aparelho) DO NOTHING')
      .bind(aparelho, String(nome).slice(0, 16), 'voltou com outro aparelho (apelido bloqueado)', Date.now()).run();
    await env.DB.prepare("UPDATE fotos SET status = 'recusada', dados = '', revisado_em = ? WHERE aparelho = ?").bind(Date.now(), aparelho).run();
  } catch (e) {}
  return true;
}
// o apelido de quem o administrador bloqueou passa a valer para qualquer aparelho (se for pouco comum)
async function bloquearApelido(env, nome, motivo) {
  const t = termoLimpo(nome); if (t.length < 4) return;
  try {
    const { results } = await env.DB.prepare('SELECT nome FROM jogadores_vistos WHERE visto_em > ?').bind(Date.now() - 60 * DIA).all();
    if ((results || []).filter(r => termoLimpo(r.nome) === t).length > 3) return;   // apelido comum: não
    await env.DB.prepare('INSERT OR IGNORE INTO apelidos_bloqueados (termo, parte, motivo, em) VALUES (?, 0, ?, ?)').bind(t, motivo || null, Date.now()).run();
    termosMudaram();
  } catch (e) {}
}
// GET /dono/apelidos · POST /dono/apelidos {termo} (parte do apelido) · POST /dono/apelidos/tirar {termo}
export async function donoApelidos(req, env, origin, h, url) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const recentes = async () => { try { const { results } = await env.DB.prepare('SELECT nome FROM jogadores_vistos WHERE visto_em > ?').bind(Date.now() - 30 * DIA).all(); return results || []; } catch (e) { return []; } };
  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
    if (url.pathname.endsWith('/tirar')) {
      await env.DB.prepare('DELETE FROM apelidos_bloqueados WHERE termo = ?').bind(String(b.termo || '')).run();
      termosMudaram(); return h.json({ ok: true }, 200, origin);
    }
    const t = termoLimpo(b.termo);
    if (t.length < 5) return h.json({ erro: 'curto' }, 400, origin);
    await env.DB.prepare('INSERT INTO apelidos_bloqueados (termo, parte, motivo, em) VALUES (?, 1, ?, ?) ON CONFLICT (termo) DO UPDATE SET parte = 1, em = excluded.em')
      .bind(t, 'parte do apelido (administrador)', Date.now()).run();
    termosMudaram();
    const afetados = (await recentes()).filter(r => bateTermo(r.nome, [{ t, parte: true }])).length;
    return h.json({ ok: true, termo: t, afetados }, 200, origin);
  }
  const { results } = await env.DB.prepare('SELECT termo, parte, motivo, em FROM apelidos_bloqueados ORDER BY parte DESC, em DESC LIMIT 200').all();
  return h.json({ apelidos: results || [] }, 200, origin);
}

// 11/11 (pedido do dono): quem foi bloqueado por burlar o limite grátis (vários aparelhos, ou voltou com outro aparelho)
// e vira sócio é desbloqueado sozinho quando o pagamento cai: o motivo da burla some e ele passa a pagar. Quem foi bloqueado
// por outro motivo (apelido ou foto ofensiva, ou pela lista do administrador) continua bloqueado e nem consegue pagar.
const BURLA = /burla|voltou com outro aparelho/i;
export async function motivoBloqueio(env, aparelho) {
  if (!aparelho) return null;
  try { const r = await env.DB.prepare('SELECT motivo FROM bloqueios WHERE aparelho = ?').bind(aparelho).first(); return r ? { motivo: r.motivo || '', burla: BURLA.test(r.motivo || '') } : null; } catch (e) { return null; }
}
export async function liberarQuemPagou(env, aparelho) {
  try { await env.DB.prepare('DELETE FROM bloqueios WHERE aparelho = ? AND (motivo LIKE ? OR motivo LIKE ?)').bind(aparelho, '%burla%', '%voltou com outro aparelho%').run(); } catch (e) {}
}

export async function bloqueado(env, aparelho) {
  if (!aparelho) return false;
  try { return !!(await env.DB.prepare('SELECT 1 AS ok FROM bloqueios WHERE aparelho = ?').bind(aparelho).first()); } catch (e) { return false; }
}
// Quem entrou numa mesa online (para a lista do administrador): só gente, nunca robô
export async function visto(env, quem, mesa) {
  if (!quem || !quem.id || quem.bot) return;
  try {
    await env.DB.prepare('INSERT INTO jogadores_vistos (aparelho, nome, av, mesa, visto_em) VALUES (?, ?, ?, ?, ?) ON CONFLICT (aparelho) DO UPDATE SET nome = excluded.nome, av = excluded.av, mesa = excluded.mesa, visto_em = excluded.visto_em')
      .bind(quem.id, String(quem.nome || '').slice(0, 16), quem.av || null, mesa || null, Date.now()).run();
  } catch (e) {}
}

// GET /dono/jogadores -> últimos jogadores online (7 dias) e os bloqueados
export async function donoJogadores(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const { results: recentes } = await env.DB.prepare(`SELECT v.aparelho, v.nome, v.av, v.mesa, v.visto_em,
      (SELECT pub FROM fotos f WHERE f.aparelho = v.aparelho AND f.status IN ('aprovada', 'denunciada')) AS foto,
      (SELECT 1 FROM bloqueios b WHERE b.aparelho = v.aparelho) AS bloq,
      (SELECT 1 FROM apelidos_trocar t WHERE t.aparelho = v.aparelho) AS trocar
    FROM jogadores_vistos v WHERE v.visto_em > ? AND v.aparelho NOT LIKE 'teste-publicacao-%' ORDER BY v.visto_em DESC LIMIT 60`).bind(Date.now() - 7 * DIA).all();
  const { results: bloqueados } = await env.DB.prepare('SELECT aparelho, nome, motivo, em FROM bloqueios ORDER BY em DESC LIMIT 100').all();
  return h.json({ recentes: recentes || [], bloqueados: bloqueados || [] }, 200, origin);
}

// POST /dono/bloquear {aparelho} ou {mesa, cadeira} (da mesa online, onde o celular não sabe o código de ninguém)
export async function donoBloquear(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  let aparelho = idOk(b.aparelho) ? b.aparelho : null, nome = null, mesa = null;
  const motivo = String(b.motivo || '').slice(0, 60) || null;
  if (!aparelho && /^\d{5}$/.test(String(b.mesa || '')) && Number.isInteger(b.cadeira)) {
    // tira da mesa e descobre quem é
    const r = await env.MESA.get(env.MESA.idFromName(String(b.mesa))).fetch('https://mesa/expulsar', { method: 'POST', body: JSON.stringify({ cadeira: b.cadeira }) });
    const j = await r.json().catch(() => ({}));
    if (!j.id) return h.json({ erro: 'nao-achei' }, 404, origin);
    aparelho = j.id; nome = j.nome || null;
  } else if (aparelho) {
    const v = await env.DB.prepare('SELECT nome, mesa FROM jogadores_vistos WHERE aparelho = ?').bind(aparelho).first();
    nome = v && v.nome; mesa = v && v.mesa;
    // 3.31: quem só está no app (não jogou online) — o apelido vem da presença
    if (!nome) { const p = await env.DB.prepare('SELECT nome FROM presenca WHERE aparelho = ?').bind(aparelho).first(); nome = p && p.nome; }
  } else return h.json({ erro: 'dados' }, 400, origin);
  await env.DB.prepare('INSERT INTO bloqueios (aparelho, nome, motivo, em) VALUES (?, ?, ?, ?) ON CONFLICT (aparelho) DO UPDATE SET motivo = excluded.motivo, em = excluded.em')
    .bind(aparelho, nome, motivo, Date.now()).run();
  // a foto sai da mesa (fica recusada)
  await env.DB.prepare("UPDATE fotos SET status = 'recusada', dados = '', revisado_em = ? WHERE aparelho = ?").bind(Date.now(), aparelho).run();
  if (nome) await bloquearApelido(env, nome, 'bloqueado pelo administrador');   // 11/11: volta com outro aparelho: cai sozinho
  // e a pessoa sai da mesa em que estava
  if (mesa) { try { await env.MESA.get(env.MESA.idFromName(mesa)).fetch('https://mesa/expulsar', { method: 'POST', body: JSON.stringify({ id: aparelho }) }); } catch (e) {} }
  return h.json({ ok: true, nome }, 200, origin);
}
// POST /dono/desbloquear {aparelho}
export async function donoDesbloquear(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'dados' }, 400, origin);
  // 11/11: desbloqueou (engano): o apelido inteiro dele também sai da lista, senão ele cairia de novo
  try {
    const r = await env.DB.prepare('SELECT nome FROM bloqueios WHERE aparelho = ?').bind(b.aparelho).first();
    const t = r && termoLimpo(r.nome);
    if (t) { await env.DB.prepare('DELETE FROM apelidos_bloqueados WHERE parte = 0 AND termo = ?').bind(t).run(); termosMudaram(); }
  } catch (e) {}
  await env.DB.prepare('DELETE FROM bloqueios WHERE aparelho = ?').bind(b.aparelho).run();
  return h.json({ ok: true }, 200, origin);
}
// ---- 3.41: pedir outro apelido (pedido do dono) ----
// Apelido ofensivo que passou pelo filtro: o administrador "derruba" a pessoa. Mais leve que o bloqueio: ela sai da
// mesa na hora (um robô assume a cadeira), recebe o aviso de que o apelido não está de acordo com as regras e o app a
// leva para escolher outro. Com o apelido novo, joga normalmente. Enquanto insistir no mesmo apelido (com ou sem
// números, acentos e espaços), não entra na mesa online, na mesa rápida, nem cria mesa. Guarda só o código do aparelho,
// o apelido barrado e quando foi; a linha some quando o apelido muda.
const soLetras = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
export function mesmoApelido(a, b) { const x = soLetras(a), y = soLetras(b); return !!x && x === y; }
// true: este aparelho ainda usa o apelido barrado. Mandou outro apelido: libera (apaga o pedido).
export async function apelidoBarrado(env, aparelho, nome) {
  if (!aparelho || !nome) return false;
  try {
    const r = await env.DB.prepare('SELECT nome FROM apelidos_trocar WHERE aparelho = ?').bind(aparelho).first();
    if (!r) return false;
    if (mesmoApelido(r.nome, nome)) return true;
    await env.DB.prepare('DELETE FROM apelidos_trocar WHERE aparelho = ?').bind(aparelho).run();
  } catch (e) {}
  return false;
}
// POST /dono/apelido {aparelho, nome?} ou {mesa, cadeira}
export async function donoApelido(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  let aparelho = idOk(b.aparelho) ? b.aparelho : null, nome = null, mesa = null, saiu = false;
  if (!aparelho && /^\d{5}$/.test(String(b.mesa || '')) && Number.isInteger(b.cadeira)) {
    const r = await env.MESA.get(env.MESA.idFromName(String(b.mesa))).fetch('https://mesa/expulsar', { method: 'POST', body: JSON.stringify({ cadeira: b.cadeira, motivo: 'apelido' }) });
    const j = await r.json().catch(() => ({}));
    if (!j.id) return h.json({ erro: 'nao-achei' }, 404, origin);
    aparelho = j.id; nome = j.nome || null; saiu = true;
  } else if (aparelho) {
    // o apelido de agora: o mais recente entre a mesa online e o "No app agora"
    const v = await env.DB.prepare('SELECT nome, mesa, visto_em FROM jogadores_vistos WHERE aparelho = ?').bind(aparelho).first();
    const p = await env.DB.prepare('SELECT nome, visto_em FROM presenca WHERE aparelho = ?').bind(aparelho).first();
    nome = (p && p.nome && (!v || p.visto_em >= v.visto_em) ? p.nome : v && v.nome) || String(b.nome || '').slice(0, 16) || null;
    mesa = v && v.mesa;
  } else return h.json({ erro: 'dados' }, 400, origin);
  if (!nome) return h.json({ erro: 'sem-apelido' }, 404, origin);
  await env.DB.prepare('INSERT INTO apelidos_trocar (aparelho, nome, em) VALUES (?, ?, ?) ON CONFLICT (aparelho) DO UPDATE SET nome = excluded.nome, em = excluded.em')
    .bind(aparelho, nome, Date.now()).run();
  // some do ranking e da turma na hora ("Jogador" não aparece no ranking); com o apelido novo, volta com ele
  for (const sql of ["UPDATE calcada SET nome = 'Jogador' WHERE aparelho = ?", "UPDATE ranking SET nome = 'Jogador' WHERE aparelho = ?", "UPDATE turma_membros SET nome = 'Jogador' WHERE aparelho = ?"]) {
    try { await env.DB.prepare(sql).bind(aparelho).run(); } catch (e) {}
  }
  // e sai da mesa em que estava
  if (!saiu && mesa) {
    try { const r = await env.MESA.get(env.MESA.idFromName(mesa)).fetch('https://mesa/expulsar', { method: 'POST', body: JSON.stringify({ id: aparelho, motivo: 'apelido' }) }); saiu = !!(await r.json().catch(() => ({}))).id; } catch (e) {}
  }
  return h.json({ ok: true, nome, saiu }, 200, origin);
}

// ---- 3.41: robôs de fora (pedido do dono) ----
// Só joga online quem está com o app aberto: o app avisa o "No app agora" a cada 20 s e antes de entrar numa mesa;
// um programa que fala direto com o servidor não avisa. Vale para entrar na mesa, criar mesa e a mesa rápida (quem
// já está sentado e só reconectou não precisa). No Cloudflare vale sempre; no teste local, só com EXIGE_APP=1.
export const exigeApp = env => String((env && env.EXIGE_APP) ?? '1') !== '0';
export async function appAberto(env, aparelho) {
  if (!aparelho) return false;
  try { const r = await env.DB.prepare('SELECT visto_em FROM presenca WHERE aparelho = ?').bind(aparelho).first(); return !!r && r.visto_em > Date.now() - 10 * 60000; } catch (e) { return true; }
}
// Ritmo das jogadas, por aparelho e por dia: quantas jogadas, quantas rápidas demais para gente (menos de 0,7 s
// desde que a vez chegou) e o tempo somado; e quantas vezes tentou entrar sem o app. Fica 30 dias. Só o administrador vê.
const diaDe = ms => new Date(ms - 4 * 3600000).toISOString().slice(0, 10);
export async function anotarRitmo(env, aparelho, r) {
  if (!idOk(aparelho) || !r) return;
  try {
    await env.DB.prepare(`INSERT INTO ritmo (dia, aparelho, jogadas, rapidas, soma_ms, sem_app) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (dia, aparelho) DO UPDATE SET jogadas = jogadas + excluded.jogadas, rapidas = rapidas + excluded.rapidas,
      soma_ms = soma_ms + excluded.soma_ms, sem_app = sem_app + excluded.sem_app`)
      .bind(diaDe(Date.now()), aparelho, r.n || 0, r.rapidas || 0, Math.round(r.soma || 0), r.semApp || 0).run();
  } catch (e) {}
}
// GET /dono/robos -> quem parece robô nos últimos 7 dias (e o tempo típico de quem joga, para comparar)
export const RAPIDA_MS = 700;
export async function donoRobos(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const desde = diaDe(Date.now() - 7 * DIA);
  const { results } = await env.DB.prepare(`SELECT r.aparelho, SUM(r.jogadas) AS jogadas, SUM(r.rapidas) AS rapidas, SUM(r.soma_ms) AS soma, SUM(r.sem_app) AS sem_app,
      MAX(r.dia) AS ultimo, (SELECT nome FROM jogadores_vistos v WHERE v.aparelho = r.aparelho) AS nome,
      (SELECT nome FROM presenca p WHERE p.aparelho = r.aparelho) AS nome2, (SELECT 1 FROM bloqueios b WHERE b.aparelho = r.aparelho) AS bloq
    FROM ritmo r WHERE r.dia >= ? AND r.aparelho NOT LIKE 'teste-publicacao-%' GROUP BY r.aparelho`).bind(desde).all();   // 28/10: sem o aparelho do teste automático
  const lista = (results || []).map(x => {
    const media = x.jogadas ? Math.round(x.soma / x.jogadas) : null, pctRap = x.jogadas ? x.rapidas / x.jogadas : 0;
    const motivos = [];
    if (x.sem_app) motivos.push({ t: 'sem-app', n: x.sem_app });
    if (x.jogadas >= 20 && pctRap >= 0.5) motivos.push({ t: 'rapidas', pct: Math.round(pctRap * 100) });
    if (x.jogadas >= 30 && media != null && media < 1200) motivos.push({ t: 'media', ms: media });
    return { aparelho: x.aparelho, nome: x.nome || x.nome2 || null, jogadas: x.jogadas, rapidas: x.rapidas, media, semApp: x.sem_app, ultimo: x.ultimo, bloq: !!x.bloq, motivos };
  });
  const medias = lista.filter(x => x.jogadas >= 20 && x.media != null).map(x => x.media).sort((a, b) => a - b);
  const suspeitos = lista.filter(x => x.motivos.length).sort((a, b) => b.motivos.length - a.motivos.length || (b.semApp || 0) - (a.semApp || 0) || (a.media || 1e9) - (b.media || 1e9)).slice(0, 40);
  return h.json({ medidos: lista.filter(x => x.jogadas).length, tipico: medias.length ? medias[Math.floor(medias.length / 2)] : null, suspeitos }, 200, origin);
}

// No agendado: a lista de quem jogou online guarda no máximo 30 dias
export async function limparVistos(env) {
  await env.DB.prepare('DELETE FROM jogadores_vistos WHERE visto_em < ?').bind(Date.now() - 30 * DIA).run();
  // pedido de outro apelido de quem sumiu do jogo: some em 90 dias
  try { await env.DB.prepare('DELETE FROM apelidos_trocar WHERE em < ?').bind(Date.now() - 90 * DIA).run(); } catch (e) {}
  try { await env.DB.prepare('DELETE FROM ritmo WHERE dia < ?').bind(diaDe(Date.now() - 30 * DIA)).run(); } catch (e) {}
}
