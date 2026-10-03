// X-Tavla oyun motoru (saf mantik, DOM yok)
// Tahta: points[0..23]. Pozitif = beyaz pul sayisi, negatif = siyah pul sayisi.
// Beyaz 23 -> 0 yonunde ilerler (evi 0..5), siyah 0 -> 23 yonunde ilerler (evi 18..23).

export const WHITE = 'w';
export const BLACK = 'b';
export const CHECKERS = 15;

export function opponent(p) {
  return p === WHITE ? BLACK : WHITE;
}

function sign(p) {
  return p === WHITE ? 1 : -1;
}

export function createInitialState() {
  const points = new Array(24).fill(0);
  points[23] = 2; points[12] = 5; points[7] = 3; points[5] = 5;
  points[0] = -2; points[11] = -5; points[16] = -3; points[18] = -5;
  return {
    points,
    bar: { w: 0, b: 0 },
    off: { w: 0, b: 0 },
    turn: WHITE,
    dice: [],
    rolled: []
  };
}

export function cloneState(s) {
  return {
    points: s.points.slice(),
    bar: { w: s.bar.w, b: s.bar.b },
    off: { w: s.off.w, b: s.off.b },
    turn: s.turn,
    dice: s.dice.slice(),
    rolled: s.rolled.slice()
  };
}

export function stateKey(s) {
  return s.points.join(',') + '|' + s.bar.w + ',' + s.bar.b + '|' + s.off.w + ',' + s.off.b;
}

export function countAt(s, i, p) {
  const v = s.points[i] * sign(p);
  return v > 0 ? v : 0;
}

export function isOwn(s, i, p) {
  return s.points[i] * sign(p) > 0;
}

function isBlocked(s, i, p) {
  return s.points[i] * sign(p) <= -2;
}

function isBlot(s, i, p) {
  return s.points[i] * sign(p) === -1;
}

export function homeRange(p) {
  return p === WHITE ? [0, 5] : [18, 23];
}

export function inHome(i, p) {
  const [a, b] = homeRange(p);
  return i >= a && i <= b;
}

export function allHome(s, p) {
  if (s.bar[p] > 0) return false;
  for (let i = 0; i < 24; i++) {
    if (isOwn(s, i, p) && !inHome(i, p)) return false;
  }
  return true;
}

export function pipCount(s, p) {
  let pips = s.bar[p] * 25;
  for (let i = 0; i < 24; i++) {
    const c = countAt(s, i, p);
    if (c) pips += c * (p === WHITE ? i + 1 : 24 - i);
  }
  return pips;
}

function hasFurther(s, p, i) {
  if (p === WHITE) {
    for (let j = i + 1; j <= 5; j++) if (isOwn(s, j, p)) return true;
  } else {
    for (let j = i - 1; j >= 18; j--) if (isOwn(s, j, p)) return true;
  }
  return false;
}

export function entryPoint(p, die) {
  return p === WHITE ? 24 - die : die - 1;
}

// Tek bir zar degeri icin mumkun hamleler (zar kullanim kurallari haric)
export function singleMoves(s, p, die) {
  const moves = [];
  const dir = p === WHITE ? -1 : 1;
  if (s.bar[p] > 0) {
    const to = entryPoint(p, die);
    if (!isBlocked(s, to, p)) moves.push({ from: 'bar', to, die, hit: isBlot(s, to, p) });
    return moves;
  }
  const canBear = allHome(s, p);
  for (let i = 0; i < 24; i++) {
    if (!isOwn(s, i, p)) continue;
    const to = i + dir * die;
    if (to >= 0 && to <= 23) {
      if (!isBlocked(s, to, p)) moves.push({ from: i, to, die, hit: isBlot(s, to, p) });
    } else if (canBear) {
      const exact = p === WHITE ? to === -1 : to === 24;
      if (exact || !hasFurther(s, p, i)) moves.push({ from: i, to: 'off', die, hit: false });
    }
  }
  return moves;
}

