// "Hoje no Dominó Manauara" (3.24): números de verdade do dia (dia de Manaus) — partidas terminadas, galos e
// batidas de carroça. Offline, o celular de quem jogou avisa ao fim de cada mão em que houve algo para contar;
// online, a própria mesa conta (assim a mesma partida não é contada por cada jogador).
const LIMITE_POR_HORA = 120;
const ENVIOS = { h: 0, m: new Map() };   // por rede, contra quem quiser inflar os números
export const diaManaus = (t) => new Date((t || Date.now()) - 4 * 3600000).toISOString().slice(0, 10);

export async function somarVivo(env, partidas, galos, carrocas) {
  if (!partidas && !galos && !carrocas) return;
  await env.DB.prepare('INSERT INTO vivo_dia (dia, partidas, galos, carrocas) VALUES (?, ?, ?, ?) ON CONFLICT (dia) DO UPDATE SET partidas = partidas + excluded.partidas, galos = galos + excluded.galos, carrocas = carrocas + excluded.carrocas')
    .bind(diaManaus(), partidas, galos, carrocas).run();
}

// POST /vivo/conta { partida: 0|1, galos, carrocas } — do jogo offline
export async function conta(req, env, origin, h) {
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const n = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const partida = n(b && b.partida, 1), galos = n(b && b.galos, 6), carrocas = n(b && b.carrocas, 2);
  if (!partida && !galos && !carrocas) return h.json({ ok: true }, 200, origin);
  const marca = await h.marcaDoDia(req, env), hora = Math.floor(Date.now() / 3600000);
  // 27/10: o controle por hora fica na memória (antes, uma linha no banco por aviso: escrita demais no plano grátis)
  if (ENVIOS.h !== hora) { ENVIOS.h = hora; ENVIOS.m.clear(); }
  const qtd = (ENVIOS.m.get(marca) || 0) + 1; ENVIOS.m.set(marca, qtd);
  if (qtd > LIMITE_POR_HORA) return h.json({ erro: 'muitas' }, 429, origin);
  try { await somarVivo(env, partida, galos, carrocas); } catch (e) {}
  return h.json({ ok: true }, 200, origin);
}

// GET /vivo/hoje — os números do dia (o celular guarda por 1 minuto)
export async function hoje(env, origin, h) {
  const dia = diaManaus();
  const r = await env.DB.prepare('SELECT partidas, galos, carrocas FROM vivo_dia WHERE dia = ?').bind(dia).first();
  return h.json({ dia, partidas: (r && r.partidas) || 0, galos: (r && r.galos) || 0, carrocas: (r && r.carrocas) || 0 }, 200, origin);
}

// No agendado: apaga o controle de envios antigo (só serve para o limite por hora)
export async function limparVivo(env) {
  await env.DB.prepare('DELETE FROM vivo_envios WHERE criado_em < ?').bind(Date.now() - 2 * 3600000).run();
}
