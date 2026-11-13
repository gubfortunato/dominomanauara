// 12/11 (pedido do dono: "endurecer esse tipo de fraude", com a garantia de não prejudicar quem joga de boa-fé nem sócio).
// O limite grátis é por PESSOA, não por aparelho. Duas regras aqui (a 3ª, do aparelho novo, fica em planos.js):
//  1. Mesmo apelido + mesma rede + mesmo dia: os aparelhos dividem o limite do dia (vale a soma das partidas). Ex.: o app
//     instalado e o navegador do mesmo celular, ou dois celulares da mesma pessoa no mesmo Wi-Fi.
//  2. Vigia: apelido que aparece em vários aparelhos para jogar mais que o limite (3 aparelhos novos no mesmo dia, 2 deles
//     na mesma rede; ou um aparelho novo que chega depois de outro com o mesmo apelido bater o limite). Na 1ª vez NÃO
//     bloqueia: por 7 dias, todos os aparelhos com esse apelido dividem um limite só (em qualquer rede) e a tela do limite
//     avisa que o limite é por pessoa. Só bloqueia se continuar depois do aviso: 2 aparelhos novos (que apareceram depois
//     do aviso) tentando jogar além do limite. O motivo do bloqueio é burla: virar sócio desbloqueia na hora. O dono recebe
//     aviso no celular quando começa uma vigia e quando bloqueia, e desfaz no painel ("Possíveis burlas").
// Travas: nada disso vale para apelido comum (nome muito usado, curto, ou com mais de 12 aparelhos no mês) nem para apelido
// de sócio (se qualquer aparelho com o apelido tem plano valendo, nenhuma regra vale para ele). Sócio nunca tem limite.
// O servidor guarda só o apelido limpo, o código do aparelho e o resumo da rede do dia (que muda todo dia), por 2 dias.
import { diaBR, nomeChave, CHAVE_SQL, aparelhoDesde, anotarBurla } from './planos.js';
import { termoLimpo, termosMudaram } from './bloqueio.js';
import { enviarPush } from './webpush.js';

const DIA = 86400000;
export const VIGIA_DIAS = 7, VIGIA_PERDAO_DIAS = 30, BLOQUEIO_TENTATIVAS = 2, NOMES_COMUNS_MAX = 12;
export const MOTIVO_AUTO = 'burla do limite grátis (vários aparelhos, automático)';
const TIPOS = { publicas: 'limites', partidas: 'limites', offline: 'offline_uso' };
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));

// nomes e palavras que muita gente usa como apelido: ficam fora das regras (dois "Carlos" diferentes nunca dividem limite)
const COMUNS = new Set(`ana maria joao jose antonio francisco carlos paulo pedro lucas luiz luis marcos marco gabriel rafael daniel
  marcelo bruno eduardo felipe raimundo rodrigo manoel manuel nelson roberto fabio fernando jorge andre sergio ricardo alexandre
  mateus matheus gustavo leonardo diego thiago tiago vitor victor joaquim sebastiao miguel arthur artur davi heitor bernardo
  samuel enzo murilo caio igor renato renan julio cesar edson wilson adriano anderson alex alan allan junior neto filho erick
  erik henrique otavio vinicius wesley willian william kevin breno cauan cauã ryan yuri iago italo hugo leandro marcio mauricio
  claudio cleber edvaldo francinaldo raimundinho valdir valter walter moises elias jonas josue isaque isaac abraao davi ruan
  francisca antonia adriana juliana marcia fernanda patricia aline sandra camila amanda bruna jessica leticia julia luciana
  vanessa mariana gabriela larissa beatriz raimunda rita rosa joana sara sarah laura alice clara helena valentina sophia
  sofia isabela isabella manuela lucia luciene rosana regina claudia carla cristina debora denise elaine eliane fatima
  graca ines jaqueline karina katia lais livia luana marta monica natalia priscila rafaela renata roberta silvia simone
  sonia tatiane vera viviane yasmin emanuelly emilly heloisa lorena melissa nicole rebeca thais taina keila kelly rose
  jogador jogadora convidado visitante voce anonimo player domino dominos amigo amiga tio tia vovo mae pai irmao irma
  filha mano mana parceiro parceira mestre rei rainha campeao campea manaus amazonas flamengo vasco corinthians palmeiras
  gremio cruzeiro santos botafogo fluminense nacional baré bare princesa neguinho neguinha nego nega gordo gorda magrao
  baixinho baixinha careca bigode velho velha moleque menino menina garoto garota brother parca parça`
  .split(/\s+/).map(nomeChave).filter(Boolean));
