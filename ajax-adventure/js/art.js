/* ============================================================================
   EMBERQUEST — art.js
   Tile atlas. Every tile is painted procedurally at 16x16 so the whole world
   ships as code, not as ripped graphics. Modernised look: soft gradients,
   speckle texture, rim light, animated water.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;
const { makeCanvas, bake, util } = EQ;
const { mulberry } = util;
const TS = 16;

/* ---------------------------------------------------------------- tile ids */
const T = EQ.T = {
  GROUND: 0, SAND: 1, BUSH: 2, TREE: 3, MTN: 4, WATER: 5, ROCK: 6,
  BRIDGE: 7, STAIRS: 8, DUNGEON: 9, GRAVE: 10, DOCK: 11, ARMOS: 12,
  WFALL: 13, CAVE: 14, PATH: 15,
  DFLOOR: 20, DWALL: 21, DBLOCK: 22, DWATER: 23, DSTATUE: 24, DSTAIRS: 25,
  DVOID: 26, DSAND: 27, DFIRE: 28, DOOR: 29, DBLOCKP: 30, DRUG: 31,
};

/* Which tiles stop the player. Overridden per-item (ladder, raft…) in world. */
const SOLID = EQ.SOLID = {};
[T.BUSH, T.TREE, T.MTN, T.WATER, T.ROCK, T.GRAVE, T.ARMOS, T.WFALL,
 T.DWALL, T.DBLOCK, T.DWATER, T.DSTATUE, T.DVOID, T.DBLOCKP].forEach(t => SOLID[t] = true);

/* ------------------------------------------------------------ paint helpers */
function px(x, w, h, col) { x.fillStyle = col; x.fillRect(0, 0, w, h); }

function speckle(x, rng, colours, n, alpha) {
  x.globalAlpha = alpha === undefined ? 1 : alpha;
  for (let i = 0; i < n; i++) {
    x.fillStyle = colours[(rng() * colours.length) | 0];
    const sx = (rng() * TS) | 0, sy = (rng() * TS) | 0;
    const sw = rng() < 0.75 ? 1 : 2;
    x.fillRect(sx, sy, sw, 1);
  }
  x.globalAlpha = 1;
}

function vgrad(x, top, bot, w, h) {
  const g = x.createLinearGradient(0, 0, 0, h || TS);
  g.addColorStop(0, top); g.addColorStop(1, bot);
  x.fillStyle = g; x.fillRect(0, 0, w || TS, h || TS);
}

/* Rounded-ish blob used for bushes / boulders. */
function blob(x, cx, cy, rx, ry, col) {
  x.fillStyle = col;
  for (let yy = -ry; yy <= ry; yy++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry))));
    x.fillRect(Math.round(cx - w), Math.round(cy + yy), w * 2, 1);
  }
}

/* -------------------------------------------------------------- biome table */
const BIOME = EQ.BIOME = {
  grass:  { g0:'#4f9a3c', g1:'#3d7a2e', sp:['#63b04c','#356b28','#79c25c'],
            bush:'#2f7a35', bushHi:'#4fa64b', tree:'#2d6b30', treeHi:'#4a9440',
            trunk:'#5d3c1c', mtn:'#7b7f92', mtnHi:'#a6aabb', mtnLo:'#4a4e60' },
  forest: { g0:'#3d7a35', g1:'#2c5c28', sp:['#4e9040','#22491f','#5aa04a'],
            bush:'#255f2b', bushHi:'#3f8b3d', tree:'#1f5426', treeHi:'#357a33',
            trunk:'#4a2f16', mtn:'#6a7084', mtnHi:'#949aad', mtnLo:'#3e4354' },
  desert: { g0:'#d9c084', g1:'#bda269', sp:['#e8d29a','#ab9058','#f0ddab'],
            bush:'#8d9a4a', bushHi:'#b3bf68', tree:'#6f7a3c', treeHi:'#96a253',
            trunk:'#6a4a22', mtn:'#a4906b', mtnHi:'#c8b48c', mtnLo:'#6d5c40' },
  mount:  { g0:'#7e8496', g1:'#5f6577', sp:['#98a0b0','#4c5264','#aab0c0'],
            bush:'#4d6b48', bushHi:'#6d8f60', tree:'#3a5c3a', treeHi:'#547a4c',
            trunk:'#4a3520', mtn:'#8a8fa2', mtnHi:'#b4b9c9', mtnLo:'#53586a' },
  grave:  { g0:'#4a5a6b', g1:'#36414f', sp:['#5c6d80','#2a3340','#6d7f92'],
            bush:'#3d5c46', bushHi:'#568060', tree:'#2c4a38', treeHi:'#3f6a4e',
            trunk:'#3c2c1c', mtn:'#6d7488', mtnHi:'#949bb0', mtnLo:'#41465a' },
  coast:  { g0:'#c9b988', g1:'#a89a6d', sp:['#ded0a2','#8e8158','#e9dcb0'],
            bush:'#4f8a45', bushHi:'#6fae5e', tree:'#2f6b34', treeHi:'#4a9440',
            trunk:'#5d3c1c', mtn:'#8b8fa0', mtnHi:'#b0b5c4', mtnLo:'#565b6c' },
};

