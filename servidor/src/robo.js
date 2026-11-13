// 13/11 (pedido do dono: robô que aprende sozinho). Os pesos treinados toda noite (servidor/treino/treinar.mjs, pelo
// robo-treino.yml) ficam em robo_pesos; o servidor usa a versão ativa mais nova nos robôs das mesas online. O jogo offline
// continua com o robô de sempre (quem está começando aprende sem apanhar) e com o robô forte do nível 5 em diante.
// O dono vê o histórico no painel e pode voltar para o robô anterior com um toque.
import { PESOS_BASE } from './motor.js';

const LIMITES = { carroca: [0, 12], pontos: [0, 1.2], trava: [0.2, 1.6], fecha: [2, 40], fechaUma: [0, 8], travaParceiro: [0, 18], risco: [0.1, 1.2], liga: [0, 5] };
function valida(w) {
  if (!w || typeof w !== 'object') return null;
  const out = {};
  for (const k of Object.keys(PESOS_BASE)) {
    const v = Number(w[k]), [a, b] = LIMITES[k];
    if (!Number.isFinite(v) || v < a || v > b) return null;   // qualquer peso fora do lugar: usa o robô de sempre
    out[k] = v;
  }
  return out;
}
let cache = { em: 0, pesos: null, versao: 0 };
// os pesos em uso (guardados por 10 minutos em cada servidor); sem nenhum treinado, ou com erro, o robô de sempre
export async function pesosRobo(env) {
  if (Date.now() - cache.em < 600000) return cache.pesos || PESOS_BASE;
  cache.em = Date.now();
  try {
    const r = await env.DB.prepare('SELECT versao, pesos FROM robo_pesos WHERE ativo = 1 ORDER BY versao DESC LIMIT 1').first();
    const w = r ? valida(JSON.parse(r.pesos)) : null;
    cache.pesos = w; cache.versao = w ? r.versao : 0;
  } catch (e) { cache.pesos = null; cache.versao = 0; }
  return cache.pesos || PESOS_BASE;
}
// GET /dono/robo: a versão em uso, as anteriores e os últimos treinos (só números)
export async function donoRobo(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const todos = async (q) => { try { return (await env.DB.prepare(q).all()).results || []; } catch (e) { return []; } };
  const versoes = await todos('SELECT versao, ganho, z, pares, em, ativo FROM robo_pesos ORDER BY versao DESC LIMIT 10');
  const treinos = await todos('SELECT em, mudou, motivo, media, z, segundos FROM robo_treinos ORDER BY em DESC LIMIT 7');
  const ativa = versoes.find(v => v.ativo) || null;
  return h.json({ ativa, versoes, treinos }, 200, origin);
}
// POST /dono/robo/voltar: desliga a versão em uso (volta para a anterior; sem anterior, para o robô de sempre)
export async function donoRoboVoltar(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const r = await env.DB.prepare('SELECT versao FROM robo_pesos WHERE ativo = 1 ORDER BY versao DESC LIMIT 1').first();
  if (!r) return h.json({ ok: true, versao: 0 }, 200, origin);
  await env.DB.prepare('UPDATE robo_pesos SET ativo = 0 WHERE versao = ?').bind(r.versao).run();
  cache.em = 0;
  const n = await env.DB.prepare('SELECT versao FROM robo_pesos WHERE ativo = 1 ORDER BY versao DESC LIMIT 1').first();
  return h.json({ ok: true, versao: (n && n.versao) || 0 }, 200, origin);
}