// dois nomes comuns juntos ("anapaula", "joaopedro") também é comum
const doisComuns = n => { for (let i = 3; i <= n.length - 3; i++) if (COMUNS.has(n.slice(0, i)) && COMUNS.has(n.slice(i))) return true; return false; };
export const nomeComum = n => n.length < 4 || COMUNS.has(n) || doisComuns(n);

// o apelido fica fora das regras? (comum, ou é de um sócio). Guardado 1 minuto por apelido.
const LIVRE = new Map();
export function livreMudou(n) { if (n) LIVRE.delete(n); else LIVRE.clear(); }
async function apelidoLivre(env, n) {
  const c = LIVRE.get(n); if (c && Date.now() - c.em < 60000) return c.livre;
  let livre = nomeComum(n);
  if (!livre) {
    const agora = Date.now();
    try {
      const q = await env.DB.prepare(`SELECT COUNT(*) AS n FROM jogadores_vistos WHERE visto_em > ? AND ${CHAVE_SQL} = ?`).bind(agora - 30 * DIA, n).first();
      if (q && q.n > NOMES_COMUNS_MAX) livre = true;
      // sócio com o apelido (o plano pode estar em outro aparelho, como quem pagou no navegador e joga no app)
      if (!livre) livre = !!(await env.DB.prepare('SELECT 1 AS x FROM pessoa_dia d JOIN planos p ON p.aparelho = d.aparelho WHERE d.nome = ? AND p.ate > ? LIMIT 1').bind(n, agora).first());
      if (!livre) livre = !!(await env.DB.prepare(`SELECT 1 AS x FROM jogadores_vistos JOIN planos p ON p.aparelho = jogadores_vistos.aparelho WHERE p.ate > ? AND ${CHAVE_SQL} = ? LIMIT 1`).bind(agora, n).first());
      if (!livre) livre = !!(await env.DB.prepare(`SELECT 1 AS x FROM presenca JOIN planos p ON p.aparelho = presenca.aparelho WHERE p.ate > ? AND ${CHAVE_SQL} = ? LIMIT 1`).bind(agora, n).first());
    } catch (e) { livre = true; }   // banco com problema: não barra ninguém
  }
  LIVRE.set(n, { livre, em: Date.now() }); if (LIVRE.size > 800) LIVRE.clear();
  return livre;
}

// início do dia de Brasília (o dia dos limites)
const inicioDoDia = dia => Date.parse(dia + 'T03:00:00Z');

// o aparelho jogou hoje com este apelido por esta rede
async function anotarPessoa(env, rede, aparelho, n) {
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO pessoa_dia (dia, nome, marca, aparelho, em) VALUES (?, ?, ?, ?, ?)').bind(diaBR(), n, rede || '', aparelho, Date.now()).run();
    if (Math.random() < .03) await env.DB.prepare('DELETE FROM pessoa_dia WHERE dia < ?').bind(diaBR(Date.now() - 2 * DIA)).run();
  } catch (e) {}
}
async function usoDe(env, tipo, aps, dia) {
  if (!aps.length) return 0;
  const q = aps.map(() => '?').join(',');
  const sql = tipo === 'offline' ? `SELECT COALESCE(SUM(n), 0) AS s FROM offline_uso WHERE dia = ? AND aparelho IN (${q})`
    : `SELECT COALESCE(SUM(${tipo}), 0) AS s FROM limites WHERE dia = ? AND aparelho IN (${q})`;
  const r = await env.DB.prepare(sql).bind(dia, ...aps).first();
  return (r && r.s) || 0;
}
async function vigiaDe(env, n) {
  try { return await env.DB.prepare('SELECT * FROM apelidos_vigia WHERE nome = ?').bind(n).first(); } catch (e) { return null; }
}

