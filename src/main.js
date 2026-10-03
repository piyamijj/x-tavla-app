// X-Tavla ana denetleyici: ekranlar, tahta cizimi, dokunmatik giris, AI + online akis
import { Game, WHITE, BLACK, opponent, countAt, diceFaces, pipCells } from './game.js';
import { chooseMoves } from './ai.js';
import { Lobby } from './lobby.js';
import { unlock, play, fx, haptic, setEnabled, isEnabled } from './audio.js';

const $ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Beyaz bakis acisi: ev sag altta. grid kolonu -> hane numarasi
function colToPoint(col, top) {
  if (top) return col <= 6 ? 11 + col : 10 + col; // 12..17, 18..23
  return col <= 6 ? 12 - col : 13 - col; // 11..6, 5..0
}
const COLS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13];

// ---------------- DURUM ----------------
const game = new Game();
let mode = 'ai'; // 'ai' | 'local' | 'online'
let aiLevel = 'normal';
let myColor = WHITE;
let oppName = 'Rakip';
let busy = false; // AI oynuyor / animasyon / senkron
let flowToken = 0; // ekran degisince eski async akislari iptal eder
let selected = null; // { from } | null
let lobby = null;
let overModalShown = false;

// ---------------- EKRAN / MODAL / TOAST ----------------
const screens = ['screen-menu', 'screen-lobby', 'screen-game'];
function show(id) {
  flowToken++;
  busy = false;
  selected = null;
  for (const s of screens) $('#' + s).classList.toggle('hidden', s !== id);
}
let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
function modal(title, bodyHTML, buttons) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  const box = $('#modal-actions');
  box.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    btn.className = b.primary ? 'btn-primary !w-auto !px-5' : 'btn-ghost !w-auto !px-5';
    btn.onclick = () => { closeModal(); b.onClick && b.onClick(); };
    box.appendChild(btn);
  }
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
}

// ---------------- TAHTA CIZIMI ----------------
function checkerEl(color, label = '') {
  const d = document.createElement('div');
  d.className = `checker ${color === WHITE ? 'white' : 'black'}`;
  if (label) d.textContent = label;
  return d;
}

// Online Siyah oyuncu tahtayi kendi bakis acisindan gorur: ust/alt yer degistirir
// (ev sag altta, numaralar Siyah icin 1..24). Yalnizca gorunum; oyun mantigi ayni.
let boardFlipped = null;
function isFlipped() {
  return mode === 'online' && myColor === BLACK;
}

function buildBoard() {
  const flip = isFlipped();
  boardFlipped = flip;
  const board = $('#board');
  board.innerHTML = '';
  for (const top of [true, false]) {
    COLS.forEach((col, k) => {
      const idx = colToPoint(col, flip ? !top : top);
      const p = document.createElement('div');
      p.className = `point ${top ? 'top' : 'bottom'}${(k % 2 === (top ? 1 : 0)) ? ' alt' : ''}`;
      p.style.gridColumn = String(col);
      p.dataset.idx = String(idx);
      const lab = document.createElement('span');
      lab.className = 'point-label';
      lab.textContent = String(flip ? 24 - idx : idx + 1);
      p.appendChild(lab);
      board.appendChild(p);
    });
  }
  const bar = document.createElement('div');
  bar.className = 'bar';
  const [barTop, barBottom] = flip ? [WHITE, BLACK] : [BLACK, WHITE];
  bar.innerHTML = `<div class="bar-slot" data-bar="${barTop}"></div><div class="bar-slot bottom-slot" data-bar="${barBottom}"></div>`;
  board.appendChild(bar);
  for (const [side, cls] of (flip ? [[WHITE, 'top'], [BLACK, 'bottom']] : [[BLACK, 'top'], [WHITE, 'bottom']])) {
    const off = document.createElement('div');
    off.className = `off ${cls}`;
    off.dataset.off = side;
    board.appendChild(off);
  }
}

