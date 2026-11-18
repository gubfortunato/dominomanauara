// Números do jogo para a área do administrador (03/11, pedido do dono): quantos já jogaram desde o início, média de
// partidas por jogador, horários de acesso e picos, novos por dia, quem voltou e outros números de acompanhamento.
// Tudo sai do aviso de "app aberto" (presença), que o app já manda a cada minuto. Só o código aleatório do aparelho e
// contagens: sem apelido, sem foto, sem endereço. O horário é o de Manaus.
import { produtoDoPedido } from './pagamentos.js';   // 17/11: o tempo de sócio de cada pagamento (curvas do painel)
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
  const socios = await um('SELECT COUNT(DISTINCT codigo) AS n, COUNT(*) AS aparelhos FROM planos WHERE ate > ? AND aparelho NOT IN (SELECT aparelho FROM cortesias) AND NOT EXISTS (SELECT 1 FROM presentes_dono g WHERE g.aparelho = planos.aparelho AND g.ate = planos.ate AND g.tirado IS NULL AND NOT EXISTS (SELECT 1 FROM pedidos d WHERE d.aparelho = g.aparelho AND d.status = \'pago\'))', agora);   // sem o dono e a Erika
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

// ===== 17/11 (pedido do dono: "análise de conversão x novos usuários, curvas de subida e queda") =====
// GET /dono/crescimento?dias=30|60 -> as curvas por dia (jogadores, novos, sócios pagantes, entradas e saídas de sócios,
// vendas), a turma de novos de cada semana (quantos voltaram, ficaram e viraram sócios), o funil dos novos e o resumo da
// semana contra a anterior. Sócio aqui é só quem pagou (sem presentes do dono, cortesias e aparelhos de teste); o tempo de
// sócio sai dos próprios pagamentos (cada um soma os dias do produto, como o plano faz), então a curva mostra quem entrou
// e quem saiu de verdade. Só contagens e códigos aleatórios de aparelho: nenhum nome sai daqui.
const CRESC = { t: 0, chave: '', dados: null };
export async function donoCrescimento(req, env, origin, h, url) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const N = String(url && url.searchParams.get('dias')) === '60' ? 60 : 30;
  const agora = Date.now();
  const novo = !!(url && url.searchParams.get('novo') === '1');   // o botão Atualizar do painel
  if (!novo && CRESC.dados && CRESC.chave === String(N) && agora - CRESC.t < 5 * 60000) return h.json(Object.assign({}, CRESC.dados, { cache: true }), 200, origin);
  const hoje = diaDe(agora), inicio = d => Date.parse(d + 'T00:00:00Z') - MANAUS;
  const lista = []; for (let k = N - 1; k >= 0; k--) lista.push(diaDe(agora - k * DIA));
  const todos = async (sql, ...a) => { try { return (await env.DB.prepare(sql).bind(...a).all()).results || []; } catch (e) { return []; } };
  // semanas de segunda a domingo (horário de Manaus): as 8 últimas, a de agora incluída
  const seg = d => { const t = Date.parse(d + 'T00:00:00Z'), w = (new Date(t).getUTCDay() + 6) % 7; return new Date(t - w * DIA).toISOString().slice(0, 10); };
  const seg0 = new Date(Date.parse(seg(hoje) + 'T00:00:00Z') - 7 * 7 * DIA).toISOString().slice(0, 10);
  const desde = Math.min(inicio(lista[0]), inicio(seg0));
  const fora = new Set();
  for (const r of await todos('SELECT aparelho FROM cortesias')) fora.add(r.aparelho);
  for (const r of await todos('SELECT aparelho FROM dono_aparelhos')) fora.add(r.aparelho);
  const ok = a => !!a && !/^teste-/.test(a) && !fora.has(a);

  // jogadores novos (desde 03/11 a contagem é por aparelho; "semente" = já existia antes da contagem)
  const novosL = (await todos('SELECT aparelho, primeiro, ultimo, jogou FROM jogadores WHERE semente = 0 AND primeiro >= ?', desde)).filter(x => ok(x.aparelho));
  const ativosDia = await todos("SELECT dia, COUNT(DISTINCT aparelho) AS n FROM acessos_hora WHERE dia >= ? AND aparelho NOT LIKE 'teste-%' GROUP BY dia", lista[0]);
  // quem jogou em cada semana e, dele, quem voltou na semana seguinte
  const semanasAt = await todos(`WITH p AS (SELECT DISTINCT aparelho, CAST((julianday(dia) - julianday(?1)) / 7 AS INTEGER) AS w FROM acessos_hora WHERE dia >= ?1 AND aparelho NOT LIKE 'teste-%')
    SELECT a.w AS w, COUNT(*) AS ativos, COUNT(b.aparelho) AS voltaram FROM p a LEFT JOIN p b ON b.aparelho = a.aparelho AND b.w = a.w + 1 GROUP BY a.w`, seg0);
  // pagamentos (todos: são poucos) e pedidos de pagamento abertos pelos novos
  const pagos = (await todos("SELECT aparelho, produto, valor, pago_em FROM pedidos WHERE status = 'pago' AND pago_em IS NOT NULL AND aparelho IS NOT NULL ORDER BY pago_em")).filter(x => ok(x.aparelho));
  const pediram = new Set((await todos('SELECT DISTINCT aparelho FROM pedidos WHERE criado_em >= ? AND aparelho IS NOT NULL', desde)).map(x => x.aparelho));

  // tempo de sócio de cada aparelho, a partir dos pagamentos: pagou antes de acabar, soma no fim; depois, começa de novo
  const durDe = (produto, valor) => { const x = produtoDoPedido(produto, valor); return (x && x.dias) || 31; };
  const faixas = [], primeiroPago = new Map();
  const porAp = new Map(); for (const p of pagos) { if (!porAp.has(p.aparelho)) porAp.set(p.aparelho, []); porAp.get(p.aparelho).push(p); }
  for (const [ap, l] of porAp) {
    primeiroPago.set(ap, l[0].pago_em);
    let ini = null, fim = 0;
    for (const p of l) {
      if (ini != null && p.pago_em <= fim) fim += durDe(p.produto, p.valor) * DIA;
      else { if (ini != null) faixas.push([ini, fim]); ini = p.pago_em; fim = p.pago_em + durDe(p.produto, p.valor) * DIA; }
    }
    if (ini != null) faixas.push([ini, fim]);
  }
  const sociosEm = t => faixas.reduce((n, f) => n + (f[0] <= t && f[1] > t ? 1 : 0), 0);

  // por dia
  const contaPor = (l, f) => { const m = {}; for (const x of l) { const d = f(x); if (d) m[d] = (m[d] || 0) + 1; } return m; };
  const novosM = contaPor(novosL, x => diaDe(x.primeiro));
  const ativosM = Object.fromEntries(ativosDia.map(x => [x.dia, x.n]));
  const entraramM = {}; for (const t of primeiroPago.values()) { const d = diaDe(t); entraramM[d] = (entraramM[d] || 0) + 1; }
  const voltouM = {};   // voltou a pagar depois de um tempo sem plano (não é a primeira vez)
  for (const [ap, l] of porAp) { let fim = 0, prim = true; for (const p of l) { if (!prim && p.pago_em > fim) { const d = diaDe(p.pago_em); voltouM[d] = (voltouM[d] || 0) + 1; } fim = Math.max(fim, p.pago_em) + durDe(p.produto, p.valor) * DIA; prim = false; } }
  const sairamM = {}; for (const f of faixas) if (f[1] < agora) { const d = diaDe(f[1]); sairamM[d] = (sairamM[d] || 0) + 1; }
  const receitaM = {}; for (const p of pagos) { const d = diaDe(p.pago_em); receitaM[d] = Math.round(100 * ((receitaM[d] || 0) + (Number(p.valor) || 0))) / 100; }
  const dias = lista.map(d => {
    const fimDia = Math.min(inicio(d) + DIA - 1, agora);
    return { d, novos: novosM[d] || 0, ativos: ativosM[d] || 0, socios: sociosEm(fimDia), entraram: (entraramM[d] || 0) + (voltouM[d] || 0), sairam: sairamM[d] || 0, receita: receitaM[d] || 0 };
  });

  // turma de novos de cada semana
  const atM = Object.fromEntries(semanasAt.map(x => [x.w, x]));
  const semanas = [];
  for (let w = 0; w < 8; w++) {
    const ini = inicio(new Date(Date.parse(seg0 + 'T00:00:00Z') + w * 7 * DIA).toISOString().slice(0, 10)), fim = ini + 7 * DIA;
    const l = novosL.filter(x => x.primeiro >= ini && x.primeiro < fim);
    const velhos = l.filter(x => x.primeiro <= agora - 7 * DIA);   // só quem chegou há 7 dias ou mais pode ter "ficado"
    const at = atM[w] || {};
    semanas.push({
      ini: diaDe(ini), atual: fim > agora, novos: l.length, jogaram: l.filter(x => x.jogou).length,
      voltaram: l.filter(x => diaDe(x.ultimo) > diaDe(x.primeiro)).length,
      ficaram: velhos.filter(x => x.ultimo - x.primeiro >= 7 * DIA).length, podiamFicar: velhos.length,
      pediram: l.filter(x => pediram.has(x.aparelho)).length, pagaram: l.filter(x => primeiroPago.has(x.aparelho)).length,
      ativos: at.ativos || 0, voltaramSemana: fim + 7 * DIA > agora ? null : (at.voltaram || 0)   // só com a semana seguinte inteira
    });
  }

  // funil dos novos dos últimos 30 dias
  const n30 = novosL.filter(x => x.primeiro >= agora - 30 * DIA), v30 = n30.filter(x => x.primeiro <= agora - 7 * DIA);
  const conv = n30.filter(x => primeiroPago.has(x.aparelho));
  const tempos = conv.map(x => Math.max(0, primeiroPago.get(x.aparelho) - x.primeiro)).sort((a, b) => a - b);
  const funil = {
    novos: n30.length, jogaram: n30.filter(x => x.jogou).length, voltaram: n30.filter(x => diaDe(x.ultimo) > diaDe(x.primeiro)).length,
    ficaram: v30.filter(x => x.ultimo - x.primeiro >= 7 * DIA).length, podiamFicar: v30.length,
    pediram: n30.filter(x => pediram.has(x.aparelho)).length, pagaram: conv.length,
    diasAteSocio: tempos.length ? Math.round(10 * tempos[Math.floor((tempos.length - 1) / 2)] / DIA) / 10 : null,
    mesmoDia: conv.filter(x => diaDe(primeiroPago.get(x.aparelho)) === diaDe(x.primeiro)).length
  };

  // resumo: últimos 7 dias contra os 7 anteriores (dias completos para médias; hoje entra nas somas)
  const ult = n => { const l = []; for (let k = n - 1; k >= 0; k--) l.push(diaDe(agora - k * DIA)); return l; };
  const d14 = ult(14), ant = d14.slice(0, 7), cur = d14.slice(7);
  const soma = (ds, m) => Math.round(100 * ds.reduce((s, d) => s + (m[d] || 0), 0)) / 100;
  const media = (ds, m) => { const v = ds.map(d => m[d] || 0); return v.length ? Math.round(10 * v.reduce((s, x) => s + x, 0) / v.length) / 10 : 0; };
  const curC = ult(8).slice(0, 7), antC = ult(15).slice(0, 7);   // 7 dias completos (sem hoje) e os 7 de antes
  const ret = semanas.filter(s => s.voltaramSemana != null && s.ativos > 0);
  const ultRet = ret.length ? ret[ret.length - 1] : null;
  const resumo = {
    novos: soma(cur, novosM), novosAnt: soma(ant, novosM),
    ativosMedia: media(curC, ativosM), ativosMediaAnt: media(antC, ativosM),
    socios: sociosEm(agora), socios7: sociosEm(agora - 7 * DIA),
    entraram: soma(cur, entraramM) + soma(cur, voltouM), sairam: soma(cur, sairamM),
    receita: soma(cur, receitaM), receitaAnt: soma(ant, receitaM),
    retencao: ultRet ? { semana: ultRet.ini, ativos: ultRet.ativos, voltaram: ultRet.voltaramSemana } : null,
    sociosTotal: primeiroPago.size
  };
  const comeco = await todos('SELECT MIN(dia) AS d FROM acessos_hora');
  const dados = { agora, hoje, n: N, dias, semanas, funil, resumo, contagemDesde: (comeco[0] && comeco[0].d) || null };
  CRESC.t = agora; CRESC.chave = String(N); CRESC.dados = dados;
  return h.json(dados, 200, origin);
}
