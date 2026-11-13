// 13/11 (pedido do dono: "IA que se retroalimenta"): treino do robô da turma do bairro, toda noite (robo-treino.yml).
// Como funciona:
//   1. Parte dos pesos do robô em uso (o servidor guarda em robo_pesos; sem nenhum, o PESOS_BASE do motor).
//   2. Cria variações (cada peso muda um pouco, para mais ou para menos, dentro de limites seguros).
//   3. Cada variação joga contra o robô em uso nas MESMAS mãos, duas vezes, trocando os lados (assim a sorte das pedras
//      se anula): vale a diferença de pontos por mão.
//   4. A melhor só passa se ganhar com folga (média de pelo menos meio ponto por mão e z >= 3) e depois confirmar numa
//      rodada nova, com mãos que ela nunca viu (z >= 2,5), e também não perder do robô original (PESOS_BASE).
// O que NÃO muda: o robô parceiro não mata a pedra de gente (regra do dono, fixa no motor) e o "acaso" de cada jogada.
// Sai um JSON com o resultado (só números, nada de jogador). Uso: node treinar.mjs '<pesos atuais em JSON ou vazio>'
import { newGame, startHand, legalMoves, applyMove, applyPass, botChoose, pedirPonto, TEAM, PESOS_BASE } from '../src/motor.js';

const LIMITES = { carroca: [0, 12], pontos: [0, 1.2], trava: [0.2, 1.6], fecha: [2, 40], fechaUma: [0, 8], travaParceiro: [0, 18], risco: [0.1, 1.2], liga: [0, 5] };
const CANDIDATOS = Number(process.env.CANDIDATOS || 10), PARES = Number(process.env.PARES || 12000), CONFIRMA = Number(process.env.CONFIRMA || 30000);
// 13/11: uma mão varia muito (desvio de ~27 pontos por par); com 12 mil pares, meio ponto por mão já aparece com z ~ 3
const MINIMO = 0.5, Z_TESTE = 3, Z_CONFIRMA = 2.5;

function valida(w) {
  const out = {};
  for (const k of Object.keys(PESOS_BASE)) {
    const v = Number(w && w[k]); const [a, b] = LIMITES[k];
    out[k] = Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : PESOS_BASE[k];
  }
  return out;
}
const clone = o => JSON.parse(JSON.stringify(o));
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function variar(w, forca) {
  const n = {};
  for (const k of Object.keys(w)) {
    const [a, b] = LIMITES[k];
    n[k] = Math.random() < 0.6 ? Math.min(b, Math.max(a, +(w[k] * Math.exp(gauss() * forca) + gauss() * 0.02 * (b - a)).toFixed(3))) : w[k];
  }
  return n;
}
// uma mão, do mesmo começo, com o time 0 usando W0 e o time 1 usando W1: diferença de pontos (time 0 menos time 1)
function mao(inicio, W0, W1) {
  const st = clone(inicio), a = st.score.slice();
  for (let g = 0; g < 300 && st.phase === 'play'; g++) {
    const q = st.turn, W = TEAM(q) === 0 ? W0 : W1;
    if (legalMoves(st, q).length) { applyMove(st, q, botChoose(st, q, Math.random, W)); if (st.pedido) pedirPonto(st, q, true); }
    else applyPass(st, q);
  }
  return (st.score[0] - a[0]) - (st.score[1] - a[1]);
}
// n pares de mãos: o candidato joga uma vez de cada lado na mesma mão; devolve média e z da vantagem do candidato
function duelo(cand, atual, n) {
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const st = newGame(); startHand(st);
    const d = (mao(st, cand, atual) - mao(st, atual, cand)) / 2;
    s += d; s2 += d * d;
  }
  const m = s / n, dp = Math.sqrt(Math.max(1e-9, s2 / n - m * m));
  return { media: +m.toFixed(3), z: +(m / (dp / Math.sqrt(n))).toFixed(2), pares: n };
}

const t0 = Date.now();
let atual; try { atual = valida(JSON.parse(process.argv[2] || 'null') || PESOS_BASE); } catch (e) { atual = valida(PESOS_BASE); }
const testados = [];
for (let i = 0; i < CANDIDATOS; i++) {
  const c = variar(atual, i < CANDIDATOS / 2 ? 0.15 : 0.35);
  testados.push({ pesos: c, ...duelo(c, atual, PARES) });
}
testados.sort((x, y) => y.media - x.media);
const melhor = testados[0];
let resultado = { mudou: false, motivo: '', atual, melhor: melhor.pesos, teste: { media: melhor.media, z: melhor.z, pares: melhor.pares } };
if (melhor.media >= MINIMO && melhor.z >= Z_TESTE) {
  const conf = duelo(melhor.pesos, atual, CONFIRMA), base = duelo(melhor.pesos, valida(PESOS_BASE), PARES);
  resultado.confirmacao = conf; resultado.contraOriginal = base;
  if (conf.media >= MINIMO * 0.6 && conf.z >= Z_CONFIRMA && base.media >= 0) { resultado.mudou = true; resultado.motivo = 'ganhou e confirmou'; }
  else resultado.motivo = 'não confirmou numa rodada nova';
} else resultado.motivo = 'nenhuma variação ganhou com folga';
resultado.candidatos = testados.map(x => ({ media: x.media, z: x.z }));
resultado.segundos = Math.round((Date.now() - t0) / 1000);
console.log(JSON.stringify(resultado));