export function applyMove(s, m, p = s.turn) {
  const n = cloneState(s);
  const sg = sign(p);
  if (m.from === 'bar') n.bar[p]--;
  else n.points[m.from] -= sg;
  if (m.to === 'off') {
    n.off[p]++;
  } else {
    if (n.points[m.to] * sg === -1) {
      n.points[m.to] = 0;
      n.bar[opponent(p)]++;
    }
    n.points[m.to] += sg;
  }
  const idx = n.dice.indexOf(m.die);
  if (idx >= 0) n.dice.splice(idx, 1);
  return n;
}

function uniqueDice(dice) {
  return Array.from(new Set(dice));
}

function maxDepth(s, p, memo) {
  if (!s.dice.length) return 0;
  const key = stateKey(s) + '#' + s.dice.slice().sort().join('');
  if (memo.has(key)) return memo.get(key);
  let best = 0;
  outer: for (const d of uniqueDice(s.dice)) {
    for (const m of singleMoves(s, p, d)) {
      const depth = 1 + maxDepth(applyMove(s, m, p), p, memo);
      if (depth > best) best = depth;
      if (best === s.dice.length) break outer;
    }
  }
  memo.set(key, best);
  return best;
}

// Kurallara uygun ilk hamleler: mumkun olan en fazla zari kullanmak zorunlu,
// tek zar oynanabiliyorsa buyuk zar oynanmali.
export function legalMoves(s, p = s.turn) {
  if (!s.dice.length) return [];
  const memo = new Map();
  const cands = [];
  let best = 0;
  for (const d of uniqueDice(s.dice)) {
    for (const m of singleMoves(s, p, d)) {
      const depth = 1 + maxDepth(applyMove(s, m, p), p, memo);
      cands.push({ m, depth });
      if (depth > best) best = depth;
    }
  }
  if (best === 0) return [];
  let res = cands.filter((c) => c.depth === best).map((c) => c.m);
  if (best === 1 && s.dice.length === 2 && s.dice[0] !== s.dice[1]) {
    const hi = Math.max(...res.map((m) => m.die));
    res = res.filter((m) => m.die === hi);
  }
  return res;
}

// AI icin: tum farkli bitis pozisyonlarini ve onlara giden hamle dizilerini uretir
export function generateSequences(s, p = s.turn) {
  const leaves = [];
  const seen = new Set();
  const startLen = s.dice.length;

  function dfs(st, seq) {
    const key = stateKey(st) + '#' + st.dice.slice().sort().join('');
    if (seen.has(key)) return;
    seen.add(key);
    let any = false;
    if (st.dice.length) {
      for (const d of uniqueDice(st.dice)) {
        for (const m of singleMoves(st, p, d)) {
          any = true;
          dfs(applyMove(st, m, p), seq.concat([m]));
        }
      }
    }
    if (!any) leaves.push({ moves: seq, state: st });
  }

  dfs(cloneState(s), []);
  const maxLen = leaves.reduce((a, l) => Math.max(a, l.moves.length), 0);
  if (maxLen === 0) return [{ moves: [], state: cloneState(s) }];
  let res = leaves.filter((l) => l.moves.length === maxLen);
  if (maxLen === 1 && startLen === 2 && s.dice[0] !== s.dice[1]) {
    const hi = Math.max(...res.map((l) => l.moves[0].die));
    res = res.filter((l) => l.moves[0].die === hi);
  }
  const finals = new Map();
  for (const l of res) {
    const k = stateKey(l.state);
    if (!finals.has(k)) finals.set(k, l);
  }
  return Array.from(finals.values());
}

// Kazanan + oyun tipi: 1 = normal, 2 = Mars (gammon), 3 = Tavla (backgammon)
export function checkWinner(s) {
  for (const p of [WHITE, BLACK]) {
    if (s.off[p] >= CHECKERS) {
      const loser = opponent(p);
      let points = 1;
      let type = 'Normal';
      if (s.off[loser] === 0) {
        points = 2;
        type = 'Mars';
        let deep = s.bar[loser] > 0;
        if (!deep) {
          for (let i = 0; i < 24; i++) {
            if (isOwn(s, i, loser) && inHome(i, p)) { deep = true; break; }
          }
        }
        if (deep) { points = 3; type = 'Tavla (Backgammon)'; }
      }
      return { winner: p, loser, points, type };
    }
  }
  return null;
}

