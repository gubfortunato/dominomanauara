// Planos (28/10, regras do dono; 03/11: mesa rápida de 5 para 3, e até 3 com os amigos na mesa de um sócio). Sem plano (Grátis): 3 partidas completas por dia na mesa rápida (mesas públicas
// online); nas mesas com os amigos, cria 1 mesa por dia e joga 1 partida por dia (mesmo convidado), com o papo de mesa
// liberado nessa partida; o ranking mostra só o Rei da Calçada e os 3 primeiros da semana. O Sócio da Calçada (mensal,
// trimestral ou anual) não tem limite e vê tudo. Jogo offline: sem limite para todos. Os limites zeram à meia-noite de
// Brasília e só valem a partir do lançamento (avisado 7 dias antes). O servidor guarda, por aparelho e dia, só quantas
// mesas criou e quantas partidas jogou (com os amigos e na mesa rápida), por 7 dias.
export const PLANOS_DESDE = Date.UTC(2026, 10, 5, 3, 0, 0);   // 05/11/2026, 00:00 de Brasília
// 03/11 (regras do dono): sem plano, 3 partidas por dia na mesa rápida (antes 5); nas mesas com os amigos, 1 por dia, ou até 3
// quando a mesa é de um sócio (partidasSocio); 1 mesa criada por dia
// 04/11 (dono): desafios = partidas de desafio entre Turmas por dia, fora da partida grátis (mesa criada pelo botão Desafiar)
// 05/11 (pedido do dono): por 15 dias (de 5/11 a 19/11, dia de Brasília), sem plano joga 5 partidas por dia na mesa
// rápida (antes 3) e 2 nas mesas com os amigos (antes 1); e mais 2 mesas grátis por dia, diferentes a cada dia.
// Depois volta sozinho ao de antes. BONUS_ATE no ambiente muda o fim (para teste).
const BONUS_INI = Date.UTC(2026, 10, 5, 3, 0, 0), BONUS_FIM = Date.UTC(2026, 10, 20, 3, 0, 0);   // 05/11 00:00 a 20/11 00:00 de Brasília
let bonusFim = BONUS_FIM;
export const bonusValendo = (agora) => { const t = agora || Date.now(); return t >= BONUS_INI && t < bonusFim; };
export function bonusConfig(env) { const v = Number(env && env.BONUS_ATE); if (Number.isFinite(v) && v > 0) bonusFim = v; }
export const LIMITE = { mesas: 1, get partidas() { return bonusValendo() ? 2 : 1; }, partidasSocio: 3, get publicas() { return bonusValendo() ? 5 : 3; }, desafios: 2 };
// as 2 mesas a mais de cada dia (a ordem é a mesma no app: index.html, MESAS_RODIZIO)
export const MESAS_RODIZIO = ['teatro', 'tucano', 'encontro', 'boto', 'peixeboi', 'mercado', 'araraazul', 'pontanegra', 'arena', 'vitoria', 'arara', 'centro', 'floresta', 'ponte',
  'calcadao', 'acairoxo', 'anavilhanas', 'relogio', 'skylinenoite', 'acai', 'palacio', 'beiradao', 'rionegro', 'tucuma', 'chamine', 'barco', 'roxoacai', 'pordosol', 'feltro'];
export function mesasDoDia(agora) {
  const t = agora || Date.now(); if (!bonusValendo(t)) return [];
  const k = Math.floor((t - BONUS_INI) / DIA), n = MESAS_RODIZIO.length;
  return [MESAS_RODIZIO[(2 * k) % n], MESAS_RODIZIO[(2 * k + 1) % n]];
}
const DIA = 86400000;

export function planosDesde(env) {
  const v = env && env.PLANOS_DESDE;
  return v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : PLANOS_DESDE;
}
export const limitesValem = (env, agora) => (agora || Date.now()) >= planosDesde(env);
// Promoção de lançamento (decisão do dono): quem assina até o fim dela paga o preço promocional nos primeiros ciclos;
// depois, o normal. 03/11 (dono): vai até 30/11 (antes acabava junto do começo dos limites, 05/11), para pegar o
// primeiro mês de limites. PROMO_ATE no ambiente muda a data.
export const PROMO_ATE = Date.UTC(2026, 11, 1, 3, 0, 0);   // 01/12/2026, 00:00 de Brasília (vale até 30/11)
export function promoAte(env) {
  const v = env && env.PROMO_ATE;
  return v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : Math.max(PROMO_ATE, planosDesde(env));
}
export const promoValendo = (env, agora) => (agora || Date.now()) < promoAte(env);
// dia de Brasília (UTC-3, sem horário de verão)
export const diaBR = t => new Date((t || Date.now()) - 3 * 3600000).toISOString().slice(0, 10);

