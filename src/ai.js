// X-Tavla yapay zeka: heuristic degerlendirme + (zor seviyede) 1-ply expectiminimax
import {
  WHITE, BLACK, opponent, countAt, isOwn, pipCount, generateSequences, cloneState
} from './game.js';

// Mesafeye gore yaklasik vurulma sayisi (36 zar kombinasyonu uzerinden)
const SHOTS = [0, 11, 12, 14, 15, 15, 17, 6, 6, 5, 3, 2, 3];

// Oyuncu kendi bakis acisindan ilerleme koordinati: 0 = eve en yakin, 23 = en uzak
function pos(p, i) {
  return p === WHITE ? i : 23 - i;
}

function hasContact(s) {
  if (s.bar.w > 0 || s.bar.b > 0) return true;
  let whiteBack = -1;
  let blackBack = 24;
  for (let i = 0; i < 24; i++) {
    if (s.points[i] > 0) whiteBack = Math.max(whiteBack, i);
    if (s.points[i] < 0) blackBack = Math.min(blackBack, i);
  }
  return whiteBack > blackBack;
}

function blotRisk(s, p, i) {
  const opp = opponent(p);
  let shots = 0;
  const add = (d) => { if (d >= 1 && d <= 12) shots += SHOTS[d]; };
  if (p === WHITE) {
    if (s.bar.b > 0) add(i + 1);
    for (let j = 0; j < i; j++) if (isOwn(s, j, opp)) add(i - j);
  } else {
    if (s.bar.w > 0) add(24 - i);
    for (let j = 23; j > i; j--) if (isOwn(s, j, opp)) add(j - i);
  }
  return Math.min(36, shots) / 36;
}

export function evaluate(s, p) {
  const opp = opponent(p);
  if (s.off[p] >= 15) return 10000;
  if (s.off[opp] >= 15) return -10000;

  const myPips = pipCount(s, p);
  const oppPips = pipCount(s, opp);
  let score = (oppPips - myPips) * 1.0;
  score += (s.off[p] - s.off[opp]) * 6;

  if (!hasContact(s)) {
    // Yaris: sadece pip ve toplama onemli, eve yigilmayi hafif odullendir
    return score * 1.5;
  }

  score += (s.bar[opp] - s.bar[p]) * 14;

  let prime = 0;
  let bestPrime = 0;
  for (let k = 0; k < 24; k++) {
    // k: oyuncunun kendi koordinati
    const i = p === WHITE ? k : 23 - k;
    const c = countAt(s, i, p);
    if (c >= 2) {
      score += 2;
      if (k <= 5) score += 3 + (k === 4 || k === 5 ? 1.5 : 0); // ev kapilari, 5 ve 6. hane degerli
      if (k === 6) score += 2; // bar kapisi
      if (c > 4) score -= (c - 4) * 0.8; // asiri yigilma
      prime++;
      bestPrime = Math.max(bestPrime, prime);
    } else {
      prime = 0;
      if (c === 1) {
        const risk = blotRisk(s, p, i);
        // Vurulursa kaybedilecek pip ~ (24 - k), ilerlemis pul daha degerli
        score -= risk * (6 + (23 - k) * 0.55);
      }
    }
  }
  score += bestPrime >= 3 ? (bestPrime - 2) * 4 : 0;

  // Rakip pullari bar'dayken kapali ev kapisi cok degerli
  if (s.bar[opp] > 0) {
    let closed = 0;
    for (let k = 0; k <= 5; k++) {
      const i = p === WHITE ? k : 23 - k;
      if (countAt(s, i, p) >= 2) closed++;
    }
    score += closed * 3 * s.bar[opp];
  }

  // Rakibin tahtamda geride kalan pullari (anchor) bize kotu
  for (let k = 0; k <= 5; k++) {
    const i = p === WHITE ? k : 23 - k;
    if (countAt(s, i, opp) >= 2) score -= 2.5;
  }

  // Kendi geride kalan pullarim icin hafif ceza (kacmak gerek)
  for (let i = 0; i < 24; i++) {
    if (pos(p, i) >= 18) score -= countAt(s, i, p) * 0.6;
  }
  return score;
}

const ROLLS = (() => {
  const r = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) r.push({ a, b, w: a === b ? 1 : 2 });
  }
  return r;
})();

function withDice(s, turn, a, b) {
  const n = cloneState(s);
  n.turn = turn;
  n.rolled = [a, b];
  n.dice = a === b ? [a, a, a, a] : [a, b];
  return n;
}

function bestReplyValue(s, opp) {
  // Rakip icin her zar kombinasyonunda en iyi cevabin ortalamasi (rakip gozunden)
  let total = 0;
  for (const { a, b, w } of ROLLS) {
    const st = withDice(s, opp, a, b);
    const seqs = generateSequences(st, opp);
    let best = -Infinity;
    for (const sq of seqs) {
      const v = evaluate(sq.state, opp);
      if (v > best) best = v;
    }
    total += best * w;
  }
  return total / 36;
}

/**
 * Mevcut zarlarla oynanacak hamle dizisini secer.
 * @param {object} state  zar atilmis oyun durumu
 * @param {string} p      oynayan taraf
 * @param {'easy'|'normal'|'hard'} level
 * @returns {Array} hamle listesi (sirayla uygulanacak)
 */
export function chooseMoves(state, p = state.turn, level = 'normal') {
  const seqs = generateSequences(state, p);
  if (!seqs.length || !seqs[0].moves.length) return [];
  const scored = seqs
    .map((sq) => ({ sq, v: evaluate(sq.state, p) }))
    .sort((x, y) => y.v - x.v);

  if (level === 'easy') {
    // En iyi birkac hamle arasindan rastgele, ara sira tamamen rastgele
    if (Math.random() < 0.25) return scored[Math.floor(Math.random() * scored.length)].sq.moves;
    const top = scored.slice(0, Math.min(4, scored.length));
    return top[Math.floor(Math.random() * top.length)].sq.moves;
  }

  if (level === 'hard' && scored.length > 1 && hasContact(state)) {
    const opp = opponent(p);
    const K = Math.min(5, scored.length);
    let best = null;
    let bestV = -Infinity;
    for (let i = 0; i < K; i++) {
      const { sq } = scored[i];
      const v = sq.state.off[p] >= 15 ? 10000 : -bestReplyValue(sq.state, opp);
      if (v > bestV) { bestV = v; best = sq; }
    }
    return best.moves;
  }

  return scored[0].sq.moves;
}

export const AI_LEVELS = { easy: 'Kolay', normal: 'Normal', hard: 'Zor' };
export { BLACK as AI_DEFAULT_SIDE };
