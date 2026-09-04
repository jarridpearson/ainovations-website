/* ============================================================================
   EMBERQUEST — core.js
   Constants, math, palette, pixel-art baker, bitmap font, input, audio synth.
   All art data is original. All melodies are original compositions.
   ========================================================================== */
(function (global) {
'use strict';

const EQ = global.EQ = global.EQ || {};

/* ---------------------------------------------------------------- constants */
const TILE   = 16;
const SCR_W  = 16;                 // play area width  in tiles
const SCR_H  = 11;                 // play area height in tiles
const HUD_H  = 64;                 // status bar height in px
const VIEW_W = SCR_W * TILE;       // 256
const VIEW_H = SCR_H * TILE;       // 176
const FB_W   = VIEW_W;             // 256
const FB_H   = HUD_H + VIEW_H;     // 240

EQ.K = { TILE, SCR_W, SCR_H, HUD_H, VIEW_W, VIEW_H, FB_W, FB_H };

/* --------------------------------------------------------------- math utils */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const sign  = v => v < 0 ? -1 : v > 0 ? 1 : 0;
const rnd   = (a, b) => a + Math.random() * (b - a);
const rndi  = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick  = arr => arr[(Math.random() * arr.length) | 0];
const dist  = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const aabb  = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* Deterministic hash-based RNG so generated terrain is stable across loads. */
function mulberry(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

EQ.util = { clamp, lerp, sign, rnd, rndi, pick, dist, aabb, mulberry };

/* ------------------------------------------------------------------ palette
   A modernised 36-colour palette. Sprites are authored as arrays of strings;
   each character indexes this table. '.' and ' ' are transparent.            */
const PAL = {
  '0': '#0d0b14', // outline / true black
  '1': '#241d33', // deep shadow
  '2': '#ffffff', // white
  '3': '#d3d8e6', // light grey
  '4': '#858da4', // mid grey
  '5': '#4a5064', // dark grey
  '6': '#ffdcb0', // skin light
  '7': '#eaa96d', // skin
  '8': '#a96a3c', // skin dark
  '9': '#8ceb72', // green light
  'a': '#43ad4a', // green
  'b': '#1e6b33', // green dark
  'c': '#ff9b78', // red light
  'd': '#e33a30', // red
  'e': '#8d191c', // red dark
  'f': '#8ed2ff', // blue light
  'g': '#2f80e6', // blue
  'h': '#193f92', // blue dark
  'i': '#ffeE8a', // yellow light
  'j': '#f6c32e', // yellow
  'k': '#ad7712', // yellow dark
  'l': '#d1965f', // brown light
  'm': '#8b5b2f', // brown
  'n': '#4e3018', // brown dark
  'o': '#d29bff', // purple light
  'p': '#7d41c4', // purple
  'q': '#3f1f6b', // purple dark
  'r': '#ff8f22', // orange
  's': '#37d0b6', // teal
  't': '#ff9ad8', // pink
  'u': '#ecd8a0', // sand
  'v': '#a3a9ba', // stone light
  'w': '#70768a', // stone
  'x': '#3e4356', // stone dark
  'y': '#57beff', // water light
  'z': '#1b52a6', // water dark
};
EQ.PAL = PAL;

/* Palette-swap tables: remap characters to recolour a sprite (red -> blue …) */
const SWAP = {
  none:   {},
  blue:   { d:'g', e:'h', c:'f', j:'f', k:'h' },
  red:    { g:'d', h:'e', f:'c' },
  gold:   { d:'j', e:'k', c:'i', g:'j', h:'k', f:'i' },
  grey:   { d:'4', e:'5', c:'3', g:'4', h:'5', f:'3', a:'4', b:'5', '9':'3' },
  purple: { d:'p', e:'q', c:'o', g:'p', h:'q', f:'o' },
  shadow: { d:'p', e:'q', c:'o', a:'p', b:'q', '9':'o', g:'p', h:'q', f:'o' },
};
EQ.SWAP = SWAP;

/* ------------------------------------------------------------ canvas helpers */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return c;
}
EQ.makeCanvas = makeCanvas;

/* Bake an array of equal-length strings into a canvas of 1px-per-char.
   opts: { swap, outline, shadow }                                            */
function bake(rows, opts) {
  opts = opts || {};
  const swap = opts.swap ? (SWAP[opts.swap] || opts.swap) : null;
  const h = rows.length, w = rows[0].length;
  const pad = opts.outline ? 1 : 0;
  const c = makeCanvas(w + pad * 2, h + pad * 2);
  const x = c.getContext('2d');
  const img = x.createImageData(c.width, c.height);
  const d = img.data;

  const put = (px, py, hex, alpha) => {
    if (px < 0 || py < 0 || px >= c.width || py >= c.height) return;
    const i = (py * c.width + px) * 4;
    d[i]     = parseInt(hex.slice(1, 3), 16);
    d[i + 1] = parseInt(hex.slice(3, 5), 16);
    d[i + 2] = parseInt(hex.slice(5, 7), 16);
    d[i + 3] = alpha === undefined ? 255 : alpha;
  };

  // optional 4-way outline pass first, so body pixels paint over it
  if (opts.outline) {
    const oc = opts.outline === true ? '#0d0b14' : opts.outline;
    for (let y = 0; y < h; y++) for (let px = 0; px < w; px++) {
      const ch = rows[y][px];
      if (ch === '.' || ch === ' ') continue;
      put(px + pad - 1, y + pad, oc); put(px + pad + 1, y + pad, oc);
      put(px + pad, y + pad - 1, oc); put(px + pad, y + pad + 1, oc);
    }
  }

  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let px = 0; px < w; px++) {
      let ch = row[px];
      if (ch === '.' || ch === ' ' || ch === undefined) continue;
      if (swap && swap[ch]) ch = swap[ch];
      const hex = PAL[ch];
      if (!hex) continue;
      put(px + pad, y + pad, hex);
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}
EQ.bake = bake;

/* Horizontal / vertical mirrors and 90-degree rotation of a baked canvas. */
function flipH(src) {
  const c = makeCanvas(src.width, src.height), x = c.getContext('2d');
  x.translate(src.width, 0); x.scale(-1, 1); x.drawImage(src, 0, 0);
  return c;
}
function flipV(src) {
  const c = makeCanvas(src.width, src.height), x = c.getContext('2d');
  x.translate(0, src.height); x.scale(1, -1); x.drawImage(src, 0, 0);
  return c;
}
function rot90(src) {
  const c = makeCanvas(src.height, src.width), x = c.getContext('2d');
  x.translate(src.height, 0); x.rotate(Math.PI / 2); x.drawImage(src, 0, 0);
  return c;
}
function tintCanvas(src, colour, amount) {
  const c = makeCanvas(src.width, src.height), x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.globalAlpha = amount === undefined ? 1 : amount;
  x.fillStyle = colour;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}
EQ.flipH = flipH; EQ.flipV = flipV; EQ.rot90 = rot90; EQ.tintCanvas = tintCanvas;

/* --------------------------------------------------------------------- font
   Original 5x7 bitmap face. Rendered white; tint at draw time.               */
const G = {};
G['A']=["01110","10001","10001","11111","10001","10001","10001"];
G['B']=["11110","10001","10001","11110","10001","10001","11110"];
G['C']=["01110","10001","10000","10000","10000","10001","01110"];
G['D']=["11110","10001","10001","10001","10001","10001","11110"];
G['E']=["11111","10000","10000","11110","10000","10000","11111"];
G['F']=["11111","10000","10000","11110","10000","10000","10000"];
G['G']=["01110","10001","10000","10111","10001","10001","01111"];
G['H']=["10001","10001","10001","11111","10001","10001","10001"];
G['I']=["11111","00100","00100","00100","00100","00100","11111"];
G['J']=["00111","00010","00010","00010","00010","10010","01100"];
G['K']=["10001","10010","10100","11000","10100","10010","10001"];
G['L']=["10000","10000","10000","10000","10000","10000","11111"];
G['M']=["10001","11011","10101","10101","10001","10001","10001"];
G['N']=["10001","11001","10101","10011","10001","10001","10001"];
G['O']=["01110","10001","10001","10001","10001","10001","01110"];
G['P']=["11110","10001","10001","11110","10000","10000","10000"];
G['Q']=["01110","10001","10001","10001","10101","10010","01101"];
G['R']=["11110","10001","10001","11110","10100","10010","10001"];
G['S']=["01111","10000","10000","01110","00001","00001","11110"];
G['T']=["11111","00100","00100","00100","00100","00100","00100"];
G['U']=["10001","10001","10001","10001","10001","10001","01110"];
G['V']=["10001","10001","10001","10001","10001","01010","00100"];
G['W']=["10001","10001","10001","10101","10101","11011","10001"];
G['X']=["10001","10001","01010","00100","01010","10001","10001"];
G['Y']=["10001","10001","01010","00100","00100","00100","00100"];
G['Z']=["11111","00001","00010","00100","01000","10000","11111"];
G['0']=["01110","10001","10011","10101","11001","10001","01110"];
G['1']=["00100","01100","00100","00100","00100","00100","01110"];
G['2']=["01110","10001","00001","00010","00100","01000","11111"];
G['3']=["11111","00010","00100","00010","00001","10001","01110"];
G['4']=["00010","00110","01010","10010","11111","00010","00010"];
G['5']=["11111","10000","11110","00001","00001","10001","01110"];
G['6']=["00110","01000","10000","11110","10001","10001","01110"];
G['7']=["11111","00001","00010","00100","01000","01000","01000"];
G['8']=["01110","10001","10001","01110","10001","10001","01110"];
G['9']=["01110","10001","10001","01111","00001","00010","01100"];
G[' ']=["00000","00000","00000","00000","00000","00000","00000"];
G['.']=["00000","00000","00000","00000","00000","01100","01100"];
G[',']=["00000","00000","00000","00000","01100","01100","11000"];
G['!']=["00100","00100","00100","00100","00100","00000","00100"];
G['?']=["01110","10001","00001","00010","00100","00000","00100"];
G["'"]=["00100","00100","01000","00000","00000","00000","00000"];
G['"']=["01010","01010","01010","00000","00000","00000","00000"];
G['-']=["00000","00000","00000","11111","00000","00000","00000"];
G['+']=["00000","00100","00100","11111","00100","00100","00000"];
G[':']=["00000","01100","01100","00000","01100","01100","00000"];
G[';']=["00000","01100","01100","00000","01100","01100","11000"];
G['/']=["00001","00010","00010","00100","01000","01000","10000"];
G['(']=["00010","00100","01000","01000","01000","00100","00010"];
G[')']=["01000","00100","00010","00010","00010","00100","01000"];
G['<']=["00010","00100","01000","10000","01000","00100","00010"];
G['>']=["01000","00100","00010","00001","00010","00100","01000"];
G['=']=["00000","00000","11111","00000","11111","00000","00000"];
G['*']=["00000","10101","01110","11111","01110","10101","00000"];
G['#']=["01010","01010","11111","01010","11111","01010","01010"];
G['$']=["00100","01111","10100","01110","00101","11110","00100"];
G['%']=["11001","11010","00010","00100","01000","01011","10011"];
G['&']=["01100","10010","10010","01100","10101","10010","01101"];
G['^']=["00100","01010","10001","00000","00000","00000","00000"];  // up arrow-ish
G['_']=["00000","00000","00000","00000","00000","00000","11111"];

const FONT_W = 5, FONT_H = 7, FONT_ADV = 6, FONT_LINE = 9;
let fontSheet = null, fontIndex = {};

function buildFont() {
  const keys = Object.keys(G);
  const sheet = makeCanvas(keys.length * FONT_W, FONT_H);
  const x = sheet.getContext('2d');
  const img = x.createImageData(sheet.width, sheet.height);
  const d = img.data;
  keys.forEach((k, gi) => {
    fontIndex[k] = gi;
    const rows = G[k];
    for (let ry = 0; ry < FONT_H; ry++) {
      for (let rx = 0; rx < FONT_W; rx++) {
        if (rows[ry][rx] !== '1') continue;
        const px = gi * FONT_W + rx;
        const i = (ry * sheet.width + px) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255;
      }
    }
  });
  x.putImageData(img, 0, 0);
  fontSheet = sheet;
}

const fontCache = {};
function fontFor(colour) {
  if (!fontSheet) buildFont();
  if (!fontCache[colour]) fontCache[colour] = tintCanvas(fontSheet, colour, 1);
  return fontCache[colour];
}

/* Draw text. Supports \n. Returns width of the widest line drawn. */
function drawText(ctx, str, x, y, colour, opts) {
  opts = opts || {};
  if (!fontSheet) buildFont();
  const sheet = fontFor(colour || '#ffffff');
  const adv = opts.adv || FONT_ADV;
  const line = opts.line || FONT_LINE;
  const s = String(str).toUpperCase();
  let cx = x, cy = y, widest = 0, lineW = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\n') { widest = Math.max(widest, lineW); lineW = 0; cx = x; cy += line; continue; }
    const gi = fontIndex[ch];
    if (gi !== undefined && ch !== ' ') {
      ctx.drawImage(sheet, gi * FONT_W, 0, FONT_W, FONT_H, cx, cy, FONT_W, FONT_H);
    }
    cx += adv; lineW += adv;
  }
  return Math.max(widest, lineW);
}
function textWidth(str, adv) {
  adv = adv || FONT_ADV;
  const lines = String(str).split('\n');
  return Math.max.apply(null, lines.map(l => l.length * adv));
}
function drawTextCentered(ctx, str, cx, y, colour, opts) {
  const lines = String(str).split('\n');
  const line = (opts && opts.line) || FONT_LINE;
  lines.forEach((l, i) => {
    const w = textWidth(l, opts && opts.adv);
    drawText(ctx, l, Math.round(cx - w / 2), y + i * line, colour, opts);
  });
}
EQ.text = { draw: drawText, width: textWidth, centered: drawTextCentered, H: FONT_H, ADV: FONT_ADV, LINE: FONT_LINE };

/* -------------------------------------------------------------------- input */
const Input = {
  held: {}, pressed: {}, released: {},
  _map: {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
    KeyZ: 'b', KeyJ: 'b', Space: 'b',
    KeyX: 'a', KeyK: 'a',
    Enter: 'start', KeyP: 'start',
    ShiftLeft: 'select', ShiftRight: 'select', Tab: 'select', KeyI: 'select',
    KeyM: 'mute',
  },
  _pad: null,
  init() {
    addEventListener('keydown', e => {
      const b = this._map[e.code];
      if (b) {
        e.preventDefault();
        if (!this.held[b]) this.pressed[b] = true;
        this.held[b] = true;
      }
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      EQ.audio && EQ.audio.unlock();
    }, { passive: false });
    addEventListener('keyup', e => {
      const b = this._map[e.code];
      if (b) { e.preventDefault(); this.held[b] = false; this.released[b] = true; }
    }, { passive: false });
    addEventListener('blur', () => { this.held = {}; });
    addEventListener('gamepadconnected', e => { this._pad = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this._pad = null; });
  },
  /* Virtual buttons for touch controls */
  set(btn, down) {
    if (down) { if (!this.held[btn]) this.pressed[btn] = true; this.held[btn] = true; }
    else { if (this.held[btn]) this.released[btn] = true; this.held[btn] = false; }
  },
  pollPad() {
    if (this._pad === null || !navigator.getGamepads) return;
    const gp = navigator.getGamepads()[this._pad];
    if (!gp) return;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, DZ = 0.4;
    const map = {
      up: gp.buttons[12] && gp.buttons[12].pressed || ay < -DZ,
      down: gp.buttons[13] && gp.buttons[13].pressed || ay > DZ,
      left: gp.buttons[14] && gp.buttons[14].pressed || ax < -DZ,
      right: gp.buttons[15] && gp.buttons[15].pressed || ax > DZ,
      a: gp.buttons[0] && gp.buttons[0].pressed,
      b: gp.buttons[2] && gp.buttons[2].pressed || (gp.buttons[1] && gp.buttons[1].pressed),
      start: gp.buttons[9] && gp.buttons[9].pressed,
      select: gp.buttons[8] && gp.buttons[8].pressed,
    };
    for (const k in map) this.set(k, !!map[k]);
  },
  endFrame() { this.pressed = {}; this.released = {}; },
  dir() {
    let dx = 0, dy = 0;
    if (this.held.left) dx--; if (this.held.right) dx++;
    if (this.held.up) dy--; if (this.held.down) dy++;
    return { dx, dy };
  }
};
EQ.Input = Input;

/* -------------------------------------------------------------------- audio
   Tiny chiptune engine: 2 pulse channels, 1 triangle bass, 1 noise channel.
   All melodies below are original compositions written for this project.     */
const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteFreq(name) {
  if (!name || name === '-') return 0;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return 0;
  let semi = NOTE_BASE[m[1]];
  if (m[2] === '#') semi++; if (m[2] === 'b') semi--;
  const oct = parseInt(m[3], 10);
  return 440 * Math.pow(2, (semi - 9) / 12 + (oct - 4));
}

const Audio_ = {
  ctx: null, master: null, musicGain: null, sfxGain: null,
  muted: false, _track: null, _timer: null, _step: 0, _noiseBuf: null,
  enabled: true,

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.34;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.7;
    this.sfxGain.connect(this.master);
    // white-noise buffer for percussion / explosions
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const dat = buf.getChannelData(0);
    for (let i = 0; i < len; i++) dat[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    if (this._pendingTrack) { const t = this._pendingTrack; this._pendingTrack = null; this.music(t); }
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  },

  /* --- one-shot tone ----------------------------------------------------- */
  tone(o) {
    if (!this.enabled) return;
    this.unlock(); if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + (o.delay || 0);
    const dur = o.dur || 0.1;
    const g = this.ctx.createGain();
    g.connect(o.bus || this.sfxGain);
    const vol = o.vol === undefined ? 0.3 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let src;
    if (o.type === 'noise') {
      src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf; src.loop = true;
      if (o.filter !== false) {
        const f = this.ctx.createBiquadFilter();
        f.type = o.filterType || 'bandpass';
        f.frequency.setValueAtTime(o.freq || 1200, t0);
        if (o.freq2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freq2), t0 + dur);
        f.Q.value = o.q === undefined ? 1.2 : o.q;
        src.connect(f); f.connect(g);
      } else src.connect(g);
    } else {
      src = this.ctx.createOscillator();
      src.type = o.type || 'square';
      src.frequency.setValueAtTime(o.freq || 440, t0);
      if (o.freq2) src.frequency.exponentialRampToValueAtTime(Math.max(20, o.freq2), t0 + dur);
      if (o.vibrato) {
        const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
        lfo.frequency.value = o.vibrato; lg.gain.value = o.vibDepth || 8;
        lfo.connect(lg); lg.connect(src.frequency); lfo.start(t0); lfo.stop(t0 + dur);
      }
      src.connect(g);
    }
    src.start(t0); src.stop(t0 + dur + 0.02);
  },

  /* --- sound effects ----------------------------------------------------- */
  sfx(name) {
    if (!this.enabled) return;
    const T = (o) => this.tone(o);
    switch (name) {
      case 'sword':      T({ type:'square',   freq:880,  freq2:180,  dur:0.09, vol:0.20 });
                         T({ type:'noise',    freq:3000, freq2:800,  dur:0.07, vol:0.10 }); break;
      case 'beam':       T({ type:'sawtooth', freq:520,  freq2:1600, dur:0.16, vol:0.16 }); break;
      case 'hit':        T({ type:'square',   freq:180,  freq2:60,   dur:0.09, vol:0.22 });
                         T({ type:'noise',    freq:900,  freq2:200,  dur:0.09, vol:0.14 }); break;
      case 'enemyDie':   T({ type:'noise',    freq:2400, freq2:220,  dur:0.20, vol:0.20 });
                         T({ type:'square',   freq:420,  freq2:90,   dur:0.16, vol:0.10 }); break;
      case 'bossHit':    T({ type:'square',   freq:120,  freq2:48,   dur:0.16, vol:0.26 }); break;
      case 'playerHurt': T({ type:'sawtooth', freq:420,  freq2:110,  dur:0.26, vol:0.26 });
                         T({ type:'square',   freq:220,  freq2:70,   dur:0.24, vol:0.16, delay:0.02 }); break;
      case 'lowHealth':  T({ type:'square',   freq:1180, dur:0.05, vol:0.09 });
                         T({ type:'square',   freq:1180, dur:0.05, vol:0.09, delay:0.10 }); break;
      case 'rupee':      T({ type:'square',   freq:1320, dur:0.05, vol:0.14 });
                         T({ type:'square',   freq:1760, dur:0.07, vol:0.14, delay:0.05 }); break;
      case 'heart':      T({ type:'triangle', freq:880,  dur:0.07, vol:0.20 });
                         T({ type:'triangle', freq:1320, dur:0.10, vol:0.20, delay:0.07 }); break;
      case 'key':        T({ type:'square',   freq:1046, dur:0.06, vol:0.16 });
                         T({ type:'square',   freq:1568, dur:0.10, vol:0.16, delay:0.06 }); break;
      case 'bomb':       T({ type:'noise',    freq:1100, freq2:60, dur:0.42, vol:0.34, q:0.6 });
                         T({ type:'triangle', freq:120,  freq2:30, dur:0.36, vol:0.22 }); break;
      case 'bombDrop':   T({ type:'square',   freq:300,  freq2:180, dur:0.07, vol:0.12 }); break;
      case 'boomerang':  T({ type:'square',   freq:700,  dur:0.045, vol:0.09, vibrato:26, vibDepth:180 }); break;
      case 'arrow':      T({ type:'noise',    freq:2600, freq2:900, dur:0.09, vol:0.14 }); break;
      case 'fire':       T({ type:'noise',    freq:700,  freq2:1900, dur:0.22, vol:0.14, q:0.5 }); break;
      case 'magic':      T({ type:'sawtooth', freq:300,  freq2:2000, dur:0.24, vol:0.14 }); break;
      case 'door':       T({ type:'noise',    freq:340,  freq2:120, dur:0.34, vol:0.18, q:0.7 }); break;
      case 'shutter':    T({ type:'noise',    freq:520,  freq2:150, dur:0.30, vol:0.20, q:0.8 });
                         T({ type:'square',   freq:150,  freq2:60,  dur:0.26, vol:0.12 }); break;
      case 'secret':     ['E5','G5','B5','E6'].forEach((n, i) =>
                           T({ type:'triangle', freq:noteFreq(n), dur:0.22, vol:0.20, delay:i*0.085 })); break;
      case 'item':       ['C5','E5','G5','C6','G5','C6'].forEach((n, i) =>
                           T({ type:'square', freq:noteFreq(n), dur:0.15, vol:0.17, delay:i*0.09 })); break;
      case 'stairs':     T({ type:'square', freq:200, freq2:900, dur:0.30, vol:0.14 }); break;
      case 'menu':       T({ type:'square', freq:660, dur:0.04, vol:0.11 }); break;
      case 'select':     T({ type:'square', freq:990, dur:0.06, vol:0.13 }); break;
      case 'refill':     T({ type:'square', freq:1400, dur:0.03, vol:0.08 }); break;
      case 'text':       T({ type:'square', freq:1500, dur:0.014, vol:0.05 }); break;
      case 'shieldBlock':T({ type:'square', freq:1400, freq2:900, dur:0.05, vol:0.14 });
                         T({ type:'noise',  freq:4000, freq2:2000, dur:0.05, vol:0.10 }); break;
      case 'recorder':   ['A5','F5','D5','A5','F5','D5'].forEach((n,i) =>
                           T({ type:'triangle', freq:noteFreq(n), dur:0.20, vol:0.20, delay:i*0.14 })); break;
      case 'bossRoar':   T({ type:'sawtooth', freq:140, freq2:52, dur:0.7, vol:0.24, vibrato:9, vibDepth:22 });
                         T({ type:'noise',    freq:420, freq2:120, dur:0.7, vol:0.16, q:0.5 }); break;
      case 'triforce':   ['C5','D5','E5','F5','G5','A5','B5','C6'].forEach((n,i) =>
                           T({ type:'triangle', freq:noteFreq(n), dur:0.24, vol:0.20, delay:i*0.11 })); break;
      case 'error':      T({ type:'square', freq:180, freq2:120, dur:0.12, vol:0.14 }); break;
      case 'push':       T({ type:'noise', freq:300, freq2:180, dur:0.20, vol:0.12, q:0.6 }); break;
      case 'burn':       T({ type:'noise', freq:500, freq2:2200, dur:0.35, vol:0.16, q:0.4 }); break;
      case 'whistleWarp':T({ type:'sawtooth', freq:200, freq2:2400, dur:0.6, vol:0.16 }); break;
    }
  },

  /* --- music sequencer ---------------------------------------------------- */
  music(name) {
    if (!this.enabled) return;
    if (this._trackName === name) return;
    this._trackName = name;
    this.stopMusic(true);
    if (!name) return;
    if (!this.ctx) { this._pendingTrack = name; return; }
    const trk = EQ.MUSIC && EQ.MUSIC[name];
    if (!trk) return;
    this._track = trk; this._step = 0;
    const stepMs = 60000 / (trk.tempo * 4);   // 16th notes
    const tick = () => {
      if (!this._track) return;
      this._playStep();
      this._step++;
      const len = this._track.len;
      if (this._step >= len) { if (this._track.loop === false) { this.stopMusic(); return; } this._step = 0; }
    };
    tick();
    this._timer = setInterval(tick, stepMs);
  },
  _playStep() {
    const trk = this._track, s = this._step;
    if (!trk) return;
    trk.ch.forEach(c => {
      const cell = c.seq[s % c.seq.length];
      if (!cell || cell === '.') return;
      if (c.wave === 'noise') {
        this.tone({ type:'noise', freq: cell === 'x' ? 5200 : 1400, freq2: cell === 'x' ? 2400 : 300,
                    dur: c.dur || 0.06, vol: (c.vol || 0.14), bus: this.musicGain, q: 0.8 });
        return;
      }
      const f = noteFreq(cell);
      if (!f) return;
      this.tone({ type: c.wave || 'square', freq: f, dur: c.dur || 0.14,
                  vol: c.vol || 0.16, bus: this.musicGain });
    });
  },
  stopMusic(keepName) {
    if (this._timer) clearInterval(this._timer);
    this._timer = null; this._track = null;
    if (!keepName) this._trackName = null;
  },
  fanfare(name) { this.stopMusic(); this.sfx(name); }
};
EQ.audio = Audio_;
EQ.noteFreq = noteFreq;

})(window);