// Confere o limite da pessoa (regras 1 e 2) para quem não é sócio, depois de o limite do próprio aparelho deixar jogar.
// proprio: as partidas deste aparelho hoje (do tipo); limite: o do tipo. Devolve { barrar, outros, via }: outros = as
// partidas que os outros aparelhos da pessoa já jogaram hoje (a mesa soma ao uso deste, para não passar do limite).
export async function limitePessoa(env, { rede, tipo, aparelho, nome, proprio, limite }) {
  const nada = { barrar: false, outros: 0 };
  if (!TIPOS[tipo] || !idOk(aparelho) || !(limite > 0)) return nada;
  const n = nomeChave(nome); if (!n) return nada;
  try {
    const dia = diaBR();
    await aparelhoDesde(env, aparelho);
    await anotarPessoa(env, rede, aparelho, n);
    if (await apelidoLivre(env, n)) return nada;
    let v = await vigiaDe(env, n);
    if (!(v && v.ate > Date.now())) v = await comecarVigia(env, n, nome, v);
    let aps;
    if (v) aps = (await env.DB.prepare('SELECT DISTINCT aparelho FROM pessoa_dia WHERE dia = ? AND nome = ? AND aparelho <> ? LIMIT 40').bind(dia, n, aparelho).all()).results;
    else if (rede) aps = (await env.DB.prepare('SELECT DISTINCT aparelho FROM pessoa_dia WHERE dia = ? AND nome = ? AND marca = ? AND aparelho <> ? LIMIT 40').bind(dia, n, rede, aparelho).all()).results;
    else return nada;
    const outros = await usoDe(env, tipo, (aps || []).map(r => r.aparelho), dia);
    const via = v ? 'vigia' : 'pessoa';
    if ((proprio || 0) + outros < limite) return { barrar: false, outros, via };
    await anotarBurla(env, tipo, via, aparelho, nome);
    if (v && tipo !== 'offline') await tentativa(env, v, n, aparelho);   // o offline confere ao abrir o app: só divide o limite, não conta para bloqueio
    return { barrar: true, outros, via };
  } catch (e) { return nada; }
}

// Regra 2: o padrão de quem usa vários aparelhos para jogar mais. Começa a vigia (7 dias) e avisa o dono.
async function comecarVigia(env, n, nome, antes) {
  const agora = Date.now();
  if (antes && (antes.perdao || 0) > agora) return null;   // o dono tirou da vigia: não volta por 30 dias
  const dia = diaBR();
  const { results: novos } = await env.DB.prepare('SELECT d.aparelho, d.marca, a.desde FROM pessoa_dia d JOIN aparelhos a ON a.aparelho = d.aparelho WHERE d.dia = ? AND d.nome = ? AND a.desde >= ? LIMIT 60')
    .bind(dia, n, inicioDoDia(dia)).all();
  const lista = novos || [], aps = new Set(lista.map(x => x.aparelho));
  let motivo = null;
  // a) 3 aparelhos novos hoje com o apelido, 2 deles na mesma rede
  if (aps.size >= 3) {
    const porRede = {}; for (const x of lista) if (x.marca) (porRede[x.marca] = porRede[x.marca] || new Set()).add(x.aparelho);
    if (Object.values(porRede).some(s => s.size >= 2)) motivo = `${aps.size} aparelhos novos hoje com o mesmo apelido`;
  }
  // b) aparelho novo hoje que chegou depois de outro aparelho com o mesmo apelido bater o limite hoje
  if (!motivo) {
    const { results: bateram } = await env.DB.prepare('SELECT aparelho, MIN(em) AS em FROM limites_rede WHERE dia = ? AND nome = ? GROUP BY aparelho LIMIT 30').bind(dia, n).all();
    if ((bateram || []).some(b => lista.some(x => x.aparelho !== b.aparelho && x.desde > b.em))) motivo = 'aparelho novo depois de bater o limite grátis em outro';
  }
  if (!motivo) return null;
  const v = { nome: n, apelido: String(nome || '').slice(0, 24), motivo, desde: agora, ate: agora + VIGIA_DIAS * DIA, avisado: null, bloqueado: null, aparelhos: null, perdao: null };
  await env.DB.prepare(`INSERT INTO apelidos_vigia (nome, apelido, motivo, desde, ate, avisado, bloqueado, aparelhos, perdao) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
    ON CONFLICT (nome) DO UPDATE SET apelido = excluded.apelido, motivo = excluded.motivo, desde = excluded.desde, ate = excluded.ate, avisado = NULL, bloqueado = NULL, aparelhos = NULL, perdao = NULL`)
    .bind(n, v.apelido, motivo, v.desde, v.ate).run();
  await env.DB.prepare('DELETE FROM vigia_tentativas WHERE nome = ?').bind(n).run();
  await avisarDono(env, `vigia:${n}:${v.desde}`, '👀 Possível burla do limite grátis', `"${v.apelido}": ${motivo}. Por 7 dias, os aparelhos com esse apelido dividem um limite só, com aviso. Ninguém foi bloqueado.`);
  return v;
}