function sideName(p) {
  if (mode === 'ai') return p === WHITE ? 'Sen (Beyaz)' : `Bilgisayar (Siyah, ${aiLevel})`;
  if (mode === 'online') return p === myColor ? `Sen (${p === WHITE ? 'Beyaz' : 'Siyah'})` : `${oppName} (${p === WHITE ? 'Beyaz' : 'Siyah'})`;
  return p === WHITE ? 'Beyaz' : 'Siyah';
}

function render() {
  if (boardFlipped !== isFlipped()) buildBoard();
  const s = game.state;
  // Pullar
  document.querySelectorAll('#board .point').forEach((el) => {
    el.querySelectorAll('.checker').forEach((c) => c.remove());
    el.classList.remove('valid');
    const idx = Number(el.dataset.idx);
    const v = s.points[idx];
    if (!v) return;
    const color = v > 0 ? WHITE : BLACK;
    const n = Math.abs(v);
    const show = Math.min(n, 5);
    for (let k = 0; k < show; k++) {
      const c = checkerEl(color, n > 5 && k === show - 1 ? String(n) : '');
      c.dataset.from = String(idx);
      el.appendChild(c);
    }
  });
  // Bar
  document.querySelectorAll('#board .bar-slot').forEach((el) => {
    el.innerHTML = '';
    const side = el.dataset.bar;
    const n = s.bar[side];
    const show = Math.min(n, 3);
    for (let k = 0; k < show; k++) {
      const c = checkerEl(side, n > 3 && k === show - 1 ? String(n) : '');
      c.dataset.from = 'bar';
      el.appendChild(c);
    }
  });
  // Toplananlar
  document.querySelectorAll('#board .off').forEach((el) => {
    el.innerHTML = '';
    el.classList.remove('valid');
    const side = el.dataset.off;
    for (let k = 0; k < s.off[side]; k++) {
      const chip = document.createElement('div');
      chip.className = `off-chip ${side === WHITE ? 'white' : 'black'}`;
      el.appendChild(chip);
    }
  });
  renderDice();
  renderSelection();
  renderStatus();
}

function renderDice() {
  const area = $('#dice-area');
  area.innerHTML = '';
  const s = game.state;
  if (!s.rolled.length) return;
  area.classList.toggle('left', s.turn === BLACK);
  const faces = diceFaces(s.rolled, s.dice);
  area.classList.toggle('many', faces.length > 2);
  faces.forEach(({ face, used }) => {
    const d = document.createElement('div');
    d.className = `die${s.turn === BLACK ? ' black-die' : ''}${used ? ' used' : ''}`;
    d.setAttribute('aria-label', `zar ${face}${used ? ' (kullanıldı)' : ''}`);
    const pips = pipCells(face);
    for (let cell = 1; cell <= 9; cell++) {
      const pip = document.createElement('div');
      if (pips.includes(cell)) pip.className = 'pip';
      d.appendChild(pip);
    }
    area.appendChild(d);
  });
}

function animateDice() {
  if (REDUCED) return Promise.resolve();
  document.querySelectorAll('#dice-area .die').forEach((d) => d.classList.add('rolling'));
  play('dice');
  return sleep(650);
}

function renderSelection() {
  document.querySelectorAll('#board .point.valid, #board .off.valid').forEach((el) => el.classList.remove('valid'));
  document.querySelectorAll('#board .checker.selected, #board .checker.movable').forEach((el) => el.classList.remove('selected', 'movable'));
  if (selected == null || !canAct()) return;
  const moves = game.movesFrom(selected.from);
  if (!moves.length) return;
  // Secili pulu isaretle
  const src = selected.from === 'bar'
    ? document.querySelector(`#board .bar-slot[data-bar="${game.turn}"] .checker:last-child`)
    : document.querySelector(`#board .point[data-idx="${selected.from}"] .checker:last-child`);
  if (src) src.classList.add('selected');
  for (const m of moves) {
    if (m.to === 'off') {
      const tray = document.querySelector(`#board .off[data-off="${game.turn}"]`);
      if (tray) tray.classList.add('valid');
    } else {
      const pt = document.querySelector(`#board .point[data-idx="${m.to}"]`);
      if (pt) pt.classList.add('valid');
    }
  }
}

