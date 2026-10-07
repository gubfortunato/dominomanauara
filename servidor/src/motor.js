// GERADO pelo build.py a partir do jogo (não editar aqui): regras, robô, filtro de nomes e nomes da turma.
// ===== ENGINE START =====
const TEAM = p => p % 2;            // time 0 = cadeiras 0 e 2, time 1 = cadeiras 1 e 3
const TARGET = 200;
const isDbl = t => t[0] === t[1];
const pips = t => t[0] + t[1];
const tkey = t => Math.min(t[0], t[1]) + '-' + Math.max(t[0], t[1]);

function fullSet() { const s = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) s.push([a, b]); return s; }
function shuffle(arr, rnd) { rnd = rnd || Math.random; for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

function newGame(names) {
  return { names: (names || ['Jogador 1', 'Jogador 2', 'Jogador 3', 'Jogador 4']).slice(),
    score: [0, 0], series: [0, 0], partida: 1, handNo: 0, nextStart: { mode: 'sena' },
    hands: [[], [], [], []], chain: [], center: 0, bucho: { U: [], D: [] }, turn: 0, phase: 'idle', openMode: null,
    passStreak: [], lastPlayer: null, lastKey: null, lacks: [[], [], [], []], events: [], result: null };
}
function addScore(st, team, pts) { st.score[team] += pts; }

// Soma das pontas: carroça na ponta conta dobrado; a pedra de saída sozinha conta a soma dela.
function endsSum(chain) {
  if (!chain.length) return 0;
  if (chain.length === 1) return chain[0].a + chain[0].b;
  const f = chain[0], l = chain[chain.length - 1];
  return (f.a === f.b ? 2 * f.a : f.a) + (l.a === l.b ? 2 * l.b : l.b);
}
function tablePoints(chain) { const s = endsSum(chain); return s > 0 && s % 5 === 0 ? s : 0; }
// Soma da mesa: as duas pontas + cada lado do bucho que já recebeu pedra (carroça na ponta conta dobrado).
function tableSum(T) {
  let s = endsSum(T.chain);
  if (T.chain.length && buchoOpen(T)) for (const k of ['U', 'D']) {
    const arr = (T.bucho && T.bucho[k]) || [];
    if (arr.length) { const t = arr[arr.length - 1]; s += t.n === t.f ? 2 * t.f : t.f; }
  }
  return s;
}
function tableScore(T) { const s = tableSum(T); return s > 0 && s % 5 === 0 ? s : 0; }

// ---- Bucho: a carroça de saída abre os dois lados depois que as duas pontas dela têm pedra ----
function buchoOpen(st) {
  if (!st.chain.length) return false;
  const c = st.chain[st.center];
  return c.a === c.b && st.center > 0 && st.center < st.chain.length - 1;
}
function buchoEnd(st, k) {
  const arr = (st.bucho && st.bucho[k]) || [];
  return arr.length ? arr[arr.length - 1].f : st.chain[st.center].a;
}
function openEnds(st) {
  if (!st.chain.length) return [];
  const out = [{ side: 'L', v: st.chain[0].a }, { side: 'R', v: st.chain[st.chain.length - 1].b }];
  if (buchoOpen(st)) { out.push({ side: 'U', v: buchoEnd(st, 'U') }); out.push({ side: 'D', v: buchoEnd(st, 'D') }); }
  return out;
}
function tableTiles(st) {
  const out = st.chain.map(c => [c.a, c.b]);
  const b = st.bucho || {};
  for (const k of ['U', 'D']) for (const x of (b[k] || [])) out.push([x.n, x.f]);
  return out;
}
function cloneT(st) {
  const b = st.bucho || {};
  return { chain: st.chain.map(c => ({ a: c.a, b: c.b })), center: st.center,
    bucho: { U: (b.U || []).map(x => ({ n: x.n, f: x.f })), D: (b.D || []).map(x => ({ n: x.n, f: x.f })) } };
}
// Ninguém joga mais quando todas as pedras de cada número aberto já estão na mesa.
function lockedTable(st) {
  const tiles = tableTiles(st);
  return openEnds(st).every(e => tiles.filter(t => t[0] === e.v || t[1] === e.v).length === 7);
}

function legalMoves(st, p) {
  const h = st.hands[p], out = [];
  if (!h) return out;
  if (!st.chain.length) {
    if (p !== st.turn) return out;
    h.forEach((t, i) => {
      if (st.openMode === 'sena' && !(t[0] === 6 && t[1] === 6)) return;
      if (st.openMode === 'carroca' && !isDbl(t)) return;
      out.push({ i, side: 'C' });
    });
    return out;
  }
  const ends = openEnds(st);
  h.forEach((t, i) => {
    for (const e of ends) if (t[0] === e.v || t[1] === e.v) out.push({ i, side: e.side });
  });
  return out;
}

function place(st, t, side) {
  if (side === 'C') { st.chain = [{ a: t[0], b: t[1] }]; st.center = 0; st.bucho = { U: [], D: [] }; return; }
  if (side === 'U' || side === 'D') {
    if (!st.bucho) st.bucho = { U: [], D: [] };
    const e = buchoEnd(st, side);
    st.bucho[side].push({ n: e, f: t[0] === e ? t[1] : t[0] });
    return;
  }
  if (side === 'L') {
    const L = st.chain[0].a;
    st.chain.unshift(t[1] === L ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] });
    st.center++;
  } else {
    const R = st.chain[st.chain.length - 1].b;
    st.chain.push(t[0] === R ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] });
  }
}

