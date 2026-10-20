// Bloqueio de jogadores (3.25): o administrador bloqueia quem usar apelido ou foto ofensiva. Quem está bloqueado sai
// da mesa na hora (um robô assume a cadeira), perde a foto e não entra mais na mesa online, na mesa rápida nem nas
// turmas. O jogo offline continua. O servidor guarda só o código aleatório do aparelho, o apelido e quando foi.
const DIA = 86400000;
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));

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
      (SELECT 1 FROM bloqueios b WHERE b.aparelho = v.aparelho) AS bloq
    FROM jogadores_vistos v WHERE v.visto_em > ? ORDER BY v.visto_em DESC LIMIT 60`).bind(Date.now() - 7 * DIA).all();
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
  } else return h.json({ erro: 'dados' }, 400, origin);
  await env.DB.prepare('INSERT INTO bloqueios (aparelho, nome, motivo, em) VALUES (?, ?, ?, ?) ON CONFLICT (aparelho) DO UPDATE SET motivo = excluded.motivo, em = excluded.em')
    .bind(aparelho, nome, motivo, Date.now()).run();
  // a foto sai da mesa (fica recusada)
  await env.DB.prepare("UPDATE fotos SET status = 'recusada', dados = '', revisado_em = ? WHERE aparelho = ?").bind(Date.now(), aparelho).run();
  // e a pessoa sai da mesa em que estava
  if (mesa) { try { await env.MESA.get(env.MESA.idFromName(mesa)).fetch('https://mesa/expulsar', { method: 'POST', body: JSON.stringify({ id: aparelho }) }); } catch (e) {} }
  return h.json({ ok: true, nome }, 200, origin);
}
// POST /dono/desbloquear {aparelho}
export async function donoDesbloquear(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!idOk(b.aparelho)) return h.json({ erro: 'dados' }, 400, origin);
  await env.DB.prepare('DELETE FROM bloqueios WHERE aparelho = ?').bind(b.aparelho).run();
  return h.json({ ok: true }, 200, origin);
}
// No agendado: a lista de quem jogou online guarda no máximo 30 dias
export async function limparVistos(env) {
  await env.DB.prepare('DELETE FROM jogadores_vistos WHERE visto_em < ?').bind(Date.now() - 30 * DIA).run();
}