/* -------------------------------------------------------------- tile paints */
function mix(a, b, t) {
  const pa = [1,3,5].map(i => parseInt(a.substr(i, 2), 16));
  const pb = [1,3,5].map(i => parseInt(b.substr(i, 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/* Ground must tile seamlessly, so it is flat colour plus noise - no gradient.
   Three variants are baked and chosen by position so a field never repeats
   into an obvious grid. */
function tGround(b, seed, variant) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed + variant * 613);
  const base = mix(b.g0, b.g1, 0.40 + variant * 0.015);
  px(x, TS, TS, base);
  speckle(x, rng, b.sp, 30, 0.30);
  x.globalAlpha = 0.22; x.fillStyle = b.sp[0];
  for (let i = 0; i < 2 + variant; i++) {
    const sx = (rng() * 13) | 0, sy = (rng() * 13) | 0;
    x.fillRect(sx + 1, sy, 1, 2); x.fillRect(sx, sy + 1, 3, 1);
  }
  x.globalAlpha = 1;
  return c;
}

function tPath(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed);
  px(x, TS, TS, '#b59a6c');
  speckle(x, rng, ['#d6c091', '#8d7850', '#e2cfa4'], 34, 0.42);
  return c;
}

function tSand(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed);
  px(x, TS, TS, '#d8c68f');
  speckle(x, rng, ['#f2e4b8', '#b09a68'], 26, 0.35);
  x.globalAlpha = 0.3; x.strokeStyle = '#b09a68'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(0, 6.5); x.bezierCurveTo(5, 4.5, 10, 8.5, 16, 6.5); x.stroke();
  x.beginPath(); x.moveTo(0, 12.5); x.bezierCurveTo(6, 10.5, 11, 14.5, 16, 12.5); x.stroke();
  x.globalAlpha = 1;
  return c;
}

function tBush(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed);
  px(x, TS, TS, mix(b.g0, b.g1, 0.4));
  speckle(x, rng, b.sp, 16, 0.25);
  x.fillStyle = '#00000033'; x.fillRect(2, 13, 12, 2);
  blob(x, 8, 8, 7, 6, b.bush);
  // leaf clusters
  x.fillStyle = b.bushHi;
  [[4,5],[8,3],[12,6],[5,9],[11,10],[8,7]].forEach(p => {
    x.fillRect(p[0] - 1, p[1], 3, 2); x.fillRect(p[0], p[1] - 1, 1, 4);
  });
  x.fillStyle = '#00000055';
  x.fillRect(3, 11, 10, 1); x.fillRect(5, 12, 6, 1);
  return c;
}