function startHand(st) {
  st.handNo++;
  let redeals = 0, hands;
  for (;;) {
    const d = shuffle(fullSet());
    hands = [d.slice(0, 7), d.slice(7, 14), d.slice(14, 21), d.slice(21, 28)];
    if (hands.some(h => h.filter(isDbl).length >= 5)) { redeals++; continue; }
    break;
  }
  hands.forEach(h => h.sort((x, y) => x[0] - y[0] || x[1] - y[1]));
  Object.assign(st, { hands, chain: [], center: 0, bucho: { U: [], D: [] }, passStreak: [], lastPlayer: null, lastKey: null,
    lacks: [[], [], [], []], result: null, phase: 'play', events: [] });
  if (redeals) st.events.push({ type: 'redeal', n: redeals });
  const ns = st.nextStart;
  if (ns.mode === 'sena') {
    st.turn = hands.findIndex(h => h.some(t => t[0] === 6 && t[1] === 6));
    st.openMode = 'sena';
    st.events.push({ type: 'start', p: st.turn, mode: 'sena' });
  } else {
    const b = ns.player;
    if (hands[b].some(isDbl)) { st.turn = b; st.openMode = 'carroca'; st.events.push({ type: 'start', p: b, mode: 'carroca' }); }
    else {
      const team = 1 - TEAM(b);
      addScore(st, team, 20);
      st.events.push({ type: 'semCarroca', p: b, team, pts: 20 });
      st.turn = (b + 1) % 4; st.openMode = 'livre';
      st.events.push({ type: 'start', p: st.turn, mode: 'livre' });
    }
  }
}

function anyoneCanPlay(st) { for (let q = 0; q < 4; q++) if (legalMoves(st, q).length) return true; return false; }

function applyMove(st, p, mv) {
  st.events = [];
  const t = st.hands[p].splice(mv.i, 1)[0];
  place(st, t, mv.side);
  st.passStreak = []; st.lastPlayer = p; st.lastKey = tkey(t); st.openMode = null;
  const pts = tableScore(st);   // soma das 4 pontas (bucho incluído)
  if (pts) addScore(st, TEAM(p), pts);
  st.events.push({ type: 'play', p, t, pts, team: TEAM(p), side: mv.side });
  if (!st.hands[p].length) {
    const carroca = isDbl(t);
    if (carroca) addScore(st, TEAM(p), 20);
    st.events.push({ type: 'batida', p, carroca, team: TEAM(p), pts: carroca ? 20 : 0 });
    // Garagem: os pontos que sobraram na mão da dupla que não bateu vão para a dupla que bateu
    // (arredondados para baixo no múltiplo de 5, como no jogo fechado).
    const opp = 1 - TEAM(p);
    const gSum = st.hands.reduce((s, h, q) => TEAM(q) === opp ? s + h.reduce((a, x) => a + pips(x), 0) : s, 0);
    const garagem = Math.floor(gSum / 5) * 5;
    if (garagem) addScore(st, TEAM(p), garagem);
    st.events.push({ type: 'garagem', p, team: TEAM(p), sum: gSum, pts: garagem });
    endHand(st, { kind: 'batida', p, carroca, lastPts: pts, garagem, garagemSum: gSum });
    return;
  }
  if (!anyoneCanPlay(st)) { closeHand(st, p); return; }
  st.turn = (p + 1) % 4;
}