function renderStatus() {
  const s = game.state;
  $('#score').textContent = `${game.score.w} - ${game.score.b}`;
  let diceTxt = '';
  if (!game.result && s.rolled.length === 2) {
    const [a, b] = s.rolled;
    diceTxt = a === b ? ` · Zar: Çift ${a}` : ` · Zar: ${a}-${b}`;
  }
  $('#turn-indicator').textContent = game.result
    ? `🏆 ${sideName(game.result.winner)} kazandı (${game.result.type}, +${game.result.points})`
    : `Sıra: ${sideName(s.turn)}${diceTxt}`;
  const mine = canAct();
  $('#btn-roll').disabled = !(mine && game.needsRoll());
  $('#btn-undo').disabled = !(mine && game.canUndo() && mode !== 'online');
  let hint = '';
  if (!game.result && mine) {
    if (game.needsRoll()) hint = 'Zar atarak başla.';
    else if (!game.legalMoves().length) hint = 'Oynanacak hamle yok, tur geçiyor…';
    else if (mode !== 'online' || s.turn === myColor) hint = 'Bir pula dokun ya da sürükle.';
  } else if (!game.result && !mine && mode === 'online') {
    hint = 'Rakip oynuyor…';
  }
  $('#status').textContent = hint;
}

// ---------------- GIRIS (dokun + surukle) ----------------
function canAct() {
  if (game.result || busy) return false;
  if (mode === 'ai') return game.turn === WHITE;
  if (mode === 'local') return true;
  return game.turn === myColor;
}

function ownCheckerAt(from) {
  if (from === 'bar') return game.state.bar[game.turn] > 0;
  return countAt(game.state, from, game.turn) > 0;
}

function tryMove(from, to) {
  if (!canAct() || game.needsRoll()) return false;
  const toNorm = to === 'off' ? 'off' : Number(to);
  const ok = game.move({ from, to: toNorm });
  if (!ok) return false;
  selected = null;
  if (ok.hit) fx('hit', 'heavy');
  else if (ok.to === 'off') fx('bearoff', 'medium');
  else fx('place', 'light');
  render();
  broadcast();
  void afterAction();
  return true;
}

function onPointTap(e) {
  const pt = e.target.closest('#board .point');
  const off = e.target.closest('#board .off');
  const bar = e.target.closest('#board .bar-slot');
  if (!canAct() || game.needsRoll()) return;
  // Hedefe dokunma
  if (selected != null) {
    if (pt && pt.classList.contains('valid')) {
      if (tryMove(selected.from, pt.dataset.idx)) return;
    }
    if (off && off.classList.contains('valid') && off.dataset.off === game.turn) {
      if (tryMove(selected.from, 'off')) return;
    }
  }
  // Pul secme
  let from = null;
  if (bar && bar.dataset.bar === game.turn && game.state.bar[game.turn] > 0) from = 'bar';
  else if (pt && ownCheckerAt(Number(pt.dataset.idx))) from = Number(pt.dataset.idx);
  if (from != null && String(from) !== String(selected && selected.from)) {
    if (!game.movesFrom(from).length) {
      selected = null;
      play('error');
      render();
      toast('Bu pul oynayamaz.');
      return;
    }
    selected = { from };
    play('select');
    render();
    return;
  }
  selected = null;
  render();
}