function tTree(b, seed, variant) {
  variant = variant || 0;
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed + variant * 331);
  px(x, TS, TS, mix(b.g0, b.g1, 0.4));
  speckle(x, rng, b.sp, 12, 0.20);
  // ground shadow + trunk
  x.fillStyle = 'rgba(0,0,0,0.28)';
  x.beginPath(); x.ellipse(8, 14, 6, 2, 0, 0, 6.28); x.fill();
  x.fillStyle = b.trunk; x.fillRect(7, 11, 3, 4);
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(9, 11, 1, 4);
  // canopy: dark rim ring, mid body, lit clumps on the upper left
  blob(x, 8, 7, 8, 7, mix(b.tree, '#000000', 0.45));
  blob(x, 8, 7, 7, 6, b.tree);
  const clumps = variant ? [[5,4],[10,4],[4,8],[11,8],[8,6],[7,10]]
                         : [[6,3],[10,5],[4,7],[11,9],[7,6],[9,10]];
  clumps.forEach(pp => blob(x, pp[0], pp[1], 2, 2, b.treeHi));
  clumps.forEach(pp => blob(x, pp[0] + 1, pp[1] + 2, 1, 1, mix(b.tree, '#000000', 0.35)));
  // underside shade so the canopy reads round
  x.fillStyle = 'rgba(0,0,0,0.26)';
  blob(x, 8, 11, 6, 2, 'rgba(0,0,0,0.26)');
  return c;
}

/* Rock face. Randomised facets, three variants, and no per-tile border so a
   run of them merges into a single cliff mass. */
function tMtn(b, seed, variant) {
  variant = variant || 0;
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed + variant * 877);
  px(x, TS, TS, b.mtn);
  for (let i = 0; i < 8; i++) {
    const ox = rng() * 16, oy = rng() * 16, r = 2 + rng() * 4.5;
    x.fillStyle = rng() < 0.5 ? b.mtnHi : b.mtnLo;
    x.globalAlpha = 0.35 + rng() * 0.4;
    const n = 4 + ((rng() * 3) | 0);
    x.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.28, rr = r * (0.65 + rng() * 0.7);
      const vx = ox + Math.cos(a) * rr, vy = oy + Math.sin(a) * rr;
      k ? x.lineTo(vx, vy) : x.moveTo(vx, vy);
    }
    x.closePath(); x.fill();
  }
  x.globalAlpha = 1;
  speckle(x, rng, [b.mtnHi, b.mtnLo], 16, 0.35);
  // a base shade gives a stack of these tiles some depth
  x.fillStyle = 'rgba(0,0,0,0.16)'; x.fillRect(0, 13, 16, 3);
  x.fillStyle = 'rgba(255,255,255,0.07)'; x.fillRect(0, 0, 16, 2);
  return c;
}

function tRock(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed);
  px(x, TS, TS, mix(b.g0, b.g1, 0.4));
  x.fillStyle = '#00000038'; blob(x, 8, 13, 7, 2, '#00000038');
  blob(x, 8, 8, 6, 6, b.mtn);
  blob(x, 7, 6, 4, 3, b.mtnHi);
  x.fillStyle = b.mtnLo; x.fillRect(3, 10, 10, 2); x.fillRect(5, 12, 7, 1);
  x.fillStyle = '#ffffff33'; x.fillRect(5, 4, 3, 1);
  x.strokeStyle = '#0d0b14aa'; x.lineWidth = 1; x.strokeRect(1.5, 2.5, 13, 11);
  return c;
}

function tWater(b, seed, frame) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed + frame * 977);
  vgrad(x, '#2f7fd4', '#15458f');
  x.globalAlpha = 0.5; x.fillStyle = '#57beff';
  const off = frame * 4;
  for (let i = 0; i < 3; i++) {
    const yy = 3 + i * 5, xx = ((i * 6 + off) % 16);
    x.fillRect(xx, yy, 4, 1); x.fillRect((xx + 8) % 16, yy + 2, 3, 1);
  }
  x.globalAlpha = 0.28; x.fillStyle = '#bde6ff';
  x.fillRect((2 + off) % 16, 6, 2, 1); x.fillRect((10 + off) % 16, 12, 2, 1);
  x.globalAlpha = 1;
  return c;
}

function tWfall(b, seed, frame) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, '#4aa5ea', '#1c58ac');
  x.fillStyle = '#bde6ff'; x.globalAlpha = 0.7;
  for (let i = 0; i < 4; i++) {
    const xx = 1 + i * 4;
    x.fillRect(xx, ((frame * 5 + i * 4) % 16), 2, 6);
    x.fillRect(xx, ((frame * 5 + i * 4 + 8) % 16), 2, 4);
  }
  x.globalAlpha = 1;
  return c;
}