function applyPass(st, p) {
  st.events = [];
  for (const e of openEnds(st)) if (!st.lacks[p].includes(e.v)) st.lacks[p].push(e.v);
  // O passe vale 20 para a dupla de quem jogou por último. Se quem passa é parceiro de quem jogou, ninguém marca.
  const lp = st.lastPlayer, team = TEAM(lp);
  const pts = TEAM(p) !== team ? 20 : 0;
  if (pts) addScore(st, team, pts);
  st.passStreak.push({ team, pts, p });
  if (st.passStreak.length >= 3) {
    // Passe geral (galo): os três passaram e a vez volta para quem jogou.
    for (const e of st.passStreak) addScore(st, e.team, -e.pts);
    const ap = st.lastPlayer;
    addScore(st, TEAM(ap), 50);
    st.events.push({ type: 'pass', p, team, pts, voided: true });
    st.events.push({ type: 'galo', p: ap, team: TEAM(ap), pts: 50 });
    st.passStreak = [];
  } else st.events.push({ type: 'pass', p, team, pts });
  st.turn = (p + 1) % 4;
}

function closeHand(st, p) {
  const sums = [0, 0];
  st.hands.forEach((h, q) => { sums[TEAM(q)] += h.reduce((s, t) => s + pips(t), 0); });
  let team = null, pts = 0, hi = null;
  if (sums[0] !== sums[1]) {
    hi = sums[0] > sums[1] ? 0 : 1; team = 1 - hi;
    pts = Math.floor(sums[hi] / 5) * 5;
    if (pts) addScore(st, team, pts);
  }
  st.events.push({ type: 'fechado', p, sums, team, pts });
  endHand(st, { kind: 'fechado', p, sums, team, hi, pts });
}

function endHand(st, info) {
  st.phase = 'handEnd';
  // Depois de batida, a próxima mão sai com quem bateu, com qualquer carroça. Depois de jogo fechado, sai quem tem a carroça de sena
  // (Regulamento de Dominó dos Jogos dos Servidores, Prefeitura de Manaus 2026, art. 5º, § 4º).
  st.nextStart = info.kind === 'fechado' ? { mode: 'sena' } : { mode: 'carroca', player: info.p };
  const r = Object.assign({}, info, { hands: st.hands.map(h => h.map(t => t.slice())), score: st.score.slice(),
    handNo: st.handNo, partida: st.partida });
  const [a, b] = st.score;
  if (Math.max(a, b) >= TARGET && a !== b) {
    const w = a > b ? 0 : 1;
    st.series[w]++; r.matchWinner = w; r.series = st.series.slice();
    if (st.series[w] >= 2) r.gameWinner = w;
  }
  st.result = r;
}

function nextHand(st) {
  const r = st.result;
  if (r && r.matchWinner != null) {
    // Jogo novo começa com a carroça de sena; partida nova segue com quem jogou a última pedra.
    if (r.gameWinner != null) { const fresh = newGame(st.names); Object.keys(st).forEach(k => delete st[k]); Object.assign(st, fresh); }
    else { st.partida++; st.score = [0, 0]; st.handNo = 0; }
  }
  startHand(st);
}

// Robô (o mesmo para todos): pontos na mesa, provocar passe, evitar dar ponto, não trancar com a mão pesada.
function botChoose(st, p, rnd) {
  rnd = rnd || Math.random;
  const moves = legalMoves(st, p);
  if (moves.length === 1) return moves[0];
  const hand = st.hands[p];
  const seen = new Set(hand.map(tkey));
  tableTiles(st).forEach(t => seen.add(tkey(t)));
  const unseen = fullSet().filter(t => !seen.has(tkey(t)));
  const avg = unseen.length ? unseen.reduce((s, t) => s + pips(t), 0) / unseen.length : 0;
  const opp = (p + 1) % 4, partner = (p + 2) % 4, opp2 = (p + 3) % 4;
  const oppL = st.lacks[opp], parL = st.lacks[partner];
  let best = moves[0], bestV = -Infinity;
  for (const mv of moves) {
    const t = hand[mv.i];
    const sim = cloneT(st);
    place(sim, t, mv.side);
    const pts = tableScore(sim);
    const rest = hand.filter((_, j) => j !== mv.i);
    let v = pts;
    if (!rest.length) v += 300 + (isDbl(t) ? 20 : 0);
    if (isDbl(t)) v += 4;
    v += pips(t) * 0.35;
    const ends = openEnds(sim).map(e => e.v);
    if (rest.length && lockedTable(sim)) {
      const ours = rest.reduce((s, x) => s + pips(x), 0) + avg * st.hands[partner].length;
      const theirs = avg * (st.hands[opp].length + st.hands[opp2].length);
      v += ours < theirs ? 0.8 * Math.floor(theirs / 5) * 5 : -0.8 * Math.floor(ours / 5) * 5;
    } else if (rest.length) {
      const blocked = ends.every(e => oppL.includes(e));
      if (blocked) v += 14; else if (ends.some(e => oppL.includes(e))) v += 2;
      if (ends.every(e => parL.includes(e))) v -= 6;
      if (!blocked) {
        const simEnds = openEnds(sim);
        let risk = 0;
        for (const u of unseen) {
          if (oppL.includes(u[0]) || oppL.includes(u[1])) continue;
          for (const e of simEnds) {
            if (u[0] !== e.v && u[1] !== e.v) continue;
            const s2 = cloneT(sim);
            place(s2, u, e.side);
            risk = Math.max(risk, tableScore(s2));
          }
        }
        v -= risk * 0.45;
      }
      v += rest.filter(x => ends.some(e => x[0] === e || x[1] === e)).length * 1.5;
    }
    v += (rnd() - 0.5) * 2;
    if (v > bestV) { bestV = v; best = mv; }
  }
  return best;
}