// Surukle-birak (pointer events, mobil uyumlu)
let drag = null;
function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return;
  const c = e.target.closest('#board .checker');
  if (!c || !canAct() || game.needsRoll()) return;
  const from = c.dataset.from === 'bar' ? 'bar' : Number(c.dataset.from);
  if (from === 'bar') {
    const slot = c.closest('.bar-slot');
    if (!slot || slot.dataset.bar !== game.turn) return;
  } else if (!ownCheckerAt(from)) {
    return;
  }
  if (!game.movesFrom(from).length) return;
  e.preventDefault();
  unlock();
  const rect = c.getBoundingClientRect();
  const ghost = c.cloneNode(false);
  ghost.className = c.className + ' drag-ghost';
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  document.body.appendChild(ghost);
  drag = { from, ghost, x: e.clientX, y: e.clientY, active: false };
  selected = { from };
  render();
  const moveGhost = (x, y) => { drag.ghost.style.left = x + 'px'; drag.ghost.style.top = y + 'px'; };
  moveGhost(e.clientX, e.clientY);
  const onMove = (ev) => {
    if (!drag) return;
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 8) drag.active = true;
    moveGhost(ev.clientX, ev.clientY);
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (!drag) return;
    const wasActive = drag.active;
    drag.ghost.remove();
    const d = drag;
    drag = null;
    if (!wasActive) return; // basit dokunus: tap mantigi calisir
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const pt = el && el.closest ? el.closest('#board .point') : null;
    const off = el && el.closest ? el.closest('#board .off') : null;
    if (pt && pt.classList.contains('valid')) tryMove(d.from, pt.dataset.idx);
    else if (off && off.classList.contains('valid') && off.dataset.off === game.turn) tryMove(d.from, 'off');
    else { selected = null; render(); }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

// ---------------- TUR AKISI ----------------
async function afterAction() {
  const t = flowToken;
  if (game.result) return;
  if (game.canEndTurn()) {
    await sleep(REDUCED ? 50 : 600);
    if (t !== flowToken || game.result) return;
    game.endTurn();
    play('turn');
    render();
    broadcast();
  }
  void maybeAiTurn();
}

async function maybeAiTurn() {
  if (mode !== 'ai' || game.result || game.turn !== BLACK) return;
  const t = flowToken;
  busy = true;
  render();
  await sleep(REDUCED ? 50 : 550);
  if (t !== flowToken) return;
  game.roll();
  render();
  await animateDice();
  if (t !== flowToken) return;
  render();
  const moves = chooseMoves(game.state, BLACK, aiLevel);
  if (!moves.length) {
    toast('Bilgisayar oynayamadı, tur sana geçti.');
    await sleep(REDUCED ? 50 : 700);
  } else {
    for (const m of moves) {
      if (t !== flowToken || game.result) return;
      const ok = game.move({ from: m.from, to: m.to });
      if (!ok) break;
      if (ok.hit) fx('hit', 'medium');
      else if (ok.to === 'off') play('bearoff');
      else play('place');
      render();
      await sleep(REDUCED ? 30 : 480);
    }
  }
  if (t !== flowToken) return;
  if (!game.result) {
    game.endTurn();
    render();
  }
  busy = false;
  render();
}

function onGameEnd(r) {
  render();
  const iWon = mode === 'local' ? null : (mode === 'ai' ? r.winner === WHITE : r.winner === myColor);
  if (iWon === null) play('win');
  else if (iWon) fx('win', 'success');
  else fx('lose', 'error');
  if (overModalShown) return;
  overModalShown = true;
  const againBtn = mode === 'online'
    ? { label: 'Tekrar Oyna', primary: true, onClick: requestRematch }
    : { label: 'Tekrar Oyna', primary: true, onClick: () => startGame(mode) };
  modal(
    `${r.type}! ${sideName(r.winner)} kazandı`,
    `<p>Skor: <b>${game.score.w} - ${game.score.b}</b></p>
     <p class="mt-1 text-slate-400">Tekrar oynamak ister misin?</p>`,
    [againBtn, { label: mode === 'online' ? 'Lobiye Dön' : 'Menü', onClick: leaveToMenu }]
  );
}