function randomDie() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    let v;
    do {
      crypto.getRandomValues(buf);
      v = buf[0];
    } while (v >= 4294967292); // 6'nin kati olmayan ust araligi at (bias yok)
    return (v % 6) + 1;
  }
  return Math.floor(Math.random() * 6) + 1;
}

export function rollDice() {
  return [randomDie(), randomDie()];
}

// Ciftte 4 zar gosterilir, kullanilanlar soluk isaretlenir.
// Donus: [{ face, used }] (kullanim sirasiyla)
export function diceFaces(rolled, dice) {
  if (!rolled || rolled.length < 2) return [];
  const [a, b] = rolled;
  const faces = a === b ? [a, a, a, a] : [a, b];
  const rest = (dice || []).slice();
  return faces.map((f) => {
    const i = rest.indexOf(f);
    if (i >= 0) {
      rest.splice(i, 1);
      return { face: f, used: false };
    }
    return { face: f, used: true };
  });
}

// Zar yuzundeki noktalarin 3x3 hucre numaralari (1..9)
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

export function pipCells(face) {
  return (PIPS[face] || []).slice();
}

export class Game {
  constructor(opts = {}) {
    this.listeners = new Set();
    this.score = { w: 0, b: 0 };
    this.newGame(opts.starter);
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.listeners) {
      try { fn(type, payload, this); } catch (e) { console.error(e); }
    }
  }

  newGame(starter) {
    this.state = createInitialState();
    this.state.turn = starter || WHITE;
    this.history = [];
    this.result = null;
    this.lastMove = null;
    this.emit('new');
  }

  get turn() {
    return this.state.turn;
  }

  needsRoll() {
    return !this.result && this.state.rolled.length === 0;
  }

  roll(values) {
    if (!this.needsRoll()) return null;
    const [a, b] = values || rollDice();
    this.state.rolled = [a, b];
    this.state.dice = a === b ? [a, a, a, a] : [a, b];
    this.history = [];
    this.emit('roll', { dice: [a, b] });
    return [a, b];
  }

  legalMoves() {
    return this.result ? [] : legalMoves(this.state);
  }

  movesFrom(from) {
    return this.legalMoves().filter((m) => m.from === from);
  }

  move(m) {
    const cands = this.legalMoves()
      .filter((x) => x.from === m.from && x.to === m.to && (m.die == null || x.die === m.die))
      .sort((x, y) => x.die - y.die);
    const legal = cands[0];
    if (!legal) return false;
    this.history.push(cloneState(this.state));
    this.state = applyMove(this.state, legal);
    this.lastMove = legal;
    const r = checkWinner(this.state);
    if (r) {
      this.result = r;
      this.score[r.winner] += r.points;
      this.state.dice = [];
    }
    this.emit('move', { move: legal });
    if (r) this.emit('end', r);
    return legal;
  }

  canUndo() {
    return !this.result && this.history.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.state = this.history.pop();
    this.lastMove = null;
    this.emit('undo');
    return true;
  }

  canEndTurn() {
    return !this.result && this.state.rolled.length > 0 &&
      (this.state.dice.length === 0 || this.legalMoves().length === 0);
  }

  endTurn() {
    if (this.result) return;
    this.state.turn = opponent(this.state.turn);
    this.state.dice = [];
    this.state.rolled = [];
    this.history = [];
    this.emit('turn');
  }

  serialize() {
    return JSON.parse(JSON.stringify({ state: this.state, result: this.result, score: this.score }));
  }

  load(data) {
    if (!data || !data.state) return;
    this.state = cloneState(data.state);
    this.result = data.result || null;
    if (data.score) this.score = { w: data.score.w, b: data.score.b };
    this.history = [];
    this.emit('sync');
  }
}