function tBridge(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, '#2f7fd4', '#15458f');
  x.fillStyle = '#a5794a'; x.fillRect(0, 2, 16, 12);
  x.fillStyle = '#8a6238';
  for (let i = 0; i < 4; i++) x.fillRect(0, 3 + i * 3, 16, 1);
  x.fillStyle = '#c99a63'; x.fillRect(0, 2, 16, 1);
  x.fillStyle = '#5d4223'; x.fillRect(0, 13, 16, 1);
  return c;
}

function tDock(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, '#2f7fd4', '#15458f');
  x.fillStyle = '#a5794a'; x.fillRect(2, 0, 12, 16);
  x.fillStyle = '#8a6238';
  for (let i = 0; i < 5; i++) x.fillRect(2, i * 3 + 1, 12, 1);
  x.fillStyle = '#5d4223'; x.fillRect(2, 0, 1, 16); x.fillRect(13, 0, 1, 16);
  return c;
}

function tStairs(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  px(x, TS, TS, mix(b.g0, b.g1, 0.4));
  x.fillStyle = '#1a1626'; x.fillRect(2, 2, 12, 12);
  const steps = ['#8a90a4', '#6d7386', '#525869', '#3a3f4e'];
  for (let i = 0; i < 4; i++) { x.fillStyle = steps[i]; x.fillRect(3, 3 + i * 3, 10, 3); }
  x.fillStyle = '#0d0b14'; x.fillRect(3, 3, 10, 1);
  x.strokeStyle = '#0d0b14'; x.strokeRect(1.5, 1.5, 13, 13);
  return c;
}

function tCave(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, b.mtnHi, b.mtn);
  x.fillStyle = b.mtnLo;
  x.beginPath(); x.moveTo(0, 16); x.lineTo(0, 8); x.lineTo(8, 2); x.lineTo(16, 8);
  x.lineTo(16, 16); x.closePath(); x.fill();
  // dark mouth
  x.fillStyle = '#080610';
  x.beginPath(); x.moveTo(4, 16); x.lineTo(4, 9); x.arc(8, 9, 4, Math.PI, 0); x.lineTo(12, 16);
  x.closePath(); x.fill();
  x.strokeStyle = '#00000088'; x.lineWidth = 1; x.stroke();
  x.fillStyle = '#ffffff22'; x.fillRect(5, 8, 1, 6);
  return c;
}

function tDungeon(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, '#8a90a4', '#5b6072');
  x.fillStyle = '#41465a';
  for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++)
    x.fillRect(q * 4 + ((r % 2) ? 2 : 0), r * 4, 3, 3);
  x.fillStyle = '#0a0812';
  x.beginPath(); x.moveTo(4, 16); x.lineTo(4, 8); x.arc(8, 8, 4, Math.PI, 0); x.lineTo(12, 16);
  x.closePath(); x.fill();
  x.strokeStyle = '#c8a94a'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(3.5, 16); x.lineTo(3.5, 8); x.arc(8, 8, 4.5, Math.PI, 0);
  x.lineTo(12.5, 16); x.stroke();
  return c;
}

function tGrave(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  px(x, TS, TS, mix(b.g0, b.g1, 0.4));
  x.fillStyle = '#00000044'; x.fillRect(3, 13, 10, 2);
  x.fillStyle = '#9aa0b0';
  x.beginPath(); x.moveTo(4, 15); x.lineTo(4, 6); x.arc(8, 6, 4, Math.PI, 0); x.lineTo(12, 15);
  x.closePath(); x.fill();
  x.fillStyle = '#6b7183'; x.fillRect(9, 3, 3, 12);
  x.fillStyle = '#5a5f70'; x.fillRect(6, 6, 4, 1); x.fillRect(7, 9, 2, 1);
  x.strokeStyle = '#2b2f3c'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(3.5, 15); x.lineTo(3.5, 6); x.arc(8, 6, 4.5, Math.PI, 0);
  x.lineTo(12.5, 15); x.stroke();
  return c;
}