// ---------------- OYUN BASLATMA ----------------
function startGame(m, starter) {
  closeModal();
  overModalShown = false;
  show('screen-game');
  game.newGame(starter);
  render();
  broadcast();
  void maybeAiTurn();
}

function leaveToMenu() {
  if (mode === 'online' && lobby) lobby.leaveGame();
  broadcastOff();
  show(mode === 'online' && lobby ? 'screen-lobby' : 'screen-menu');
}

async function onRoll() {
  if (!canAct() || !game.needsRoll()) return;
  unlock();
  const t = flowToken;
  busy = true;
  game.roll();
  render();
  broadcast();
  await animateDice();
  if (t !== flowToken) return;
  busy = false;
  render();
  if (!game.legalMoves().length) {
    toast('Oynanacak hamle yok, tur geçiyor…');
    play('error');
    await sleep(REDUCED ? 50 : 900);
    if (t !== flowToken || game.result) return;
    game.endTurn();
    render();
    broadcast();
    void maybeAiTurn();
  }
}

function onUndo() {
  if (!canAct() || !game.canUndo() || mode === 'online') return;
  game.undo();
  selected = null;
  play('select');
  render();
}

// ---------------- ONLINE ----------------
let wantRematch = false;
function broadcast() {
  if (mode !== 'online' || !lobby) return;
  lobby.send({ t: 'state', data: game.serialize() });
}
function broadcastOff() {
  wantRematch = false;
}

function ensureLobby() {
  if (lobby) return lobby;
  lobby = new Lobby({
    onStatus: (msg, state) => {
      $('#lobby-status').textContent = msg;
      const dot = $('#lobby-dot');
      dot.className = 'w-3 h-3 rounded-full ' + (state === 'online' ? 'bg-neon-lime' : state === 'error' ? 'bg-red-500' : 'bg-amber-400 animate-pulse');
      $('#btn-quick-match').disabled = state !== 'online';
    },
    onId: (id) => { $('#my-id').textContent = 'ID: ' + id; },
    onList: renderLobbyList,
    onMatch: ({ host, oppName: name }) => {
      mode = 'online';
      oppName = name;
      myColor = host ? WHITE : BLACK;
      overModalShown = false;
      show('screen-game');
      if (host) {
        game.newGame(WHITE);
        render();
        broadcast();
        toast(`${oppName} ile eşleşildi. Beyaz başlar.`);
      } else {
        $('#turn-indicator').textContent = `${oppName} oyunu başlatıyor…`;
        toast(`${oppName} ile eşleşildi.`);
      }
    },
    onMessage: onNetMessage,
    onChallenge: (name, accept, decline) => {
      play('turn');
      modal(`${name} sana meydan okuyor`, `<p>Kabul edersen oyun başlar. Rakip: <b>${name}</b></p>`, [
        { label: 'Kabul Et', primary: true, onClick: accept },
        { label: 'Reddet', onClick: decline }
      ]);
    },
    onDeclined: (reason) => toast('Reddedildi: ' + reason),
    onOpponentLeft: () => {
      if (mode !== 'online') return;
      toast('Rakip ayrıldı.');
      modal('Rakip ayrıldı', '<p>Oyuncu oyundan ayrıldı. Lobiye dönebilirsin.</p>', [
        { label: 'Lobiye Dön', primary: true, onClick: () => show('screen-lobby') }
      ]);
    }
  });
  return lobby;
}