// Mesa: com carroça de saída, cada braço ocupa um quadrante (cata-vento) — ponta direita desce pela direita,
// ponta esquerda sobe pela esquerda, bucho de baixo vai para a esquerda e bucho de cima para a direita.
// Sem carroça no centro, as duas pontas usam a largura toda.
function layoutTable(T, Xmax) {
  const chain = T.chain, center = T.center, bu = T.bucho || {};
  const res = { main: new Array(chain.length), U: [], D: [] };
  if (!chain.length) return res;
  const c = chain[center];
  const right = [], left = [];
  for (let i = center + 1; i < chain.length; i++) right.push({ idx: i, near: chain[i].a, far: chain[i].b });
  for (let i = center - 1; i >= 0; i--) left.push({ idx: i, near: chain[i].b, far: chain[i].a });
  const toMain = (t, p) => { res.main[t.idx] = p; };
  if (c.a === c.b) {
    res.main[center] = { x: 0, y: 0, o: 'v', v1: c.a, v2: c.b };
    armLayout(right, { x: 0.5, y: 0, dir: 1, vdir: 1, lo: 2, hi: Xmax }, toMain);
    armLayout(left, { x: -0.5, y: 0, dir: -1, vdir: -1, lo: -Xmax, hi: -2 }, toMain);
    const asArm = arr => (arr || []).map(t => ({ near: t.n, far: t.f }));
    armLayout(asArm(bu.D), { mode: 'col', colX: 0, colEnd: 1, dir: 1, vdir: 1, lo: -Xmax, hi: -0.5, firstNeed: 3 }, (t, p) => res.D.push(p));
    armLayout(asArm(bu.U), { mode: 'col', colX: 0, colEnd: -1, dir: -1, vdir: -1, lo: 0.5, hi: Xmax, firstNeed: 3 }, (t, p) => res.U.push(p));
  } else {
    res.main[center] = { x: 0, y: 0, o: 'h', v1: c.a, v2: c.b };
    armLayout(right, { x: 1, y: 0, dir: 1, vdir: 1, lo: -Xmax, hi: Xmax }, toMain);
    armLayout(left, { x: -1, y: 0, dir: -1, vdir: -1, lo: -Xmax, hi: Xmax }, toMain);
  }
  return res;
}
function layoutChain(chain, center, Xmax) { return layoutTable({ chain, center }, Xmax).main; }
// Carroça sempre atravessada e centrada na pedra em que encaixou; a linha segue reto do outro lado dela.
// Se a fileira acaba logo depois de uma carroça, a linha desce (ou sobe) a partir da ponta da carroça.
function armLayout(tiles, o, put) {
  let x = o.x || 0, y = o.y || 0, dir = o.dir, mode = o.mode || 'row', colX = o.colX || 0, colEnd = o.colEnd || 0, rows = 0;
  let lastDbl = null, colAfterDbl = false;
  const vdir = o.vdir, lo = o.lo, hi = o.hi, eps = 1e-9;
  const out = v => v > hi + eps || v < lo - eps;
  for (const t of tiles) {
    const dbl = t.near === t.far;
    const vert = () => ({ v1: vdir > 0 ? t.near : t.far, v2: vdir > 0 ? t.far : t.near });
    if (mode === 'row') {
      if (dbl) {
        // carroça em pé (atravessada na fileira), centrada na pedra anterior — mesmo no fim da fileira
        put(t, { x: x + dir * 0.5, y, o: 'v', v1: t.near, v2: t.far });
        lastDbl = { x: x + dir * 0.5, y }; x += dir; continue;
      }
      if (!out(x + dir * 2)) {
        put(t, { x: x + dir, y, o: 'h', v1: dir > 0 ? t.near : t.far, v2: dir > 0 ? t.far : t.near });
        lastDbl = null; x += dir * 2; continue;
      }
      // a fileira acabou: vira para a coluna
      if (lastDbl) { colX = lastDbl.x; colEnd = y + vdir * 1; mode = 'col'; colAfterDbl = true; lastDbl = null; }
      else {
        const cx = x + dir * 0.5;
        put(t, Object.assign({ x: cx, y: y + vdir * 0.5, o: 'v' }, vert()));
        colX = cx; colEnd = y + vdir * 1.5; mode = 'col'; colAfterDbl = false; continue;
      }
    }
    // coluna
    if (dbl) {
      // carroça deitada (atravessada na coluna), centrada na pedra anterior
      put(t, { x: colX, y: colEnd + vdir * 0.5, o: 'h', v1: t.near, v2: t.far });
      colEnd += vdir; colAfterDbl = true; continue;
    }
    const need = rows === 0 && o.firstNeed ? o.firstNeed : Math.abs(y) + 2;
    const ny = colEnd + vdir * 0.5;
    if (Math.abs(ny) < need - eps || colAfterDbl) {
      put(t, Object.assign({ x: colX, y: colEnd + vdir, o: 'v' }, vert()));
      colEnd += vdir * 2; colAfterDbl = false; continue;
    }
    dir = -dir;
    put(t, { x: colX + dir * 0.5, y: ny, o: 'h', v1: dir > 0 ? t.near : t.far, v2: dir > 0 ? t.far : t.near });
    x = colX + dir * 1.5; y = ny; mode = 'row'; rows++; lastDbl = null;
  }
}

