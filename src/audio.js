// X-Tavla ses (Web Audio API, dosya gerektirmez) ve titresim (Capacitor Haptics / navigator.vibrate)
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

let ctx = null;
let master = null;
let enabled = true;

export function setEnabled(v) {
  enabled = !!v;
  try { localStorage.setItem('xtavla.sound', enabled ? '1' : '0'); } catch (e) { /* yoksay */ }
}

export function isEnabled() {
  return enabled;
}

try {
  const saved = localStorage.getItem('xtavla.sound');
  if (saved !== null) enabled = saved === '1';
} catch (e) { /* yoksay */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Ilk kullanici etkilesiminde ses baglamini ac (mobil tarayici kisiti)
export function unlock() {
  const c = ac();
  if (!c) return;
  const b = c.createBuffer(1, 1, 22050);
  const src = c.createBufferSource();
  src.buffer = b;
  src.connect(master);
  src.start(0);
}

function noiseBurst(t, dur, freq, q, gain) {
  const c = ctx;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function tone(t, freq, dur, type = 'sine', gain = 0.3, endFreq) {
  const c = ctx;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const SOUNDS = {
  dice() {
    const t = ctx.currentTime;
    // zarlarin tahtada yuvarlanmasi: azalan araliklarla tiklama
    let dt = 0;
    for (let i = 0; i < 9; i++) {
      noiseBurst(t + dt, 0.04, 1800 + Math.random() * 1600, 6, 0.5 - i * 0.04);
      dt += 0.035 + i * 0.012;
    }
  },
  place() {
    const t = ctx.currentTime;
    noiseBurst(t, 0.06, 900, 3, 0.7);
    tone(t, 220, 0.08, 'triangle', 0.25, 140);
  },
  hit() {
    const t = ctx.currentTime;
    noiseBurst(t, 0.08, 600, 2, 0.9);
    tone(t, 330, 0.18, 'square', 0.12, 110);
  },
  bearoff() {
    const t = ctx.currentTime;
    tone(t, 660, 0.12, 'sine', 0.2);
    tone(t + 0.07, 990, 0.14, 'sine', 0.18);
  },
  select() {
    tone(ctx.currentTime, 880, 0.05, 'sine', 0.12);
  },
  error() {
    tone(ctx.currentTime, 180, 0.15, 'sawtooth', 0.1, 120);
  },
  turn() {
    tone(ctx.currentTime, 520, 0.1, 'triangle', 0.12, 640);
  },
  win() {
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, 0.3, 'triangle', 0.22));
  },
  lose() {
    const t = ctx.currentTime;
    [440, 370, 311, 262].forEach((f, i) => tone(t + i * 0.15, f, 0.32, 'sine', 0.2));
  }
};

export function play(name) {
  if (!enabled) return;
  const c = ac();
  if (!c || !SOUNDS[name]) return;
  try { SOUNDS[name](); } catch (e) { /* ses hatasi oyunu durdurmasin */ }
}

const native = (() => {
  try { return Capacitor.isNativePlatform(); } catch (e) { return false; }
})();

export async function haptic(kind = 'light') {
  if (!enabled) return;
  try {
    if (native) {
      if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
      else if (kind === 'error') await Haptics.notification({ type: NotificationType.Error });
      else await Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
      return;
    }
    if (navigator.vibrate) {
      const pattern = { light: 12, medium: 25, heavy: 45, success: [30, 40, 60], error: [60, 30, 60] }[kind] || 15;
      navigator.vibrate(pattern);
    }
  } catch (e) { /* desteklenmiyor */ }
}

export function fx(name, kind) {
  play(name);
  if (kind) haptic(kind);
}