function renderLobbyList(players) {
  const ul = $('#lobby-list');
  ul.innerHTML = '';
  if (!players.length) {
    ul.innerHTML = '<li class="text-sm text-slate-500">Henüz kimse yok. Biraz bekle ya da bir arkadaşını çağır.</li>';
    return;
  }
  for (const p of players) {
    const li = document.createElement('li');
    li.className = 'lobby-item';
    const busyP = p.status === 'playing';
    li.innerHTML = `<span class="font-semibold truncate">${p.name}</span>
      <span class="text-xs ${busyP ? 'text-slate-500' : 'text-neon-lime'}">${busyP ? 'oyunda' : 'bekliyor'}</span>`;
    if (!busyP) {
      const b = document.createElement('button');
      b.className = 'btn-neon !py-1 !px-3 !w-auto text-sm';
      b.textContent = 'Meydan Oku';
      b.onclick = () => ensureLobby().challenge(p.id);
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
}

function onNetMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'state' && msg.data) {
    const wasMyTurn = game.turn === myColor && !game.result;
    game.load(msg.data);
    selected = null;
    render();
    if (!wasMyTurn && game.turn === myColor && !game.result) play('turn');
  } else if (msg.t === 'new') {
    overModalShown = false;
    game.newGame(msg.starter || WHITE);
    selected = null;
    render();
    toast('Yeni oyun başladı.');
  } else if (msg.t === 'rematch') {
    if (wantRematch) {
      // Iki taraf da istiyor: beyaz olan baslatir
      wantRematch = false;
      if (myColor === WHITE) {
        const starter = game.result ? opponent(game.result.winner) : WHITE;
        game.newGame(starter);
        overModalShown = false;
        render();
        lobby.send({ t: 'new', starter });
      }
    } else {
      modal(`${oppName} tekrar oynamak istiyor`, '<p>Kabul ediyor musun?</p>', [
        { label: 'Kabul Et', primary: true, onClick: () => { wantRematch = true; lobby.send({ t: 'rematch' }); } },
        { label: 'Reddet', onClick: () => show('screen-lobby') }
      ]);
    }
  } else if (msg.t === 'bye') {
    if (mode === 'online') {
      toast('Rakip ayrıldı.');
      show('screen-lobby');
    }
  }
}

function requestRematch() {
  if (!lobby) return;
  wantRematch = true;
  lobby.send({ t: 'rematch' });
  toast('Rakibe soruldu, yanıt bekleniyor…');
}

// ---------------- BOOT ----------------
function bind() {
  buildBoard();
  $('#opt-sound').checked = isEnabled();
  $('#opt-sound').addEventListener('change', (e) => setEnabled(e.target.checked));
  $('#ai-level').addEventListener('change', (e) => { aiLevel = e.target.value; });
  document.addEventListener('pointerdown', unlock, { once: true });

  $('#btn-ai').onclick = () => { unlock(); mode = 'ai'; myColor = WHITE; startGame('ai'); };
  $('#btn-local').onclick = () => { unlock(); mode = 'local'; startGame('local'); };
  $('#btn-online').onclick = () => { unlock(); mode = 'online'; show('screen-lobby'); };
  $('#btn-game-back').onclick = leaveToMenu;
  $('#btn-lobby-back').onclick = () => show('screen-menu');

  $('#btn-roll').onclick = onRoll;
  $('#btn-undo').onclick = onUndo;
  $('#board').addEventListener('click', onPointTap);
  $('#board').addEventListener('pointerdown', onPointerDown);

  $('#btn-lobby-join').onclick = () => {
    const name = $('#lobby-name').value.trim() || 'Oyuncu';
    ensureLobby().join(name);
  };
  const qm = $('#btn-quick-match');
  qm.onclick = () => {
    const on = qm.textContent.includes('Otomatik');
    ensureLobby().quickMatch(on);
    qm.textContent = on ? '✕ Eşleşmeyi İptal Et' : '⚡ Otomatik Eşleş';
  };
  $('#btn-direct').onclick = () => {
    const id = $('#direct-id').value.trim();
    if (id) ensureLobby().challenge(id);
  };

  game.on((type, payload) => {
    if (type === 'end') onGameEnd(payload);
  });
  show('screen-menu');
}

bind();
