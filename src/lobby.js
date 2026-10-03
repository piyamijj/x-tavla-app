// X-Tavla online bekleme odasi (PeerJS, sunucusuz).
// Mimari: Sabit bir HUB_ID'yi ilk alan istemci 'hub' olur ve bekleme listesini tutar.
// Diger istemciler hub'a baglanip listeyi alir. Meydan okuma ve oyun verisi
// oyuncular arasinda dogrudan (P2P) DataConnection ile tasinir.
// Hub dusurse kalan istemcilerden biri otomatik olarak yeni hub olur.
import Peer from 'peerjs';

const HUB_ID = 'xtavla-lobby-hub-v1';
const PEER_OPTS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class Lobby {
  constructor(handlers = {}) {
    this.h = handlers;
    this.peer = null;
    this.hubPeer = null;
    this.hubClients = new Map(); // hub tarafinda: id -> { name, conn, status, quick }
    this.hubConn = null;
    this.gameConn = null;
    this.name = 'Oyuncu';
    this.players = [];
    this.quick = false;
    this.closed = false;
    this.pendingOut = null;
  }

  get id() {
    return this.peer && this.peer.id;
  }

  status(msg, state) {
    if (this.h.onStatus) this.h.onStatus(msg, state);
  }

  // ---------------- BAGLANTI ----------------
  join(name) {
    this.name = (name || 'Oyuncu').trim().slice(0, 16) || 'Oyuncu';
    this.closed = false;
    if (this.peer && !this.peer.destroyed) {
      this.connectHub();
      return;
    }
    this.status('Sunucuya bağlanılıyor…', 'connecting');
    this.peer = new Peer(undefined, PEER_OPTS);
    this.peer.on('open', (id) => {
      if (this.h.onId) this.h.onId(id);
      this.connectHub();
    });
    this.peer.on('connection', (conn) => this.onIncoming(conn));
    this.peer.on('disconnected', () => {
      if (this.closed) return;
      this.status('Bağlantı koptu, yeniden deneniyor…', 'connecting');
      try { this.peer.reconnect(); } catch (e) { /* yoksay */ }
    });
    this.peer.on('error', (err) => {
      if (err && err.type === 'peer-unavailable') {
        const target = String(err.message || '');
        if (target.includes(HUB_ID)) {
          this.becomeHub();
        } else if (this.pendingOut) {
          this.pendingOut = null;
          this.status('Rakip artık çevrimiçi değil.', 'online');
          if (this.h.onDeclined) this.h.onDeclined('Rakip bulunamadı');
        }
        return;
      }
      this.status('Bağlantı hatası: ' + (err && err.type ? err.type : 'bilinmiyor'), 'error');
    });
  }

  connectHub() {
    if (this.closed || !this.peer || this.peer.destroyed) return;
    if (this.hubConn && this.hubConn.open) return;
    const conn = this.peer.connect(HUB_ID, { reliable: true, metadata: { type: 'lobby' } });
    this.hubConn = conn;
    let opened = false;
    const timer = setTimeout(() => {
      if (!opened && !this.closed) {
        try { conn.close(); } catch (e) { /* yoksay */ }
        this.becomeHub();
      }
    }, 8000);
    conn.on('open', () => {
      opened = true;
      clearTimeout(timer);
      conn.send({ t: 'hello', name: this.name, quick: this.quick, playing: !!this.gameConn });
      this.status('Lobide bekliyorsun. Bir oyuncuya meydan oku veya otomatik eşleş.', 'online');
    });
    conn.on('data', (msg) => this.onHubMessage(msg));
    conn.on('close', () => {
      clearTimeout(timer);
      if (this.hubConn === conn) this.hubConn = null;
      if (this.closed) return;
      this.status('Lobi sunucusu değişiyor…', 'connecting');
      // Rastgele bekleme: ayni anda birden fazla istemcinin hub olmaya calismasini azaltir
      delay(500 + Math.random() * 2000).then(() => this.connectHub());
    });
    conn.on('error', () => { /* close olayinda ele alinir */ });
  }

  becomeHub() {
    if (this.closed || this.hubPeer) return;
    const hp = new Peer(HUB_ID, PEER_OPTS);
    this.hubPeer = hp;
    hp.on('open', () => {
      this.hubConn = null;
      delay(200).then(() => this.connectHub());
    });
    hp.on('connection', (conn) => this.hubAccept(conn));
    hp.on('error', (err) => {
      if (err && err.type === 'unavailable-id') {
        // Baska biri hub oldu -> ona baglan
        try { hp.destroy(); } catch (e) { /* yoksay */ }
        this.hubPeer = null;
        delay(400 + Math.random() * 800).then(() => this.connectHub());
      }
    });
    hp.on('disconnected', () => {
      try { hp.reconnect(); } catch (e) { /* yoksay */ }
    });
  }

  // ---------------- HUB (yalnizca hub olan istemcide calisir) ----------------
  hubAccept(conn) {
    conn.on('data', (msg) => this.hubHandle(conn, msg));
    conn.on('close', () => {
      this.hubClients.delete(conn.peer);
      this.hubBroadcast();
    });
    conn.on('error', () => {});
  }

  hubHandle(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const id = conn.peer;
    if (msg.t === 'hello') {
      this.hubClients.set(id, {
        name: String(msg.name || 'Oyuncu').slice(0, 16),
        conn,
        status: msg.playing ? 'playing' : 'waiting',
        quick: !!msg.quick
      });
      this.hubBroadcast();
      if (msg.quick) this.hubTryQuick(id);
      return;
    }
    const c = this.hubClients.get(id);
    if (!c) return;
    if (msg.t === 'quick') {
      c.quick = !!msg.on;
      this.hubBroadcast();
      if (c.quick) this.hubTryQuick(id);
    } else if (msg.t === 'status') {
      c.status = msg.playing ? 'playing' : 'waiting';
      if (msg.playing) c.quick = false;
      this.hubBroadcast();
    }
  }

  hubTryQuick(id) {
    const me = this.hubClients.get(id);
    if (!me || !me.quick || me.status !== 'waiting') return;
    for (const [oid, o] of this.hubClients) {
      if (oid !== id && o.quick && o.status === 'waiting') {
        me.quick = false;
        o.quick = false;
        me.status = 'playing';
        o.status = 'playing';
        // Daha once bekleyen (o) host olur ve baglantiyi baslatir
        try { o.conn.send({ t: 'match', opp: id, oppName: me.name, host: true }); } catch (e) { /* yoksay */ }
        try { me.conn.send({ t: 'match', opp: oid, oppName: o.name, host: false }); } catch (e) { /* yoksay */ }
        this.hubBroadcast();
        return;
      }
    }
  }

  hubBroadcast() {
    const players = [];
    for (const [id, c] of this.hubClients) {
      players.push({ id, name: c.name, status: c.status, quick: c.quick });
    }
    for (const c of this.hubClients.values()) {
      try { c.conn.send({ t: 'list', players }); } catch (e) { /* yoksay */ }
    }
  }

  // ---------------- ISTEMCI ----------------
  onHubMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'list') {
      this.players = (msg.players || []).filter((p) => p.id !== this.id);
      if (this.h.onList) this.h.onList(this.players);
    } else if (msg.t === 'match') {
      this.quick = false;
      if (msg.host) {
        this.status(msg.oppName + ' ile eşleşildi, bağlanılıyor…', 'online');
        const conn = this.peer.connect(msg.opp, {
          reliable: true,
          metadata: { type: 'match', name: this.name }
        });
        conn.on('open', () => this.startGame(conn, true, msg.oppName));
      } else {
        this.status(msg.oppName + ' ile eşleşildi, bağlantı bekleniyor…', 'online');
      }
    }
  }

  hubSend(msg) {
    if (this.hubConn && this.hubConn.open) {
      try { this.hubConn.send(msg); } catch (e) { /* yoksay */ }
    }
  }

  quickMatch(on = true) {
    this.quick = on;
    this.hubSend({ t: 'quick', on });
    this.status(on ? 'Rakip aranıyor… (otomatik eşleşme)' : 'Otomatik eşleşme iptal edildi.', 'online');
  }

  challenge(targetId) {
    if (!this.peer || !targetId || targetId === this.id) return;
    if (this.gameConn) return;
    this.status('Meydan okuma gönderildi, yanıt bekleniyor…', 'online');
    const conn = this.peer.connect(targetId, {
      reliable: true,
      metadata: { type: 'challenge', name: this.name }
    });
    this.pendingOut = conn;
    conn.on('data', (msg) => {
      if (!msg || this.gameConn) return;
      if (msg.t === 'accept') {
        this.pendingOut = null;
        this.startGame(conn, true, msg.name || 'Rakip');
      } else if (msg.t === 'decline') {
        this.pendingOut = null;
        this.status('Meydan okuma reddedildi.', 'online');
        if (this.h.onDeclined) this.h.onDeclined(msg.reason || 'Reddedildi');
        try { conn.close(); } catch (e) { /* yoksay */ }
      }
    });
    conn.on('close', () => {
      if (this.pendingOut === conn) this.pendingOut = null;
    });
  }

  onIncoming(conn) {
    const meta = conn.metadata || {};
    if (meta.type === 'match') {
      conn.on('open', () => this.startGame(conn, false, meta.name || 'Rakip'));
      return;
    }
    if (meta.type === 'challenge') {
      conn.on('open', () => {
        if (this.gameConn) {
          conn.send({ t: 'decline', reason: 'Oyuncu şu an oyunda' });
          return;
        }
        const accept = () => {
          conn.send({ t: 'accept', name: this.name });
          this.startGame(conn, false, meta.name || 'Rakip');
        };
        const decline = () => {
          try { conn.send({ t: 'decline' }); } catch (e) { /* yoksay */ }
        };
        if (this.h.onChallenge) this.h.onChallenge(meta.name || 'Rakip', accept, decline);
        else decline();
      });
    }
  }

  startGame(conn, host, oppName) {
    if (this.gameConn && this.gameConn !== conn) {
      try { conn.close(); } catch (e) { /* yoksay */ }
      return;
    }
    this.gameConn = conn;
    this.quick = false;
    this.hubSend({ t: 'status', playing: true });
    conn.on('data', (msg) => {
      if (this.gameConn === conn && this.h.onMessage) this.h.onMessage(msg);
    });
    conn.on('close', () => {
      if (this.gameConn !== conn) return;
      this.gameConn = null;
      this.hubSend({ t: 'status', playing: false });
      if (this.h.onOpponentLeft) this.h.onOpponentLeft();
    });
    if (this.h.onMatch) this.h.onMatch({ host, oppName });
  }

  send(msg) {
    if (this.gameConn && this.gameConn.open) {
      try { this.gameConn.send(msg); return true; } catch (e) { return false; }
    }
    return false;
  }

  leaveGame() {
    const c = this.gameConn;
    this.gameConn = null;
    if (c) {
      try { c.send({ t: 'bye' }); } catch (e) { /* yoksay */ }
      setTimeout(() => { try { c.close(); } catch (e) { /* yoksay */ } }, 150);
    }
    this.hubSend({ t: 'status', playing: false });
  }

  destroy() {
    this.closed = true;
    this.leaveGame();
    try { if (this.hubConn) this.hubConn.close(); } catch (e) { /* yoksay */ }
    try { if (this.hubPeer) this.hubPeer.destroy(); } catch (e) { /* yoksay */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* yoksay */ }
    this.hubConn = null;
    this.hubPeer = null;
    this.peer = null;
    this.hubClients.clear();
    this.players = [];
  }
}