export async function temPlano(env, aparelho) {
  if (!aparelho) return false;
  try { const p = await env.DB.prepare('SELECT ate FROM planos WHERE aparelho = ?').bind(aparelho).first(); return !!(p && p.ate > Date.now()); }
  catch (e) { return true; }   // sem banco: não barra ninguém
}
export async function usoDoDia(env, aparelho) {
  const dia = diaBR();
  if (!aparelho) return { dia, mesas: 0, partidas: 0, publicas: 0 };
  try {
    const r = await env.DB.prepare('SELECT mesas, partidas, publicas FROM limites WHERE dia = ? AND aparelho = ?').bind(dia, aparelho).first();
    let desafios = 0;
    try { const d = await env.DB.prepare('SELECT n FROM desafio_uso WHERE dia = ? AND aparelho = ?').bind(dia, aparelho).first(); desafios = (d && d.n) || 0; } catch (e) {}
    return { dia, mesas: (r && r.mesas) || 0, partidas: (r && r.partidas) || 0, publicas: (r && r.publicas) || 0, desafios };
  } catch (e) { return { dia, mesas: 0, partidas: 0, publicas: 0, desafios: 0, falhou: true }; }
}
const CAMPOS = ['mesas', 'partidas', 'publicas'];
export async function somarUso(env, aparelho, campo, dia) {
  if (aparelho && campo === 'desafios') {
    try { await env.DB.prepare('INSERT INTO desafio_uso (dia, aparelho, n) VALUES (?, ?, 1) ON CONFLICT (dia, aparelho) DO UPDATE SET n = n + 1').bind(dia || diaBR(), aparelho).run(); } catch (e) {}
    return;
  }
  if (!aparelho || !CAMPOS.includes(campo)) return;
  const d = dia || diaBR();
  try {
    await env.DB.prepare(`INSERT INTO limites (dia, aparelho, mesas, partidas, publicas) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (dia, aparelho) DO UPDATE SET ${campo} = ${campo} + 1`).bind(d, aparelho, ...CAMPOS.map(k => k === campo ? 1 : 0)).run();
    if (Math.random() < .05) await env.DB.prepare('DELETE FROM limites WHERE dia < ?').bind(diaBR(Date.now() - 7 * DIA)).run();
  } catch (e) {}
}
// quem ainda pode jogar uma partida hoje (uso guardado na cadeira: { dia, partidas, publicas }): na mesa com os amigos
// (publica = false) ou na mesa rápida (publica = true). 03/11: na mesa de um sócio (daSocio), até LIMITE.partidasSocio.
// 04/11: na mesa de desafio (criada pelo botão Desafiar), também pode quem ainda tem desafio do dia
export const podeJogar = (c, env, publica, daSocio, desafio) => !c || c.bot || c.apoiador || !limitesValem(env) || !c.uso || c.uso.dia !== diaBR()
  || (publica ? (c.uso.publicas || 0) < LIMITE.publicas : (c.uso.partidas || 0) < (daSocio ? LIMITE.partidasSocio : LIMITE.partidas))
  || (!publica && !!desafio && (c.uso.desafios || 0) < LIMITE.desafios);

