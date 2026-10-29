// Planos (28/10, regras do dono). Sem plano (Grátis): 5 partidas completas por dia na mesa rápida (mesas públicas
// online); nas mesas com os amigos, cria 1 mesa por dia e joga 1 partida por dia (mesmo convidado), com o papo de mesa
// liberado nessa partida; o ranking mostra só o Rei da Calçada e os 3 primeiros da semana. O Sócio da Calçada (mensal,
// trimestral ou anual) não tem limite e vê tudo. Jogo offline: sem limite para todos. Os limites zeram à meia-noite de
// Brasília e só valem a partir do lançamento (avisado 7 dias antes). O servidor guarda, por aparelho e dia, só quantas
// mesas criou e quantas partidas jogou (com os amigos e na mesa rápida), por 7 dias.
export const PLANOS_DESDE = Date.UTC(2026, 10, 5, 3, 0, 0);   // 05/11/2026, 00:00 de Brasília
export const LIMITE = { mesas: 1, partidas: 1, publicas: 5 };
const DIA = 86400000;

export function planosDesde(env) {
  const v = env && env.PLANOS_DESDE;
  return v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : PLANOS_DESDE;
}
export const limitesValem = (env, agora) => (agora || Date.now()) >= planosDesde(env);
// Promoção de lançamento (decisão do dono): vale até o começo dos limites (05/11, 00:00 de Brasília). Quem assina até
// lá paga o preço promocional nos primeiros ciclos; depois, o normal. PROMO_ATE no ambiente muda a data.
export function promoAte(env) {
  const v = env && env.PROMO_ATE;
  return v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : planosDesde(env);
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
    return { dia, mesas: (r && r.mesas) || 0, partidas: (r && r.partidas) || 0, publicas: (r && r.publicas) || 0 };
  } catch (e) { return { dia, mesas: 0, partidas: 0, publicas: 0, falhou: true }; }
}
const CAMPOS = ['mesas', 'partidas', 'publicas'];
export async function somarUso(env, aparelho, campo, dia) {
  if (!aparelho || !CAMPOS.includes(campo)) return;
  const d = dia || diaBR();
  try {
    await env.DB.prepare(`INSERT INTO limites (dia, aparelho, mesas, partidas, publicas) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (dia, aparelho) DO UPDATE SET ${campo} = ${campo} + 1`).bind(d, aparelho, ...CAMPOS.map(k => k === campo ? 1 : 0)).run();
    if (Math.random() < .05) await env.DB.prepare('DELETE FROM limites WHERE dia < ?').bind(diaBR(Date.now() - 7 * DIA)).run();
  } catch (e) {}
}
// quem ainda pode jogar uma partida hoje (uso guardado na cadeira: { dia, partidas, publicas }): na mesa com os amigos
// (publica = false) ou na mesa rápida (publica = true)
export const podeJogar = (c, env, publica) => !c || c.bot || c.apoiador || !limitesValem(env) || !c.uso || c.uso.dia !== diaBR()
  || (publica ? (c.uso.publicas || 0) < LIMITE.publicas : (c.uso.partidas || 0) < LIMITE.partidas);

// ---- 28/10 (pedido do dono): ninguém ganha partidas de graça a mais trocando de apelido ou apagando os dados do app ----
// O limite é do código do aparelho: trocar de apelido não muda nada. Quem apaga os dados do app (ou abre em outro
// navegador) ganha um código novo; por isso, um aparelho novo (visto pela 1ª vez há menos de 24 h) que chega pela mesma
// rede de um aparelho que bateu o limite hoje herda o limite, se usar o mesmo apelido ou se apareceu até 2 horas depois.
// A rede fica só como um resumo (hash do endereço com o dia, que muda todo dia): o endereço nunca é guardado. 2 dias.
const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
export async function marcaRede(ip, env) { return ip ? (await sha('rede|' + ip + '|' + diaBR() + '|' + ((env && env.ADMIN_HASH) || ''))).slice(0, 24) : null; }
const nomeChave = n => String(n || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
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
