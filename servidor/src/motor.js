// GERADO pelo build.py a partir do jogo (não editar aqui): regras, robô, filtro de nomes e nomes da turma.
// ===== ENGINE START =====
const TEAM = p => p % 2;            // time 0 = cadeiras 0 e 2, time 1 = cadeiras 1 e 3
const TARGET = 200;
const isDbl = t => t[0] === t[1];
const pips = t => t[0] + t[1];
const tkey = t => Math.min(t[0], t[1]) + '-' + Math.max(t[0], t[1]);

function fullSet() { const s = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) s.push([a, b]); return s; }
// Embaralhar de verdade: o sorteio usa a fonte de acaso do sistema (crypto.getRandomValues, a mesma de senhas e chaves),
// não o Math.random, e cada pedra tem exatamente a mesma chance de cair em qualquer lugar (Fisher–Yates, com rejeição para não ter viés).
const acaso = (() => {
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) return n => Math.floor(Math.random() * n);
  const buf = new Uint32Array(64); let k = 64;
  return n => { const lim = Math.floor(0x100000000 / n) * n; let x; do { if (k >= 64) { c.getRandomValues(buf); k = 0; } x = buf[k++]; } while (x >= lim); return x % n; };
})();
function shuffle(arr, rnd) { for (let i = arr.length - 1; i > 0; i--) { const j = rnd ? Math.floor(rnd() * (i + 1)) : acaso(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

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
      if ((st.openMode || 'carroca') === 'carroca' && !isDbl(t)) return;
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
    lacks: [[], [], [], []], result: null, phase: 'play', events: [], pedido: null });
  if (redeals) st.events.push({ type: 'redeal', n: redeals });
  const ns = st.nextStart;
  if (ns.mode === 'sena') {
    st.turn = hands.findIndex(h => h.some(t => t[0] === 6 && t[1] === 6));
    st.openMode = 'sena';
    st.events.push({ type: 'start', p: st.turn, mode: 'sena' });
  } else {
    let b = ns.player;
    for (let k = 0; k < 4 && !hands[b].some(isDbl); k++) {
      const team = 1 - TEAM(b);
      addScore(st, team, 20);
      st.events.push({ type: 'semCarroca', p: b, team, pts: 20 });
      b = (b + 1) % 4;
    }
    st.turn = b; st.openMode = 'carroca';
    st.events.push({ type: 'start', p: b, mode: 'carroca' });
  }
}

function anyoneCanPlay(st) { for (let q = 0; q < 4; q++) if (legalMoves(st, q).length) return true; return false; }