const NOME_RUIM_PARTE = ['porra', 'caralh', 'buceta', 'boceta', 'xoxota', 'xereca', 'piroca', 'punheta', 'siririca', 'arrombad',
  'filhodaputa', 'fdp', 'fodase', 'fodido', 'fudido', 'foder', 'putaria', 'vagabund', 'cuzao', 'cusao', 'vadia', 'prostitut',
  'traveco', 'retardad', 'nazista', 'hitler', 'estupr', 'pedofil', 'viadinho', 'porno', 'merda', 'bosta', 'cacete', 'pqp',
  'tomarnocu', 'paunocu', 'vaitomar', 'safad', 'piranh'];
// Curtas: só barram como palavra separada (para não pegar "Cunha" ou "Disputa").
const NOME_RUIM_PALAVRA = ['cu', 'puta', 'putas', 'puto', 'foda', 'fode', 'rola', 'xota', 'viado', 'veado', 'bicha', 'sapatao',
  'crioulo', 'corno', 'otario', 'babaca', 'anus', 'penis', 'vagina', 'kct', 'vsf', 'tnc', 'fdps'];
function nomeOfensivo(nome) {
  const junta = s => s.replace(/(.)\1+/g, '$1');
  const leet = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };
  const base = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[0134578@$!]/g, c => leet[c]);
  const tudo = base.replace(/[^a-z]/g, ''), tudoJ = junta(tudo);
  if (NOME_RUIM_PARTE.some(w => tudo.includes(w) || tudoJ.includes(junta(w)))) return true;
  const palavras = base.split(/[^a-z]+/).filter(Boolean);
  return NOME_RUIM_PALAVRA.some(w => tudo === w || tudoJ === junta(w) || palavras.some(p => p === w || junta(p) === junta(w)));
}
const BOT_NAMES = ["Seu Raimundo", "Nonato", "Dona Socorro", "Tonhão", "Chiquinho", "Dona Graça", "Mundico", "Dona Nazaré", "Seu Bené", "Dona Rosinha", "Zeca", "Seu Arlindo", "Dona Cleide", "Juca"];
export { TEAM, TARGET, tkey, isDbl, pips, newGame, startHand, legalMoves, applyMove, applyPass, nextHand, botChoose, openEnds, tableSum, nomeOfensivo, BOT_NAMES };