function tArmos(b, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  px(x, TS, TS, mix(b.g0, b.g1, 0.4));
  x.fillStyle = '#00000044'; x.fillRect(3, 14, 10, 2);
  x.fillStyle = '#8f7a58'; x.fillRect(4, 3, 8, 12);
  x.fillStyle = '#b09a72'; x.fillRect(4, 3, 8, 2); x.fillRect(4, 3, 2, 12);
  x.fillStyle = '#5e4f38'; x.fillRect(10, 5, 2, 10);
  x.fillStyle = '#2b2419'; x.fillRect(6, 6, 2, 2); x.fillRect(9, 6, 2, 2);
  x.fillStyle = '#2b2419'; x.fillRect(6, 10, 5, 1);
  x.strokeStyle = '#1c170f'; x.strokeRect(3.5, 2.5, 9, 13);
  return c;
}

/* ------------------------------------------------------------ dungeon tiles */
function dFloor(pal, seed, variant) {
  variant = variant || 0;
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed + variant * 419);
  px(x, TS, TS, mix(pal.f0, pal.f1, 0.35 + variant * 0.12));
  speckle(x, rng, [pal.fl, pal.fd], 12, 0.20);
  return c;
}

function dWall(pal, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, pal.w0, pal.w1);
  x.fillStyle = pal.wd;
  x.fillRect(0, 7, 16, 1); x.fillRect(0, 15, 16, 1);
  x.fillRect(7, 0, 1, 8); x.fillRect(3, 8, 1, 8); x.fillRect(11, 8, 1, 8);
  x.fillStyle = pal.wl;
  x.fillRect(0, 0, 7, 1); x.fillRect(8, 0, 8, 1);
  x.fillRect(0, 8, 3, 1); x.fillRect(4, 8, 7, 1); x.fillRect(12, 8, 4, 1);
  return c;
}

function dBlock(pal, seed, push) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, pal.b0, pal.b1);
  x.strokeStyle = pal.wd; x.lineWidth = 1; x.strokeRect(0.5, 0.5, 15, 15);
  x.fillStyle = pal.wl; x.fillRect(2, 2, 12, 1); x.fillRect(2, 2, 1, 12);
  x.fillStyle = pal.wd; x.fillRect(3, 13, 11, 1); x.fillRect(13, 3, 1, 11);
  x.fillStyle = pal.bm; x.fillRect(5, 5, 6, 6);
  if (push) { x.fillStyle = pal.wl; x.fillRect(7, 4, 2, 8); x.fillRect(4, 7, 8, 2); }
  return c;
}

function dWater(pal, seed, frame) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, '#1f6fbe', '#0d2f78');
  x.globalAlpha = 0.45; x.fillStyle = '#6fc9ff';
  for (let i = 0; i < 3; i++) {
    const yy = 3 + i * 5, xx = ((i * 5 + frame * 4) % 16);
    x.fillRect(xx, yy, 5, 1);
  }
  x.globalAlpha = 1;
  return c;
}

function dStatue(pal, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, pal.f0, pal.f1);
  x.fillStyle = '#00000055'; x.fillRect(3, 14, 10, 2);
  x.fillStyle = pal.st; x.fillRect(4, 2, 8, 13);
  x.fillStyle = pal.stl; x.fillRect(4, 2, 8, 2); x.fillRect(4, 2, 2, 13);
  x.fillStyle = pal.std; x.fillRect(10, 4, 2, 11);
  x.fillStyle = '#e33a30'; x.fillRect(6, 5, 2, 2); x.fillRect(9, 5, 2, 2);
  x.fillStyle = pal.std; x.fillRect(5, 9, 6, 1); x.fillRect(6, 11, 4, 1);
  x.strokeStyle = '#0d0b14'; x.strokeRect(3.5, 1.5, 9, 14);
  return c;
}

function dStairs(pal, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  x.fillStyle = '#0a0812'; x.fillRect(0, 0, 16, 16);
  const steps = ['#9aa0b0', '#787e92', '#5a6072', '#3e4354', '#262b39'];
  for (let i = 0; i < 5; i++) { x.fillStyle = steps[i]; x.fillRect(1, 1 + i * 3, 14, 3); }
  x.strokeStyle = '#0d0b14'; x.strokeRect(0.5, 0.5, 15, 15);
  return c;
}

