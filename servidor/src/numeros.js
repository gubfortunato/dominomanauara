// Números do jogo para a área do administrador (03/11, pedido do dono): quantos já jogaram desde o início, média de
// partidas por jogador, horários de acesso e picos, novos por dia, quem voltou e outros números de acompanhamento.
// Tudo sai do aviso de "app aberto" (presença), que o app já manda a cada minuto. Só o código aleatório do aparelho e
// contagens: sem apelido, sem foto, sem endereço. O horário é o de Manaus.
const MANAUS = -4 * 3600000, DIA = 86400000;
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || '')) && !/^teste-/.test(String(v));
const inteiro = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n < 1e6 ? n : null; };
export function quando(t) { const d = new Date(t + MANAUS); return { dia: d.toISOString().slice(0, 10), hora: d.getUTCHours() }; }
const diaDe = t => quando(t).dia;

// Para não escrever no banco a cada minuto: cada aparelho escreve no máximo uma vez por hora (o acesso daquela hora)
// e quando o dia vira ou as partidas mudam. O pico de gente ao mesmo tempo é medido no máximo uma vez por minuto.
const VISTO = new Map();
let ultPico = 0;

// Chamado pela presença: b = { aparelho, hist: { partidas, maos } } (o app antigo não manda hist)
export async function anotarAcesso(env, b, agora, janelaPresenca) {
  const id = b && b.aparelho; if (!idOk(id)) return;
  const { dia, hora } = quando(agora), dh = dia + '|' + hora;
  const hist = b.hist && typeof b.hist === 'object' ? b.hist : null;
  const partidas = hist ? inteiro(hist.partidas) : null, maos = hist ? inteiro(hist.maos) : null;
  const u = VISTO.get(id) || {};
  if (VISTO.size > 5000) VISTO.clear();
  try {
    if (u.dh !== dh) await env.DB.prepare('INSERT OR IGNORE INTO acessos_hora (dia, hora, aparelho) VALUES (?, ?, ?)').bind(dia, hora, id).run();
    if (u.dia !== dia || (partidas != null && partidas !== u.partidas) || (maos != null && maos !== u.maos)) {
      const r = await env.DB.prepare('SELECT partidas, informou FROM jogadores WHERE aparelho = ?').bind(id).first();
      const jogou = (maos || 0) > 0 || (partidas || 0) > 0 ? 1 : 0, informou = partidas != null ? 1 : 0;
      if (!r) {
        // primeira vez: as partidas de antes entram no total do aparelho, mas não nas partidas de hoje
        await env.DB.prepare('INSERT OR IGNORE INTO jogadores (aparelho, primeiro, ultimo, partidas, maos, jogou, informou, semente) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
          .bind(id, agora, agora, partidas || 0, maos || 0, jogou, informou).run();
      } else {
        const novas = informou && r.informou ? Math.max(0, partidas - (r.partidas || 0)) : 0;
        await env.DB.prepare(`UPDATE jogadores SET ultimo = ?, partidas = CASE WHEN ? THEN ? ELSE partidas END, maos = MAX(maos, ?),
            jogou = MAX(jogou, ?), informou = MAX(informou, ?) WHERE aparelho = ?`)
          .bind(agora, informou, partidas || 0, maos || 0, jogou, informou, id).run();
        if (novas > 0 && novas <= 30) await env.DB.prepare('INSERT INTO partidas_dia (dia, aparelho, n) VALUES (?, ?, ?) ON CONFLICT (dia, aparelho) DO UPDATE SET n = n + excluded.n').bind(dia, id, novas).run();
      }
    }
    VISTO.set(id, { dh, dia, partidas: partidas != null ? partidas : u.partidas, maos: maos != null ? maos : u.maos });
    if (agora - ultPico > 60000) {
      ultPico = agora;
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM presenca WHERE visto_em > ? AND aparelho NOT LIKE 'teste-%'").bind(agora - janelaPresenca).first();
      const n = Math.max(1, (c && c.n) || 0);   // quem avisou agora está com o app aberto (a linha dele pode ser gravada logo depois)
      await env.DB.prepare(`INSERT INTO pico_hora (dia, hora, maximo, em) VALUES (?, ?, ?, ?)
          ON CONFLICT (dia, hora) DO UPDATE SET em = CASE WHEN excluded.maximo > maximo THEN excluded.em ELSE em END, maximo = MAX(maximo, excluded.maximo)`)
        .bind(dia, hora, n, agora).run();
    }
  } catch (e) {}   // sem escrita no banco (limite): o jogo segue; só o número fica sem esta pessoa
}

// GET /dono/numeros -> tudo de uma vez para a área do administrador
export async function donoNumeros(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const agora = Date.now(), hoje = diaDe(agora);
  const dias = n => { const l = []; for (let k = n - 1; k >= 0; k--) l.push(diaDe(agora - k * DIA)); return l; };
  const d30 = dias(30), d7 = dias(7);
  const um = async (sql, ...a) => { try { return (await env.DB.prepare(sql).bind(...a).first()) || {}; } catch (e) { return {}; } };
  const todos = async (sql, ...a) => { try { return (await env.DB.prepare(sql).bind(...a).all()).results || []; } catch (e) { return []; } };
  // o começo do dia de Manaus (em ms) de um dia 'AAAA-MM-DD'
  const inicio = d => Date.parse(d + 'T00:00:00Z') - MANAUS;

  const tot = await um(`SELECT COUNT(*) AS abriram, SUM(jogou) AS jogaram, SUM(semente = 0) AS desde_contagem,
      SUM(CASE WHEN informou AND partidas > 0 THEN partidas ELSE 0 END) AS partidas, SUM(informou AND partidas > 0) AS com_partida,
      SUM(informou AND maos > 0) AS com_mao, MIN(primeiro) AS primeiro_registro FROM jogadores`);
  const ativos = await um(`SELECT SUM(ultimo >= ?) AS hoje, SUM(ultimo >= ?) AS d7, SUM(ultimo >= ?) AS d30 FROM jogadores`, inicio(hoje), inicio(d7[0]), inicio(d30[0]));
  const novos = await todos(`SELECT date((primeiro + ${MANAUS}) / 1000, 'unixepoch') AS dia, COUNT(*) AS n, SUM(jogou) AS jogaram FROM jogadores WHERE semente = 0 AND primeiro >= ? GROUP BY dia`, inicio(d30[0]));
  const porDia = await todos('SELECT dia, COUNT(DISTINCT aparelho) AS n FROM acessos_hora WHERE dia >= ? GROUP BY dia', d30[0]);
  // por hora do dia: média de pessoas diferentes em cada hora nos últimos 7 dias (contando só os dias que já têm dado) e hoje
  const horas7 = await todos('SELECT hora, COUNT(*) AS n, COUNT(DISTINCT dia) AS dias FROM acessos_hora WHERE dia >= ? AND dia < ? GROUP BY hora', d7[0], hoje);
  const diasCom = await um('SELECT COUNT(DISTINCT dia) AS n FROM acessos_hora WHERE dia >= ? AND dia < ?', d7[0], hoje);
  const horasHoje = await todos('SELECT hora, COUNT(*) AS n FROM acessos_hora WHERE dia = ? GROUP BY hora', hoje);
  const picoHoje = await um('SELECT hora, maximo, em FROM pico_hora WHERE dia = ? ORDER BY maximo DESC, em ASC LIMIT 1', hoje);
  const picoRecorde = await um('SELECT dia, hora, maximo, em FROM pico_hora WHERE dia >= ? ORDER BY maximo DESC, em ASC LIMIT 1', d30[0]);
  const picos7 = await todos('SELECT hora, MAX(maximo) AS maximo FROM pico_hora WHERE dia >= ? GROUP BY hora', d7[0]);
  // voltaram: dos novos dos últimos 30 dias (até anteontem), quantos abriram o app num outro dia depois do primeiro
  const volta = await um(`SELECT COUNT(*) AS n, SUM(date((ultimo + ${MANAUS}) / 1000, 'unixepoch') > date((primeiro + ${MANAUS}) / 1000, 'unixepoch')) AS voltaram
      FROM jogadores WHERE semente = 0 AND primeiro >= ? AND primeiro < ?`, inicio(d30[0]), inicio(diaDe(agora - DIA)));
  const part7 = await um('SELECT SUM(n) AS n, COUNT(DISTINCT aparelho) AS jogadores FROM partidas_dia WHERE dia >= ?', d7[0]);
  const ativosDias7 = await um('SELECT COUNT(*) AS n FROM (SELECT DISTINCT dia, aparelho FROM acessos_hora WHERE dia >= ?)', d7[0]);
  const socios = await um('SELECT COUNT(DISTINCT codigo) AS n, COUNT(*) AS aparelhos FROM planos WHERE ate > ?', agora);
  const mesas = await um('SELECT SUM(criado_em >= ?) AS hoje, SUM(criado_em >= ?) AS d7 FROM mesas_criadas', inicio(hoje), inicio(d7[0]));
  // "Hoje no Dominó Manauara" (desde a 3.24): partidas terminadas por dia, offline e online (cada partida uma vez só)
  const vivo = await todos('SELECT dia, partidas, galos, carrocas FROM vivo_dia WHERE dia >= ?', d30[0]);
  const lembretes = await um('SELECT COUNT(*) AS n FROM avisos');

  const mapa = (l, k, v) => Object.fromEntries(l.map(x => [x[k], x[v]]));
  const novosM = mapa(novos, 'dia', 'n'), porDiaM = mapa(porDia, 'dia', 'n'), vivoM = Object.fromEntries(vivo.map(x => [x.dia, x]));
  const soma = (l, k) => l.reduce((s, d) => s + ((vivoM[d] && vivoM[d][k]) || 0), 0);
  const h7 = mapa(horas7, 'hora', 'n'), hh = mapa(horasHoje, 'hora', 'n'), pk = mapa(picos7, 'hora', 'maximo');
  const nd = (diasCom && diasCom.n) || 0;
  return h.json({
    agora, hoje,
    total: { abriram: tot.abriram || 0, jogaram: tot.jogaram || 0, desdeContagem: tot.desde_contagem || 0, primeiroRegistro: tot.primeiro_registro || null },
    ativos: { hoje: ativos.hoje || 0, d7: ativos.d7 || 0, d30: ativos.d30 || 0 },
    novos: { hoje: novosM[hoje] || 0, d7: d7.reduce((s, d) => s + (novosM[d] || 0), 0) },
    partidas: {
      total: tot.partidas || 0, jogadores: tot.com_partida || 0,
      media: tot.com_partida ? Math.round(10 * tot.partidas / tot.com_partida) / 10 : null,
      d7: part7.n || 0, jogadores7: part7.jogadores || 0,
      porAtivoDia: ativosDias7.n ? Math.round(100 * (part7.n || 0) / ativosDias7.n) / 100 : null,
      hoje: (vivoM[hoje] && vivoM[hoje].partidas) || 0, semana: soma(d7, 'partidas'), galos7: soma(d7, 'galos'), carrocas7: soma(d7, 'carrocas')
    },
    voltaram: { n: volta.n || 0, voltaram: volta.voltaram || 0 },
    pico: { hoje: picoHoje.maximo ? picoHoje : null, recorde: picoRecorde.maximo ? picoRecorde : null },
    socios: { n: socios.n || 0, aparelhos: socios.aparelhos || 0 },
    mesasAmigos: { hoje: mesas.hoje || 0, d7: mesas.d7 || 0 },
    lembretes: lembretes.n || 0,
    horas: Array.from({ length: 24 }, (_, k) => ({ h: k, media: nd ? Math.round(10 * (h7[k] || 0) / nd) / 10 : 0, hoje: hh[k] || 0, pico: pk[k] || 0 })),
    diasComDado: nd,
    dias: d30.map(d => ({ d, pessoas: porDiaM[d] || 0, novos: novosM[d] || 0, partidas: (vivoM[d] && vivoM[d].partidas) || 0 }))
  }, 200, origin);
}

// No agendado: os acessos por hora ficam 60 dias; o resto é pequeno e fica
export async function limparNumeros(env) {
  const corte = diaDe(Date.now() - 60 * DIA);
  try { await env.DB.prepare('DELETE FROM acessos_hora WHERE dia < ?').bind(corte).run(); } catch (e) {}
  try { await env.DB.prepare('DELETE FROM pico_hora WHERE dia < ?').bind(corte).run(); } catch (e) {}
  try { await env.DB.prepare('DELETE FROM partidas_dia WHERE dia < ?').bind(corte).run(); } catch (e) {}
}