// Barrado na vigia: a 1ª vez é o aviso; depois dele, cada aparelho NOVO que tenta passar do limite conta. Com 2, bloqueia.
async function tentativa(env, v, n, aparelho) {
  const agora = Date.now();
  if (v.bloqueado) return;
  if (!v.avisado) { await env.DB.prepare('UPDATE apelidos_vigia SET avisado = ? WHERE nome = ? AND avisado IS NULL').bind(agora, n).run(); return; }
  const desde = await aparelhoDesde(env, aparelho);
  if (!(desde > v.avisado)) return;   // aparelho que já existia no aviso: só fica sem partida, não conta
  await env.DB.prepare('INSERT OR IGNORE INTO vigia_tentativas (nome, aparelho, em) VALUES (?, ?, ?)').bind(n, aparelho, agora).run();
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM vigia_tentativas WHERE nome = ? AND em >= ?').bind(n, v.avisado).first();
  if (c && c.n >= BLOQUEIO_TENTATIVAS) await bloquearVigia(env, v, n);
}
async function bloquearVigia(env, v, n) {
  const agora = Date.now();
  const r1 = (await env.DB.prepare('SELECT DISTINCT aparelho FROM pessoa_dia WHERE nome = ?').bind(n).all()).results || [];
  const r2 = (await env.DB.prepare(`SELECT aparelho FROM jogadores_vistos WHERE visto_em > ? AND ${CHAVE_SQL} = ?`).bind(agora - VIGIA_DIAS * DIA, n).all()).results || [];
  const r3 = (await env.DB.prepare('SELECT aparelho FROM vigia_tentativas WHERE nome = ?').bind(n).all()).results || [];
  let aps = [...new Set([...r1, ...r2, ...r3].map(r => r.aparelho).filter(idOk))].slice(0, 40);
  if (aps.length) {
    const { results: socios } = await env.DB.prepare(`SELECT aparelho FROM planos WHERE ate > ? AND aparelho IN (${aps.map(() => '?').join(',')})`).bind(agora, ...aps).all();
    if ((socios || []).length) { livreMudou(n); return; }   // virou sócio no meio: nada de bloqueio
  }
  const st = env.DB.prepare('INSERT INTO bloqueios (aparelho, nome, motivo, em) VALUES (?, ?, ?, ?) ON CONFLICT (aparelho) DO NOTHING');
  if (aps.length) await env.DB.batch(aps.map(ap => st.bind(ap, v.apelido.slice(0, 16), MOTIVO_AUTO, agora)));
  const t = termoLimpo(v.apelido);
  if (t.length >= 4) { await env.DB.prepare('INSERT OR IGNORE INTO apelidos_bloqueados (termo, parte, motivo, em) VALUES (?, 0, ?, ?)').bind(t, 'automático (vários aparelhos)', agora).run(); termosMudaram(); }
  await env.DB.prepare('UPDATE apelidos_vigia SET bloqueado = ?, aparelhos = ? WHERE nome = ?').bind(agora, JSON.stringify(aps), n).run();
  await avisarDono(env, `vigia-bloq:${n}:${v.desde}`, '🚫 Bloqueio automático', `"${v.apelido}": continuou com aparelhos novos depois do aviso (${aps.length} ${aps.length === 1 ? 'aparelho' : 'aparelhos'}). Se virar sócio, desbloqueia. Se foi engano, desfaça no painel.`);
}

// Aviso no celular do dono (os aparelhos dele ficam em dono_aparelhos), uma vez por chave
export async function avisarDono(env, chave, titulo, texto, url) {   // 13/11: exportado (relatório e alertas) e com o endereço
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return;
  try {
    const { results: ds } = await env.DB.prepare('SELECT aparelho FROM dono_aparelhos').all();
    const aps = (ds || []).map(x => x.aparelho).filter(idOk); if (!aps.length) return;
    const { results } = await env.DB.prepare(`SELECT DISTINCT a.id, a.endpoint, a.p256dh, a.auth FROM avisos a JOIN avisos_id i ON i.endpoint = a.endpoint
      WHERE i.aparelho IN (${aps.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM avisos_ev e WHERE e.aviso = a.id AND e.chave = ?) LIMIT 10`).bind(...aps, chave).all();
    const vistos = new Set(), lista = (results || []).filter(x => !vistos.has(x.id) && vistos.add(x.id));
    if (!lista.length) return;
    const st = env.DB.prepare('INSERT OR IGNORE INTO avisos_ev (aviso, chave, em) VALUES (?, ?, ?)');
    await env.DB.batch(lista.map(x => st.bind(x.id, chave, Date.now())));
    for (const s of lista) {
      let r = 0; try { r = await enviarPush(s, { titulo, texto, url: url || '/?abrir=dono' }, env); } catch (e) {}
      if (r === 404 || r === 410) { try { await env.DB.prepare('DELETE FROM avisos WHERE id = ?').bind(s.id).run(); await env.DB.prepare('DELETE FROM avisos_id WHERE endpoint = ?').bind(s.endpoint).run(); } catch (e) {} }
    }
  } catch (e) {}
}