// ---- 28/10 (pedido do dono): ninguém ganha partidas de graça a mais trocando de apelido ou apagando os dados do app ----
// O limite é do código do aparelho: trocar de apelido não muda nada. Quem apaga os dados do app (ou abre em outro
// navegador) ganha um código novo; por isso, um aparelho novo (visto pela 1ª vez há menos de 24 h) que chega pela mesma
// rede de um aparelho que bateu o limite hoje herda o limite, se usar o mesmo apelido ou se apareceu até 2 horas depois.
// A rede fica só como um resumo (hash do endereço com o dia, que muda todo dia): o endereço nunca é guardado. 2 dias.
export const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
// 10/11 (revisão de segurança): o resumo da rede usava como "tempero" um valor que está no código público (dava para
// refazer os resumos). Agora usa um segredo guardado só no Cloudflare (SAL_REDE), a partir da virada do dia 11/11, para
// não zerar no meio do dia as marcas que já existem. Sem o segredo, continua como antes.
export const SAL_DESDE = '2026-11-11';
export function salRede(env, dia) { return (String(dia || diaBR()) >= SAL_DESDE && env && env.SAL_REDE) || (env && env.ADMIN_HASH) || ''; }
export async function marcaRede(ip, env) { const dia = diaBR(); return ip ? (await sha('rede|' + ip + '|' + dia + '|' + salRede(env, dia))).slice(0, 24) : null; }
const nomeChave = n => String(n || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
// 10/11 (pedido do dono, depois da análise de 5 a 9/11): quem apaga os dados (ou troca de aparelho/navegador) e volta com
// o MESMO apelido logo depois de bater o limite do dia fica com o limite também, em qualquer rede (antes, só na mesma
// rede). Só vale para apelido pouco comum (até 3 jogadores online com ele), para não pegar dois "João" diferentes.
// o apelido "limpo" no banco (o mesmo que nomeChave: minúsculo, sem acento, sem espaço nem pontuação)
const CHAVE_SQL = (() => {
  let e = 'lower(nome)';
  const tr = { a: 'áàâãäÁÀÂÃÄ', e: 'éèêëÉÈÊË', i: 'íìîïÍÌÎÏ', o: 'óòôõöÓÒÔÕÖ', u: 'úùûüÚÙÛÜ', c: 'çÇ', n: 'ñÑ' };
  for (const [k, v] of Object.entries(tr)) for (const ch of v) e = `replace(${e}, '${ch}', '${k}')`;
  for (const ch of [' ', '.', '_', '-', "''", '!', '*', '🥸']) e = `replace(${e}, '${ch}', '')`;
  return e;
})();
export async function limiteDoApelido(env, tipo, aparelho, nome) {
  const n = nomeChave(nome); if (!aparelho || n.length < 4) return false;
  try {
    const desde = await aparelhoDesde(env, aparelho);
    if (!(desde > Date.now() - DIA)) return false;   // aparelho que já existia: vale só o limite dele
    const { results } = await env.DB.prepare('SELECT em FROM limites_rede WHERE dia = ? AND tipo = ? AND nome = ? AND aparelho <> ? LIMIT 5').bind(diaBR(), tipo, n, aparelho).all();
    if (!(results || []).some(r => desde >= r.em)) return false;
    const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM jogadores_vistos WHERE ${CHAVE_SQL} = ?`).bind(n).first();
    return !(c && c.n > 3);
  } catch (e) { return false; }
}
// 10/11 (pronto, mas DESLIGADO até o dono decidir): aparelho antigo com o mesmo apelido pouco comum de outro aparelho que
// já bateu o limite hoje fica sem partida grátis também: o limite do dia é um só para os dois (app instalado + navegador,
// dois celulares). Para ligar: LIMITE_IRMAO_LIGADO = true (ou LIMITE_IRMAO = '1' no ambiente, para teste).
const LIMITE_IRMAO_LIGADO = false;
export async function limiteDoIrmao(env, tipo, aparelho, nome) {
  if (!(LIMITE_IRMAO_LIGADO || (env && env.LIMITE_IRMAO === '1'))) return false;
  const n = nomeChave(nome); if (!aparelho || n.length < 4 || !limitesValem(env)) return false;
  try {
    const r = await env.DB.prepare('SELECT 1 AS x FROM limites_rede WHERE dia = ? AND tipo = ? AND nome = ? AND aparelho <> ? LIMIT 1').bind(diaBR(), tipo, n, aparelho).first();
    if (!r || await temPlano(env, aparelho)) return false;
    const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM jogadores_vistos WHERE ${CHAVE_SQL} = ?`).bind(n).first();
    if (c && c.n > 3) return false;
    await anotarBurla(env, tipo, 'irmao', aparelho, nome);
    return true;
  } catch (e) { return false; }
}
// cada limite herdado (pela rede ou pelo apelido) fica anotado para o painel do dono ("Possíveis burlas")
export async function anotarBurla(env, tipo, via, aparelho, nome) {
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO burlas (dia, aparelho, tipo, via, nome, em) VALUES (?, ?, ?, ?, ?, ?)').bind(diaBR(), aparelho, tipo, via, String(nome || '').slice(0, 40), Date.now()).run();
    if (Math.random() < .05) await env.DB.prepare('DELETE FROM burlas WHERE dia < ?').bind(diaBR(Date.now() - 14 * DIA)).run();
  } catch (e) {}
}
export async function limiteHerdado(env, rede, tipo, aparelho, nome) {
  if (await limiteDaRede(env, rede, tipo, aparelho, nome)) { await anotarBurla(env, tipo, 'rede', aparelho, nome); return true; }
  if (await limiteDoApelido(env, tipo, aparelho, nome)) { await anotarBurla(env, tipo, 'apelido', aparelho, nome); return true; }
  return false;
}
// GET /dono/burlas: os limites herdados de hoje e de ontem, e os aparelhos novos de hoje com o apelido de quem bateu o
// limite e que ainda assim jogaram (apelido comum, ou chegaram antes desta regra). Só para o administrador.
export async function donoBurlas(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const dia = diaBR(), ontem = diaBR(Date.now() - DIA), agora = Date.now();
  const tudo = async (q, ...a) => { try { const { results } = await env.DB.prepare(q).bind(...a).all(); return results || []; } catch (e) { return []; } };
  const barrados = await tudo('SELECT dia, tipo, via, nome, em FROM burlas WHERE dia IN (?, ?) ORDER BY em DESC LIMIT 100', dia, ontem);
  const bateram = await tudo('SELECT aparelho, nome, tipo, MIN(em) AS em FROM limites_rede WHERE dia = ? GROUP BY aparelho, tipo', dia);
  const novos = await tudo(`SELECT a.aparelho, a.desde, COALESCE((SELECT nome FROM jogadores_vistos v WHERE v.aparelho = a.aparelho), (SELECT nome FROM presenca p WHERE p.aparelho = a.aparelho)) AS nome,
      (SELECT publicas FROM limites l WHERE l.dia = ? AND l.aparelho = a.aparelho) AS rapidas, (SELECT partidas FROM limites l WHERE l.dia = ? AND l.aparelho = a.aparelho) AS amigos,
      (SELECT n FROM offline_uso o WHERE o.dia = ? AND o.aparelho = a.aparelho) AS offline, (SELECT 1 FROM planos x WHERE x.aparelho = a.aparelho AND x.ate > ?) AS socio
    FROM aparelhos a WHERE a.desde > ?`, dia, dia, dia, agora, agora - DIA);
  const ja = new Set(barrados.filter(b => b.dia === dia).map(b => nomeChave(b.nome)));
  const suspeitos = [];
  for (const x of novos) {
    if (x.socio) continue;
    const k = nomeChave(x.nome); if (k.length < 3) continue;
    const b = bateram.find(r => r.nome === k && r.aparelho !== x.aparelho && x.desde > r.em);
    if (b && !ja.has(k)) suspeitos.push({ nome: x.nome, tipo: b.tipo, bateu: b.em, novo: x.desde, rapidas: x.rapidas || 0, amigos: x.amigos || 0, offline: x.offline || 0 });
  }
  return h.json({ dia, bateram: new Set(bateram.map(r => r.aparelho)).size, novos: novos.filter(x => !x.socio).length, barrados, suspeitos: suspeitos.slice(0, 80) }, 200, origin);
}
// quando o aparelho apareceu pela primeira vez numa mesa online (anota agora, se for a primeira)
export async function aparelhoDesde(env, aparelho) {
  if (!aparelho) return 0;
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO aparelhos (aparelho, desde) VALUES (?, ?)').bind(aparelho, Date.now()).run();
    const r = await env.DB.prepare('SELECT desde FROM aparelhos WHERE aparelho = ?').bind(aparelho).first();
    return r ? r.desde : 0;
  } catch (e) { return 0; }
}
// o aparelho bateu o limite de hoje (tipo: 'partidas' com os amigos ou 'publicas' na mesa rápida) por esta rede
export async function anotarLimite(env, rede, tipo, aparelho, nome) {
  if (!rede || !aparelho) return;
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO limites_rede (dia, marca, tipo, aparelho, nome, em) VALUES (?, ?, ?, ?, ?, ?)').bind(diaBR(), rede, tipo, aparelho, nomeChave(nome), Date.now()).run();
    if (Math.random() < .05) await env.DB.prepare('DELETE FROM limites_rede WHERE dia < ?').bind(diaBR(Date.now() - 2 * DIA)).run();
  } catch (e) {}
}
// aparelho novo nesta rede, logo depois de outro bater o limite (ou com o mesmo apelido): fica com o limite também
export async function limiteDaRede(env, rede, tipo, aparelho, nome) {
  if (!rede || !aparelho) return false;
  try {
    const desde = await aparelhoDesde(env, aparelho);
    if (!(desde > Date.now() - DIA)) return false;   // aparelho que já existia: vale só o limite dele
    const { results } = await env.DB.prepare('SELECT nome, em FROM limites_rede WHERE dia = ? AND marca = ? AND tipo = ? AND aparelho <> ? LIMIT 30').bind(diaBR(), rede, tipo, aparelho).all();
    const n = nomeChave(nome);
    return (results || []).some(r => (n.length >= 2 && r.nome === n) || (desde >= r.em && desde - r.em < 2 * 3600000));
  } catch (e) { return false; }
}