function dVoid(pal) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  x.fillStyle = '#070510'; x.fillRect(0, 0, 16, 16);
  return c;
}

function dSand(pal, seed) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d'), rng = mulberry(seed);
  vgrad(x, '#cbb27a', '#a8905c');
  speckle(x, rng, ['#e0c894', '#8f7a4a'], 18, 0.5);
  return c;
}

function dFire(pal, seed, frame) {
  const c = makeCanvas(TS, TS), x = c.getContext('2d');
  vgrad(x, pal.f0, pal.f1);
  x.fillStyle = '#3a2c18'; x.fillRect(5, 10, 6, 5);
  x.fillStyle = '#5c4726'; x.fillRect(5, 10, 6, 1);
  const h = frame ? 7 : 5;
  x.fillStyle = '#ff8f22';
  x.beginPath(); x.moveTo(8, 10 - h); x.lineTo(11, 10); x.lineTo(5, 10); x.closePath(); x.fill();
  x.fillStyle = '#ffee8a';
  x.beginPath(); x.moveTo(8, 12 - h); x.lineTo(10, 10); x.lineTo(6, 10); x.closePath(); x.fill();
  return c;
}

/* ---------------------------------------------------- dungeon colour themes */
const DPAL = EQ.DPAL = [
  null,
  { w0:'#4f6a9e', w1:'#2d3f68', wl:'#7e9bd0', wd:'#1d2a48', f0:'#2b2f45', f1:'#1c2033', fl:'#4d5474', fd:'#141726', b0:'#5a76aa', b1:'#37507e', bm:'#25355a', st:'#7e88a8', stl:'#a3adc9', std:'#4d5673' },
  { w0:'#8f5a3a', w1:'#5d381f', wl:'#c08256', wd:'#3b2213', f0:'#3a2c22', f1:'#261c15', fl:'#5f4a38', fd:'#1a120c', b0:'#a06a45', b1:'#6b4227', bm:'#4a2c18', st:'#a08a6a', stl:'#c6b090', std:'#6a583f' },
  { w0:'#3f7d5c', w1:'#22503a', wl:'#63ad83', wd:'#153426', f0:'#233428', f1:'#16211a', fl:'#3d5a45', fd:'#0f1712', b0:'#4a8d68', b1:'#2b5f44', bm:'#1c4230', st:'#7ea38c', stl:'#a3c4b0', std:'#4c6a58' },
  { w0:'#7a4f8e', w1:'#4a2c5c', wl:'#a878bd', wd:'#2e1a3b', f0:'#312440', f1:'#20182b', fl:'#503f66', fd:'#150f1d', b0:'#8a5c9e', b1:'#573369', bm:'#3d2150', st:'#9a86ae', stl:'#bfaad0', std:'#61527a' },
  { w0:'#a03d3d', w1:'#661f22', wl:'#d16a63', wd:'#3f1214', f0:'#3a2020', f1:'#241313', fl:'#5f3535', fd:'#180c0c', b0:'#b04a48', b1:'#7a2a2b', bm:'#551b1d', st:'#ad8080', stl:'#cfa5a2', std:'#6d4a4a' },
  { w0:'#4a6f78', w1:'#28454c', wl:'#6f9ea8', wd:'#182d33', f0:'#25333a', f1:'#182126', fl:'#3f5760', fd:'#101619', b0:'#557f8a', b1:'#325761', bm:'#1f3d45', st:'#7d99a1', stl:'#a4bcc3', std:'#4d666d' },
  { w0:'#8a7a3a', w1:'#584c1f', wl:'#bda95c', wd:'#372f13', f0:'#332e1c', f1:'#211e12', fl:'#564e30', fd:'#15130a', b0:'#9a8944', b1:'#665626', bm:'#463a18', st:'#a09a72', stl:'#c5c096', std:'#6a6449' },
  { w0:'#5c5f70', w1:'#35384a', wl:'#8b8fa4', wd:'#22242f', f0:'#2c2e3a', f1:'#1c1e26', fl:'#4b4e60', fd:'#121319', b0:'#6a6d80', b1:'#43465a', bm:'#2e3040', st:'#8a8d9e', stl:'#b0b3c4', std:'#575a6c' },
  { w0:'#6e2f4f', w1:'#421a30', wl:'#9c5478', wd:'#2a0f1e', f0:'#2f1b26', f1:'#1f1219', fl:'#4e2f3f', fd:'#140a0f', b0:'#7d3a5c', b1:'#53203a', bm:'#3a1428', st:'#96707f', stl:'#bb929f', std:'#5f4550' },
];