// Painel do dono: os apelidos em vigia (e os que saíram nos últimos 7 dias), sem código de aparelho
export async function vigiados(env) {
  try {
    const agora = Date.now();
    const { results } = await env.DB.prepare(`SELECT v.nome, v.apelido, v.motivo, v.desde, v.ate, v.avisado, v.bloqueado, v.perdao, v.aparelhos,
        (SELECT COUNT(*) FROM vigia_tentativas t WHERE t.nome = v.nome) AS tentativas,
        (SELECT COUNT(DISTINCT aparelho) FROM pessoa_dia d WHERE d.nome = v.nome) AS aparelhos_2d
      FROM apelidos_vigia v WHERE v.ate > ? ORDER BY v.desde DESC LIMIT 60`).bind(agora - VIGIA_DIAS * DIA).all();
    return (results || []).map(r => {
      let bloq = 0; try { bloq = r.aparelhos ? JSON.parse(r.aparelhos).length : 0; } catch (e) {}
      return { nome: r.nome, apelido: r.apelido, motivo: r.motivo, desde: r.desde, ate: r.ate, avisado: r.avisado || null, bloqueado: r.bloqueado || null,
        tirado: !!(r.perdao && r.perdao > agora), ativo: r.ate > agora, tentativas: r.tentativas || 0, aparelhos: Math.max(r.aparelhos_2d || 0, bloq), bloqueados: bloq };
    });
  } catch (e) { return []; }
}
// POST /dono/vigia/tirar { nome }: o dono achou que foi engano. Sai da vigia (e não volta por 30 dias); se tinha bloqueado,
// desbloqueia os aparelhos (os do bloqueio automático e os que caíram depois pelo apelido) e tira o apelido da lista.
export async function donoVigiaTirar(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  const n = nomeChave(b && b.nome); if (!n) return h.json({ erro: 'dados' }, 400, origin);
  const v = await vigiaDe(env, n); if (!v) return h.json({ erro: 'nao-existe' }, 404, origin);
  const agora = Date.now();
  let soltos = 0;
  if (v.bloqueado) {
    let aps = []; try { aps = JSON.parse(v.aparelhos || '[]').filter(idOk); } catch (e) {}
    if (aps.length) {
      const r = await env.DB.prepare(`DELETE FROM bloqueios WHERE motivo = ? AND aparelho IN (${aps.map(() => '?').join(',')})`).bind(MOTIVO_AUTO, ...aps).run();
      soltos += (r && r.meta && r.meta.changes) || 0;
    }
    // quem caiu depois pelo apelido bloqueado (abriu o app com outro aparelho): só os desse apelido, desde o bloqueio
    const { results: depois } = await env.DB.prepare("SELECT aparelho, nome FROM bloqueios WHERE motivo LIKE 'voltou com outro aparelho%' AND em >= ?").bind(v.bloqueado).all();
    const ids = (depois || []).filter(x => nomeChave(x.nome) === n).map(x => x.aparelho);
    for (const ap of ids) { await env.DB.prepare('DELETE FROM bloqueios WHERE aparelho = ?').bind(ap).run(); soltos++; }
    const t = termoLimpo(v.apelido);
    if (t) { await env.DB.prepare("DELETE FROM apelidos_bloqueados WHERE parte = 0 AND termo = ? AND motivo LIKE 'automático%'").bind(t).run(); termosMudaram(); }
  }
  await env.DB.prepare('UPDATE apelidos_vigia SET ate = ?, perdao = ?, bloqueado = NULL WHERE nome = ?').bind(agora, agora + VIGIA_PERDAO_DIAS * DIA, n).run();
  await env.DB.prepare('DELETE FROM vigia_tentativas WHERE nome = ?').bind(n).run();
  livreMudou(n);
  return h.json({ ok: true, soltos }, 200, origin);
}