function applyMove(st, p, mv) {
  st.events = [];
  expirarPonto(st);
  const t = st.hands[p].splice(mv.i, 1)[0];
  place(st, t, mv.side);
  st.passStreak = []; st.lastPlayer = p; st.lastKey = tkey(t); st.openMode = null;
  const pts = tableScore(st);   // soma das 4 pontas (bucho incluído)
  // modo torneio: o ponto fica esperando a dupla pedir
  if (pts) { if (st.pedirPonto) st.pedido = { team: TEAM(p), pts, p }; else addScore(st, TEAM(p), pts); }
  st.events.push({ type: 'play', p, t, pts, team: TEAM(p), side: mv.side, pedir: !!(pts && st.pedirPonto) });
  if (!st.hands[p].length) {
    if (st.pedido) { addScore(st, st.pedido.team, st.pedido.pts); st.pedido = null; }   // na batida, o ponto da última pedra vale direto
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
  if (!anyoneCanPlay(st)) { if (st.pedido) { addScore(st, st.pedido.team, st.pedido.pts); st.pedido = null; } closeHand(st, p); return; }
  st.turn = (p + 1) % 4;
}

function applyPass(st, p) {
  st.events = [];
  expirarPonto(st);
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

// Modo torneio: o ponto não pedido se perde quando o próximo joga ou passa
function expirarPonto(st) {
  if (!st.pedido) return;
  st.events.push({ type: 'pontoPerdido', p: st.pedido.p, team: st.pedido.team, pts: st.pedido.pts });
  st.pedido = null;
}
// Pedir ponto: vale se a dupla tem ponto esperando; se não tem, dá 20 para os adversários.
// junto = o pedido sai junto com a jogada (robô), sem apagar os avisos dela
function pedirPonto(st, p, junto) {
  if (!junto) st.events = [];
  if (st.pedido && st.pedido.team === TEAM(p)) {
    addScore(st, st.pedido.team, st.pedido.pts);
    st.events.push({ type: 'ponto', p, team: st.pedido.team, pts: st.pedido.pts });
    st.pedido = null;
    return true;
  }
  const team = 1 - TEAM(p);
  addScore(st, team, 20);
  st.events.push({ type: 'pontoErrado', p, team, pts: 20 });
  return false;
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
    // Jogo novo e partida nova (depois dos 200) começam com a carroça de sena.
    if (r.gameWinner != null) { const fresh = newGame(st.names); fresh.torneio = st.torneio; Object.keys(st).forEach(k => delete st[k]); Object.assign(st, fresh); }
    else { st.partida++; st.score = [0, 0]; st.handNo = 0; st.nextStart = { mode: 'sena' }; }
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
    armLayout(asArm(bu.D), { mode: 'col', colX: 0, colEnd: 1, dir: 1, vdir: 1, lo: -Xmax, hi: -0.5, firstNeed: colunaBucho(Xmax) }, (t, p) => res.D.push(p));
    armLayout(asArm(bu.U), { mode: 'col', colX: 0, colEnd: -1, dir: -1, vdir: -1, lo: 0.5, hi: Xmax, firstNeed: colunaBucho(Xmax) }, (t, p) => res.U.push(p));
  } else {
    res.main[center] = { x: 0, y: 0, o: 'h', v1: c.a, v2: c.b };
    armLayout(right, { x: 1, y: 0, dir: 1, vdir: 1, lo: -Xmax, hi: Xmax }, toMain);
    armLayout(left, { x: -1, y: 0, dir: -1, vdir: -1, lo: -Xmax, hi: Xmax }, toMain);
  }
  return res;
}
// altura das colunas do bucho. 3.40.1 (o dono, de novo: "quando o bucho cresce, as pedras ficam muito pequenas"): a coluna
// reta do bucho (até 3 pedras em pé para cima e 3 para baixo, uma linha só atravessando a mesa) esticava a mesa na
// vertical. Agora o bucho vira para o lado logo depois da primeira pedra e segue em fileiras até a borda, cada um no
// seu canto (o de cima para a direita, o de baixo para a esquerda), sem encostar nas pontas. Simulação de 2 mil mãos:
// pedras 8% a 14% maiores no fim da mão, junto com a fileira mais curta no celular em pé.
let mesaA = 0.83;
function colunaBucho(Xmax) { return 3; }
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

// ===== Robô forte e reações dos robôs (3.23) =====
// O robô forte pensa como jogador experiente: imagina vários jeitos de como as pedras escondidas podem estar
// divididas (respeitando os números em que cada um já passou e quantas pedras cada um tem), simula o resto da mão
// para cada jogada possível e escolhe a que mais rende para a dupla. Não vê a mão de ninguém.
function botRapido(st, p, rnd) {   // usado só dentro da simulação: ponto na hora, bater, descartar pedra pesada
  const mv = legalMoves(st, p), h = st.hands[p];
  let best = mv[0], bv = -1e9;
  for (const m of mv) {
    const t = h[m.i], s = cloneT(st); place(s, t, m.side);
    const v = tableScore(s) + (h.length === 1 ? 300 : 0) + pips(t) * 0.3 + (isDbl(t) ? 3 : 0) + rnd();
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}
function sortearMaos(st, p, rnd) {
  const vistos = new Set(st.hands[p].map(tkey)); tableTiles(st).forEach(t => vistos.add(tkey(t)));
  const resto = fullSet().filter(t => !vistos.has(tkey(t)));
  const outros = [1, 2, 3].map(k => (p + k) % 4);
  const ordem = outros.slice().sort((a, b) => (st.lacks[b] || []).length - (st.lacks[a] || []).length);
  for (let tent = 0; tent < 60; tent++) {
    const pool = resto.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const maos = {}; let ok = true;
    for (const q of ordem) {
      const precisa = st.hands[q].length, falta = st.lacks[q] || [];
      maos[q] = [];
      for (let i = 0; i < pool.length && maos[q].length < precisa; i++) {
        const t = pool[i]; if (falta.includes(t[0]) || falta.includes(t[1])) continue;
        maos[q].push(t); pool.splice(i, 1); i--;
      }
      if (maos[q].length < precisa) { ok = false; break; }
    }
    if (ok) return maos;
  }
  return null;
}
function copiaParaSimular(st) {
  const s = JSON.parse(JSON.stringify(Object.assign({}, st, { events: [], names: null, history: null })));
  return s;
}
function botForte(st, p, n, rnd) {
  rnd = rnd || Math.random; n = n || 100;
  const mv = legalMoves(st, p);
  if (mv.length <= 1) return mv[0] || null;
  const tot = new Array(mv.length).fill(0), time = TEAM(p);
  let feitas = 0;
  for (let k = 0; k < n; k++) {
    const maos = sortearMaos(st, p, rnd); if (!maos) break;
    feitas++;
    for (let i = 0; i < mv.length; i++) {
      const s = copiaParaSimular(st);
      for (const q in maos) s.hands[q] = maos[q].map(t => t.slice());
      const a = s.score.slice();
      applyMove(s, p, mv[i]); if (s.pedido && s.pedido.team === TEAM(p)) pedirPonto(s, p, true);
      for (let g = 0; g < 120 && s.phase === 'play'; g++) {
        const q = s.turn;
        if (legalMoves(s, q).length) { applyMove(s, q, botRapido(s, q, rnd)); if (s.pedido && s.pedido.team === TEAM(q)) pedirPonto(s, q, true); }
        else applyPass(s, q);
      }
      tot[i] += (s.score[time] - a[time]) - (s.score[1 - time] - a[1 - time]);
    }
  }
  if (!feitas) return botChoose(st, p, rnd);
  let b = 0; for (let i = 1; i < mv.length; i++) if (tot[i] > tot[b]) b = i;
  return mv[b];
}

// Reações dos robôs: só em lance que importa, coerentes com quem é parceiro e quem é adversário, e com moderação
// (cada robô no máximo uma vez a cada 30 s; entre dois robôs quaisquer, 8 s). Os números são a posição da frase na
// lista de reações do jogo (a mesma da mesa online).
const RX = { boaParceiro: 0, voMermo: 1, leseira: 2, bateLogo: 3, segura: 4, taFacil: 5, hojeGalo: 6, bora: 7, palmas: 8, risada: 9,
  susto: 10, fogo: 11, caroco: 12, chibata: 13, teleze: 14, bubuia: 15, tacaca: 17, deuGalo: 18, abiu: 19, nemComNojo: 20, tucupi: 22 };
function reacaoRobo(st, evs, robos, mem, agora, rnd) {
  rnd = rnd || Math.random;
  if (!evs || !evs.length || !robos || !robos.length) return null;
  mem.ult = mem.ult || {};
  const ehRobo = q => robos.includes(q), livre = (q, forte) => agora - (mem.ult[q] || 0) >= (forte ? 12000 : 30000);
  if (agora - (mem.global || 0) < 8000) return null;
  const sorteia = l => l[Math.floor(rnd() * l.length)];
  const doTime = (time, quer) => robos.filter(q => TEAM(q) === time && (!quer || quer(q)));
  const r = st.result;
  let escolha = null;   // { p, k, chance, forte }
  const ev = t => evs.find(e => e.type === t);
  const galo = ev('galo'), batida = ev('batida'), jogada = ev('play'), passe = ev('pass');
  if (r && r.matchWinner != null && (batida || ev('fechado'))) {
    const q = sorteia(doTime(r.matchWinner) || []);
    if (q != null) escolha = { p: q, k: sorteia([RX.tucupi, RX.taFacil, RX.fogo]), chance: 0.6, forte: true };
  } else if (galo) {
    const nossos = doTime(galo.team), deles = doTime(1 - galo.team);
    if (nossos.length && rnd() < 0.75) escolha = { p: ehRobo(galo.p) ? galo.p : sorteia(nossos), k: sorteia([RX.deuGalo, RX.hojeGalo, RX.fogo]), chance: 0.8, forte: true };
    else if (deles.length) escolha = { p: sorteia(deles), k: sorteia([RX.nemComNojo, RX.caroco, RX.susto]), chance: 0.5, forte: true };
  } else if (batida) {
    const bt = batida.team;
    if (ehRobo(batida.p)) escolha = { p: batida.p, k: sorteia([RX.chibata, RX.segura, RX.voMermo]), chance: 0.6 };
    else if (doTime(bt).length) escolha = { p: sorteia(doTime(bt)), k: sorteia([RX.boaParceiro, RX.palmas]), chance: 0.6 };
    else if (doTime(1 - bt).length) escolha = { p: sorteia(doTime(1 - bt)), k: sorteia([RX.caroco, RX.teleze]), chance: 0.35 };
  } else if (jogada && jogada.pts >= 20) {
    const tm = TEAM(jogada.p);
    if (ehRobo(jogada.p)) escolha = { p: jogada.p, k: sorteia([RX.chibata, RX.segura, RX.voMermo]), chance: 0.6 };
    else if (doTime(tm).length) escolha = { p: sorteia(doTime(tm)), k: sorteia([RX.boaParceiro, RX.palmas]), chance: 0.6 };
    if ((!escolha || rnd() < 0.4) && doTime(1 - tm).length) escolha = { p: sorteia(doTime(1 - tm)), k: sorteia([RX.caroco, RX.susto, RX.teleze]), chance: 0.4 };
  } else if (passe && passe.pts && !passe.voided) {
    // o adversário passou e a dupla do robô ganhou 20: provoca de leve, de vez em quando
    const q = sorteia(doTime(passe.team));
    if (q != null) escolha = { p: q, k: sorteia([RX.abiu, RX.risada, RX.bubuia]), chance: 0.15 };
  } else if (jogada && st.phase === 'play') {
    // o parceiro ficou com uma pedra só: "Bate logo!"
    const parc = (jogada.p + 2) % 4;
    if (st.hands[jogada.p].length === 1 && ehRobo(parc)) escolha = { p: parc, k: RX.bateLogo, chance: 0.04 };
    else {
      const tm = TEAM(jogada.p);
      if (jogada.pts && st.score[tm] - st.score[1 - tm] >= 80 && doTime(tm).length) escolha = { p: sorteia(doTime(tm)), k: RX.taFacil, chance: 0.12 };
    }
  }
  if (!escolha || escolha.p == null || !livre(escolha.p, escolha.forte) || rnd() >= escolha.chance) return null;
  mem.ult[escolha.p] = agora; mem.global = agora;
  return { p: escolha.p, k: escolha.k };
}

const NOME_RUIM_PARTE = ['porra', 'caralh', 'buceta', 'boceta', 'xoxota', 'xereca', 'piroca', 'punheta', 'siririca', 'arrombad',
  'filhodaputa', 'fdp', 'fodase', 'fodido', 'fudido', 'foder', 'putaria', 'vagabund', 'cuzao', 'cusao', 'vadia', 'prostitut',
  'traveco', 'retardad', 'nazista', 'hitler', 'estupr', 'pedofil', 'viadinho', 'porno', 'merda', 'bosta', 'cacete', 'pqp',
  'tomarnocu', 'paunocu', 'vaitomar', 'safad', 'piranh',
  // de Manaus (estudo de cultura): ofensa, termo sexual, xingamento e violência
  'baitola', 'quenga', 'acochar', 'lazarent', 'chabocar', 'malaco', 'galeros', 'abestad', 'baiacu', 'perreche', 'jorgetexas',
  // 3.25: mais termos sexuais e xingamentos (o "Pica Dura" passou), inclusive grudados ("PicaDura", "PauDuro")
  'piroc', 'bucet', 'xerec', 'xoxot', 'pauduro', 'paugross', 'picadura', 'picagross', 'picamole', 'picudo', 'rolud', 'rolao', 'putinh', 'putona',
  'tesao', 'tezao', 'tesud', 'boquet', 'bronha', 'cuzinh', 'cusinh', 'chifrud', 'transar', 'transand', 'orgia', 'sexo', 'xvideo', 'pornhub',
  // 3.38.2: o "Boyceta" passou (y no lugar do o; s no lugar do c)
  'boicet', 'buicet', 'buset', 'boset', 'bucit', 'bocit', 'xoxot', 'xerek', 'piruc', 'pirok',
  'onlyfans', 'pepek', 'xaninh', 'grelinh', 'bundinh', 'bundud', 'rabud', 'peitud', 'gozad', 'enrab', 'rapariga', 'desgrac', 'imbecil',
  'idiota', 'mongoloid', 'aleijad', 'vagab', 'arromb', 'fuck', 'shit', 'pussy', 'bitch', 'whore', 'nigg', 'slut', 'boobs'];
// Curtas: só barram como palavra separada (para não pegar "Cunha" ou "Disputa").
const NOME_RUIM_PALAVRA = ['cu', 'puta', 'putas', 'puto', 'foda', 'fode', 'rola', 'xota', 'viado', 'veado', 'bicha', 'sapatao',
  'crioulo', 'corno', 'otario', 'babaca', 'anus', 'penis', 'vagina', 'kct', 'vsf', 'tnc', 'fdps', 'teba', 'cui', 'tobo',
  'pica', 'pau', 'piru', 'xana', 'ppk', 'grelo', 'bunda', 'bundao', 'rabo', 'peitos', 'peitao', 'teta', 'tetas', 'chupa', 'chupar', 'mamar',
  'mamada', 'gozar', 'gozo', 'gostosa', 'gostoso', 'gostosao', 'gostosinha', 'sexy', 'sex', 'anal', 'nude', 'nudes', 'broxa', 'cachorra',
  'vaca', 'cagao', 'cagar', 'dick', 'cock', 'tits'];
// 3.38.2 (o "Sokomo Kazada" passou): frases de duplo sentido, escritas do jeito que se fala ("só como casada") e
// também trocando letras de mesmo som (k = c, z = s, y = i, w = u, ph = f). Conferidas no nome todo grudado.
const NOME_RUIM_FRASE = [
  /c[ou]m(o|i|e|endo|er|edor|edora)(de|da|das|do|dos|a|as|o|os|sua|tua|teu|seu|tu|vc|voce)?(casad|mulher|esposa|mae|irma|namorad|noiv|filha|sogra|vizinh|cunhad|prima|tia|vo|novinh|mina)/,
  /(pego|pega|peguei|pegador|catei|cato|traco|tracei)(de|da|das|a|as|o|os|sua|tua)?(casad|mulher|esposa|mae|irma|namorad|noiv|novinh|mina)/,
  /(sua|tua)(mae|irma|mulher|esposa|namorad)(e|eh|ta|tah)?(minha|gostos|safad|puta)/,
  /sentanomeu|sentanele|sentaaqui|sentaemmim|mamanomeu|chupaaqui|chupanomeu/,
  // 3.39.1: "leite" com duplo sentido ("Leite Europeu"); "Leite" sozinho e sobrenomes (Ana Leite) continuam valendo
  /leite?(europ|quent|gros|branc|nacara|naboca)|leitinh|(toma|da|dar|dou|mama|mamar|chupa|bebe|beber)leite/
];
const somDeNome = s => s.replace(/ph/g, 'f').replace(/k/g, 'c').replace(/z/g, 's').replace(/y/g, 'i').replace(/w/g, 'u');
function nomeOfensivo(nome) {
  const junta = s => s.replace(/(.)\1+/g, '$1');
  const leet = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };
  const base = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[0134578@$!]/g, c => leet[c]);
  const tudo = base.replace(/[^a-z]/g, ''), tudoJ = junta(tudo), som = junta(somDeNome(tudo));
  if (NOME_RUIM_PARTE.some(w => tudo.includes(w) || tudoJ.includes(junta(w)) || som.includes(junta(somDeNome(w))))) return true;
  if (NOME_RUIM_FRASE.some(r => r.test(tudoJ) || r.test(som))) return true;
  const palavras = base.split(/[^a-z]+/).filter(Boolean);
  return NOME_RUIM_PALAVRA.some(w => tudo === w || tudoJ === junta(w) || palavras.some(p => p === w || junta(p) === junta(w)));
}
// 3.30: apelido genérico ("Anonimous", "Jogador", "Teste", "aaa"): o app pede um apelido de verdade (é assim que a
// turma chama a pessoa na mesa). Só o perfil recusa; quem já estava com um desses recebe o pedido uma vez.
const NOME_GENERICO = ['anonimous', 'anonymous', 'anonimo', 'anonima', 'anonimus', 'anonymus', 'anonimos', 'anon', 'anonimato', 'desconhecido',
  'desconhecida', 'jogador', 'jogadora', 'player', 'usuario', 'usuaria', 'user', 'teste', 'test', 'testando', 'visitante', 'convidado',
  'convidada', 'guest', 'ninguem', 'nobody', 'fulano', 'fulana', 'sicrano', 'beltrano', 'nome', 'apelido', 'meunome', 'seila', 'qualquer',
  'asdf', 'qwerty', 'abc', 'xyz', 'eu', 'semnome', 'noname',
  'outro', 'outra', 'outros', 'outras', 'alguem', 'eumesmo', 'qualquerum', 'nenhum', 'nenhuma', 'jogadorx', 'player1'];   // 3.37.1: "Outro" e parecidos
function nomeGenerico(nome) {
  const t = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return t.length < 2 || /^(.)\1+$/.test(t) || NOME_GENERICO.includes(t);
}
const BOT_NAMES = ["Raimundo", "Nonato", "Socorro", "Tonhão", "Chiquinho", "Graça", "Tião", "Conceição", "Bené", "Rosinha", "Zeca", "Arlindo", "Cleide", "Juca", "Lucinha", "Mané", "Dico", "Nazaré", "Dita", "Piaba", "Chica", "Curica", "Dorinha", "Valdir", "Zuleide", "Deco", "Tetê", "Dodó", "Ciça"];
export { TEAM, TARGET, tkey, isDbl, pips, newGame, startHand, legalMoves, applyMove, applyPass, nextHand, botChoose, botForte, reacaoRobo, openEnds, tableSum, nomeOfensivo, nomeGenerico, BOT_NAMES, pedirPonto };