/* ------------------------------------------------------------------ atlases */
const ART = EQ.ART = { over: {}, dung: [], anim: { water: [], dwater: [], wfall: [], dfire: [] } };

function buildOverworld() {
  Object.keys(BIOME).forEach((name, bi) => {
    const b = BIOME[name], seed = 1000 + bi * 131;
    const set = {};
    set[T.GROUND]  = tGround(b, seed, 0);
    set.gv = [0, 1, 2].map(v => tGround(b, seed, v));
    set[T.PATH]    = tPath(b, seed + 7);
    set[T.SAND]    = tSand(b, seed + 13);
    set[T.BUSH]    = tBush(b, seed + 19);
    set[T.TREE]    = tTree(b, seed + 23, 0);
    set.tv = [0, 1].map(v => tTree(b, seed + 23, v));
    set[T.MTN]     = tMtn(b, seed + 29, 0);
    set.mv = [0, 1, 2].map(v => tMtn(b, seed + 29, v));
    set[T.ROCK]    = tRock(b, seed + 31);
    set[T.BRIDGE]  = tBridge(b, seed + 37);
    set[T.DOCK]    = tDock(b, seed + 41);
    set[T.STAIRS]  = tStairs(b, seed + 43);
    set[T.CAVE]    = tCave(b, seed + 47);
    set[T.DUNGEON] = tDungeon(b, seed + 53);
    set[T.GRAVE]   = tGrave(b, seed + 59);
    set[T.ARMOS]   = tArmos(b, seed + 61);
    // water + waterfall are animated; frame 0 lives in the static set
    set[T.WATER]   = tWater(b, seed + 67, 0);
    set[T.WFALL]   = tWfall(b, seed + 71, 0);
    ART.over[name] = set;
  });
  for (let f = 0; f < 4; f++) {
    ART.anim.water.push(tWater(BIOME.grass, 1067, f));
    ART.anim.wfall.push(tWfall(BIOME.grass, 1071, f));
  }
}

function buildDungeons() {
  for (let L = 1; L <= 9; L++) {
    const p = DPAL[L], seed = 4000 + L * 97;
    const set = {};
    set[T.DFLOOR]  = dFloor(p, seed, 0);
    set.fv = [0, 1, 2].map(v => dFloor(p, seed, v));
    set[T.DWALL]   = dWall(p, seed + 3);
    set[T.DBLOCK]  = dBlock(p, seed + 5, false);
    set[T.DBLOCKP] = dBlock(p, seed + 7, true);
    set[T.DWATER]  = dWater(p, seed + 11, 0);
    set[T.DSTATUE] = dStatue(p, seed + 13);
    set[T.DSTAIRS] = dStairs(p, seed + 17);
    set[T.DVOID]   = dVoid(p);
    set[T.DSAND]   = dSand(p, seed + 19);
    set[T.DFIRE]   = dFire(p, seed + 23, 0);
    ART.dung[L] = set;
  }
  for (let f = 0; f < 4; f++) ART.anim.dwater.push(dWater(DPAL[1], 4011, f));
  for (let f = 0; f < 2; f++) ART.anim.dfire.push(dFire(DPAL[1], 4023, f));
}

/* Door graphics for dungeon rooms, drawn per level palette.
   kinds: open | shut | locked | bomb (cracked) | wall (none)                 */
function buildDoors() {
  ART.doors = [];
  for (let L = 1; L <= 9; L++) {
    const p = DPAL[L];
    const mk = (kind) => {
      // north-facing door art, 32x24; other sides rotated at draw time
      const c = makeCanvas(32, 24), x = c.getContext('2d');
      x.clearRect(0, 0, 32, 24);
      const wg = x.createLinearGradient(0, 0, 0, 24);
      wg.addColorStop(0, p.w0); wg.addColorStop(1, p.w1);
      x.fillStyle = wg; x.fillRect(0, 0, 32, 24);
      x.fillStyle = p.wd; x.fillRect(0, 11, 32, 1); x.fillRect(0, 23, 32, 1);
      x.fillStyle = p.wl; x.fillRect(0, 0, 32, 1); x.fillRect(0, 12, 32, 1);
      if (kind === 'wall') return c;
      // opening
      x.fillStyle = '#08060f'; x.fillRect(8, 0, 16, 24);
      x.fillStyle = p.wd; x.fillRect(7, 0, 1, 24); x.fillRect(24, 0, 1, 24);
      x.fillStyle = p.wl; x.fillRect(8, 0, 1, 24); x.fillRect(23, 0, 1, 24);
      if (kind === 'open') {
        x.fillStyle = p.stl; x.fillRect(6, 0, 2, 6); x.fillRect(24, 0, 2, 6);
        x.fillRect(6, 18, 2, 6); x.fillRect(24, 18, 2, 6);
      } else if (kind === 'shut') {
        const sg = x.createLinearGradient(0, 0, 0, 24);
        sg.addColorStop(0, p.b0); sg.addColorStop(1, p.b1);
        x.fillStyle = sg; x.fillRect(8, 0, 16, 24);
        x.fillStyle = p.wd;
        for (let i = 1; i < 6; i++) x.fillRect(8, i * 4, 16, 1);
        x.fillStyle = p.wl; x.fillRect(8, 0, 16, 1);
      } else if (kind === 'locked') {
        const sg = x.createLinearGradient(0, 0, 0, 24);
        sg.addColorStop(0, p.b0); sg.addColorStop(1, p.b1);
        x.fillStyle = sg; x.fillRect(8, 0, 16, 24);
        x.fillStyle = '#f6c32e'; x.fillRect(13, 8, 6, 8);
        x.fillStyle = '#ad7712'; x.fillRect(15, 11, 2, 4);
        x.fillStyle = '#f6c32e'; x.beginPath();
        x.arc(16, 8, 3.4, Math.PI, 0); x.stroke();
        x.lineWidth = 2; x.strokeStyle = '#f6c32e';
        x.beginPath(); x.arc(16, 8, 3, Math.PI, 0); x.stroke();
      } else if (kind === 'bomb') {
        x.fillStyle = wg; x.fillRect(8, 0, 16, 24);
        x.fillStyle = p.wd; x.fillRect(0, 11, 32, 1);
        x.strokeStyle = p.wd; x.lineWidth = 1;
        x.beginPath(); x.moveTo(12, 0); x.lineTo(15, 7); x.lineTo(11, 13);
        x.lineTo(16, 19); x.lineTo(13, 24); x.stroke();
        x.beginPath(); x.moveTo(20, 2); x.lineTo(17, 9); x.lineTo(21, 15); x.stroke();
      }
      return c;
    };
    ART.doors[L] = { open: mk('open'), shut: mk('shut'), locked: mk('locked'),
                     bomb: mk('bomb'), wall: mk('wall') };
  }
}

/* Cave interior backdrop (used for all overworld caves / shops). */
function buildCave() {
  const c = makeCanvas(EQ.K.VIEW_W, EQ.K.VIEW_H), x = c.getContext('2d');
  x.fillStyle = '#06050c'; x.fillRect(0, 0, c.width, c.height);
  // rocky ledge across the top and bottom
  const rng = mulberry(9182);
  const drawLedge = (y, h, up) => {
    for (let i = 0; i < c.width; i += 8) {
      const j = Math.round(rng() * 4);
      x.fillStyle = '#2a2436'; x.fillRect(i, up ? y : y - j, 8, h + j);
      x.fillStyle = '#3d3550'; x.fillRect(i, up ? y : y - j, 8, 2);
    }
  };
  drawLedge(0, 26, true);
  drawLedge(c.height, 0, false);
  x.fillStyle = '#1a1626'; x.fillRect(0, c.height - 26, c.width, 26);
  x.fillStyle = '#2a2436'; x.fillRect(0, c.height - 26, c.width, 3);
  return c;
}

EQ.buildArt = function () {
  buildOverworld(); buildDungeons(); buildDoors();
  ART.caveBg = buildCave();
};

})(window);
