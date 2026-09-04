/* ============================================================================
   EMBERQUEST — entities.js
   Enemies, bosses, projectiles, pickups and the behaviour archetypes that
   drive them. Damage is counted in half-hearts (2 = one full heart).
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;
const K = EQ.K, T = EQ.T;
const W = EQ.World;
const { clamp, rnd, rndi, pick, dist, aabb } = EQ.util;
const DIRS = ['up','down','left','right'];
const DV = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };

/* ------------------------------------------------------------------ lists */
const Ents = EQ.Ents = { list: [], shots: [], drops: [], fx: [] };

function clearAll() { Ents.list.length = 0; Ents.shots.length = 0; Ents.drops.length = 0; Ents.fx.length = 0; }
EQ.clearEntities = clearAll;

/* ------------------------------------------------------------- stat table */
const STATS = {
  octorok:      { hp:2,  dmg:2, sp:26, ai:'walker',  spr:'octorok',  alt:'octorokB', shoot:'rock', rate:1.6 },
  octorokBlue:  { hp:4,  dmg:2, sp:34, ai:'walker',  spr:'octorokBlue', alt:'octorokBlueB', shoot:'rock', rate:1.1 },
  moblin:       { hp:3,  dmg:2, sp:30, ai:'walker',  spr:'moblin',   alt:'moblinB', shoot:'spear', rate:1.5 },
  moblinBlue:   { hp:5,  dmg:4, sp:36, ai:'walker',  spr:'moblinBlue', alt:'moblinBlueB', shoot:'spear', rate:1.1 },
  tektite:      { hp:2,  dmg:2, sp:0,  ai:'hopper',  spr:'tektite',  alt:'tektiteB' },
  tektiteBlue:  { hp:3,  dmg:2, sp:0,  ai:'hopper',  spr:'tektiteBlue', alt:'tektiteBlueB', fast:true },
  leever:       { hp:2,  dmg:2, sp:32, ai:'burrow',  spr:'leever',   alt:'leeverB' },
  leeverBlue:   { hp:4,  dmg:4, sp:40, ai:'burrow',  spr:'leeverBlue', alt:'leeverBlueB' },
  peahat:       { hp:3,  dmg:2, sp:34, ai:'peahat',  spr:'peahat',   alt:'peahatB' },
  zola:         { hp:2,  dmg:2, sp:0,  ai:'zola',    spr:'zola',     shoot:'magic' },
  lynel:        { hp:6,  dmg:4, sp:34, ai:'walker',  spr:'lynel',    shoot:'beamE', rate:1.3 },
  lynelBlue:    { hp:9,  dmg:6, sp:40, ai:'walker',  spr:'lynelBlue',shoot:'beamE', rate:0.9 },
  armos:        { hp:3,  dmg:2, sp:38, ai:'armos',   spr:'armos' },
  ghini:        { hp:3,  dmg:2, sp:26, ai:'drift',   spr:'ghini' },
  boulder:      { hp:99, dmg:4, sp:70, ai:'boulder', spr:'boulder', invuln:true },

  keese:        { hp:1,  dmg:1, sp:44, ai:'flyer',   spr:'keese',    alt:'keeseB' },
  keeseRed:     { hp:1,  dmg:2, sp:50, ai:'flyer',   spr:'keeseRed', alt:'keeseRedB' },
  keeseBlue:    { hp:1,  dmg:2, sp:52, ai:'flyer',   spr:'keeseBlue',alt:'keeseBlueB' },
  stalfos:      { hp:2,  dmg:2, sp:28, ai:'walker',  spr:'stalfos' },
  stalfosBlue:  { hp:4,  dmg:4, sp:34, ai:'walker',  spr:'stalfosBlue' },
  gel:          { hp:1,  dmg:1, sp:30, ai:'blob',    spr:'gel' },
  gelBlue:      { hp:1,  dmg:2, sp:34, ai:'blob',    spr:'gelBlue' },
  zol:          { hp:2,  dmg:2, sp:20, ai:'blob',    spr:'zol', splits:'gel' },
  zolBlue:      { hp:3,  dmg:2, sp:22, ai:'blob',    spr:'zolBlue', splits:'gelBlue' },
  rope:         { hp:2,  dmg:2, sp:26, ai:'rope',    spr:'rope' },
  ropeBlue:     { hp:3,  dmg:4, sp:30, ai:'rope',    spr:'ropeBlue' },
  goriya:       { hp:3,  dmg:2, sp:28, ai:'walker',  spr:'goriya', shoot:'boomerang', rate:1.8 },
  goriyaBlue:   { hp:5,  dmg:4, sp:34, ai:'walker',  spr:'goriyaBlue', shoot:'boomerang', rate:1.3 },
  wallmaster:   { hp:3,  dmg:2, sp:30, ai:'wall',    spr:'wallmaster', grab:true },
  darknut:      { hp:5,  dmg:4, sp:30, ai:'knight',  spr:'darknut' },
  darknutBlue:  { hp:8,  dmg:6, sp:38, ai:'knight',  spr:'darknutBlue' },
  wizzrobe:     { hp:4,  dmg:4, sp:0,  ai:'caster',  spr:'wizzrobe', shoot:'magic', rate:1.4 },
  wizzrobeBlue: { hp:6,  dmg:4, sp:34, ai:'caster2', spr:'wizzrobeBlue', shoot:'magic', rate:1.1 },
  likelike:     { hp:4,  dmg:2, sp:16, ai:'eater',   spr:'likelike' },
  vire:         { hp:4,  dmg:4, sp:34, ai:'hopper',  spr:'vire', splits:'keeseRed', splitN:2 },
  bubble:       { hp:99, dmg:0, sp:46, ai:'bounce',  spr:'bubble', invuln:true, jinx:true },
  gibdo:        { hp:5,  dmg:4, sp:22, ai:'walker',  spr:'gibdo' },
  polsvoice:    { hp:4,  dmg:2, sp:26, ai:'hopper',  spr:'polsvoice', pipeKill:true },
  moldorm:      { hp:6,  dmg:2, sp:46, ai:'worm',    spr:'moldorm', seg:'moldormSeg', segs:4 },
  lanmola:      { hp:6,  dmg:4, sp:62, ai:'worm',    spr:'lanmola', seg:'lanmolaSeg', segs:4 },
  patra:        { hp:10, dmg:4, sp:24, ai:'patra',   spr:'patra' },
  patraMini:    { hp:2,  dmg:2, sp:0,  ai:'orbit',   spr:'patraMini' },
  trap:         { hp:99, dmg:4, sp:0,  ai:'trap',    spr:'trap', invuln:true },
};
EQ.STATS = STATS;

/* -------------------------------------------------------------- the entity */
function Ent(name, x, y, over) {
  const st = STATS[name] || {};
  const e = {
    name, x, y, w: 14, h: 14, ox: -1, oy: -1,
    hp: st.hp || 1, maxhp: st.hp || 1, dmg: st.dmg === undefined ? 2 : st.dmg,
    sp: st.sp || 0, ai: st.ai || 'walker', sprKey: st.spr || name, altKey: st.alt,
    invuln: !!st.invuln, jinx: !!st.jinx, grab: !!st.grab, pipeKill: !!st.pipeKill,
    splits: st.splits, splitN: st.splitN || 2, shoot: st.shoot, rate: st.rate || 1.5,
    dir: pick(DIRS), t: rnd(0, 2), timer: rnd(0.3, 1.4), shootT: rnd(0.6, 2.2),
    frame: 0, inv: 0, flash: 0, kb: 0, kbx: 0, kby: 0, dead: false,
    stunned: 0, state: 'idle', boss: false, spawnT: 0.55, drops: true,
  };
  Object.assign(e, over || {});
  return e;
}

function spawn(name, x, y, over) {
  const e = Ent(name, x, y, over);
  if (e.ai === 'worm') buildWorm(e);
  if (e.ai === 'patra') buildPatra(e);
  Ents.list.push(e);
  return e;
}
EQ.spawnEnemy = spawn;

function buildWorm(e) {
  const st = STATS[e.name];
  e.segments = [];
  for (let i = 0; i < (st.segs || 4); i++) e.segments.push({ x: e.x, y: e.y });
  e.trail = [];
  e.segKey = st.seg;
}
function buildPatra(e) {
  e.minis = [];
  for (let i = 0; i < 6; i++) e.minis.push({ a: (i / 6) * Math.PI * 2, hp: 2, alive: true });
  e.orbit = 26;
}

/* --------------------------------------------------------------- movement */
function moveEnt(e, dx, dy, opts) {
  let blocked = false;
  if (dx) {
    if (!W.blocked(e.x + dx, e.y, e.w, e.h, opts)) e.x += dx; else blocked = true;
  }
  if (dy) {
    if (!W.blocked(e.x, e.y + dy, e.w, e.h, opts)) e.y += dy; else blocked = true;
  }
  // keep inside the play area
  e.x = clamp(e.x, 0, K.VIEW_W - e.w);
  e.y = clamp(e.y, 0, K.VIEW_H - e.h);
  return blocked;
}

const flyOpts = { fly: true };

/* ------------------------------------------------------------------- shots */
function shot(kind, x, y, dir, opts) {
  const base = { kind, x, y, w: 8, h: 8, dir, t: 0, life: 3, sp: 130, from: 'enemy', dmg: 2 };
  const s = Object.assign(base, opts || {});
  const d = DV[dir] || [0, 1];
  if (s.vx === undefined) { s.vx = d[0] * s.sp; s.vy = d[1] * s.sp; }
  Ents.shots.push(s);
  return s;
}
EQ.spawnShot = shot;

function enemyShoot(e, P) {
  const cx = e.x + e.w / 2 - 4, cy = e.y + e.h / 2 - 4;
  switch (e.shoot) {
    case 'rock':      shot('rock', cx, cy, e.dir, { dmg: e.dmg, sp: 110 }); break;
    case 'spear':     shot('spear', cx, cy, e.dir, { dmg: e.dmg, sp: 120 }); break;
    case 'boomerang': shot('eboomerang', cx, cy, e.dir, { dmg: 0, stun: 1.1, sp: 120, owner: e, life: 2 });
                      EQ.audio.sfx('boomerang'); break;
    case 'magic':     shot('magic', cx, cy, e.dir, { dmg: e.dmg, sp: 100 }); EQ.audio.sfx('magic'); break;
    case 'beamE':     shot('beamE', cx, cy, e.dir, { dmg: e.dmg, sp: 150 }); EQ.audio.sfx('beam'); break;
    case 'fire3': {
      const ang = [-0.32, 0, 0.32];
      ang.forEach(a => {
        const vx = Math.cos(Math.PI + a) * 105, vy = Math.sin(Math.PI + a) * 105;
        shot('fireball', cx, cy, 'left', { dmg: e.dmg, vx, vy, life: 4 });
      });
      EQ.audio.sfx('fire'); break;
    }
    case 'fireHead': {
      const P2 = EQ.P;
      const ang = Math.atan2(P2.y - cy, P2.x - cx);
      shot('fireball', cx, cy, 'left', { dmg: e.dmg, vx: Math.cos(ang) * 96, vy: Math.sin(ang) * 96, life: 4 });
      EQ.audio.sfx('fire'); break;
    }
  }
}

/* Face the player on one axis, mostly. */
function chaseDir(e, P, bias) {
  const dx = (P.x + 7) - (e.x + e.w / 2), dy = (P.y + 7) - (e.y + e.h / 2);
  if (Math.random() < (bias === undefined ? 0.7 : bias)) {
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
  }
  return pick(DIRS);
}

/* ------------------------------------------------------------ enemy update */
function updateEnemy(e, dt, P) {
  e.t += dt;
  if (e.spawnT > 0) { e.spawnT -= dt; return; }
  if (e.inv > 0) e.inv -= dt;
  if (e.flash > 0) e.flash -= dt;
  if (e.stunned > 0) { e.stunned -= dt; return; }

  if (e.kb > 0) {
    e.kb -= dt;
    moveEnt(e, e.kbx * 170 * dt, e.kby * 170 * dt, e.ai === 'flyer' ? flyOpts : null);
    return;
  }

  e.frame = Math.floor(e.t * 5) % 2;

  switch (e.ai) {

    case 'walker': {
      e.timer -= dt;
      if (e.timer <= 0) { e.dir = chaseDir(e, P, 0.55); e.timer = rnd(0.6, 1.8); }
      const d = DV[e.dir];
      if (moveEnt(e, d[0] * e.sp * dt, d[1] * e.sp * dt)) e.timer = 0;
      if (e.shoot) {
        e.shootT -= dt;
        if (e.shootT <= 0) { enemyShoot(e, P); e.shootT = e.rate * rnd(0.8, 1.5); }
      }
      break;
    }

    case 'knight': {   // blocks anything that hits its face
      e.timer -= dt;
      if (e.timer <= 0) { e.dir = chaseDir(e, P, 0.8); e.timer = rnd(0.5, 1.2); }
      const d = DV[e.dir];
      if (moveEnt(e, d[0] * e.sp * dt, d[1] * e.sp * dt)) e.timer = 0;
      e.shielded = true;
      break;
    }

    case 'hopper': {
      if (e.state === 'idle') {
        e.timer -= dt;
        if (e.timer <= 0) {
          e.state = 'hop'; e.hopT = 0;
          const ang = Math.atan2((P.y - e.y) + rnd(-40, 40), (P.x - e.x) + rnd(-40, 40));
          e.hvx = Math.cos(ang) * rnd(50, 82); e.hvy = Math.sin(ang) * rnd(50, 82);
        }
      } else {
        e.hopT += dt;
        moveEnt(e, e.hvx * dt, e.hvy * dt, flyOpts);
        e.z = Math.sin(Math.min(1, e.hopT / 0.62) * Math.PI) * 9;
        if (e.hopT > 0.62) { e.state = 'idle'; e.z = 0; e.timer = rnd(0.35, 1.0); }
      }
      e.frame = e.state === 'hop' ? 1 : 0;
      break;
    }

    case 'blob': {
      e.timer -= dt;
      if (e.timer <= 0) { e.dir = chaseDir(e, P, 0.5); e.timer = rnd(0.7, 1.6); }
      const d = DV[e.dir];
      const phase = (Math.sin(e.t * 7) * 0.5 + 0.5);
      moveEnt(e, d[0] * e.sp * phase * dt, d[1] * e.sp * phase * dt);
      break;
    }

    case 'burrow': {
      if (e.state === 'idle') {
        e.timer -= dt; e.hidden = true;
        if (e.timer <= 0) {
          e.state = 'up'; e.hidden = false; e.emerge = 0;
          e.x = clamp(P.x + rnd(-56, 56), 8, K.VIEW_W - 24);
          e.y = clamp(P.y + rnd(-40, 40), 8, K.VIEW_H - 24);
          if (W.blocked(e.x, e.y, e.w, e.h)) { e.state = 'idle'; e.timer = 0.3; e.hidden = true; break; }
        }
      } else {
        e.emerge += dt;
        e.frame = e.emerge < 0.35 ? 1 : 0;
        const d = DV[e.dir = chaseDirCached(e, P)];
        moveEnt(e, d[0] * e.sp * dt, d[1] * e.sp * dt);
        if (e.emerge > 2.6) { e.state = 'idle'; e.hidden = true; e.timer = rnd(0.8, 1.8); }
      }
      break;
    }

    case 'peahat': {
      e.spin = (e.spin || 0) + dt;
      e.invulnNow = (Math.sin(e.spin * 1.5) > -0.2);   // only vulnerable when it settles
      const ang = e.t * 1.4 + (e.seedA || (e.seedA = rnd(0, 6.28)));
      moveEnt(e, Math.cos(ang) * e.sp * dt, Math.sin(ang * 0.8) * e.sp * dt, flyOpts);
      e.frame = e.invulnNow ? 1 : 0;
      break;
    }

    case 'zola': {
      if (e.state === 'idle') {
        e.timer -= dt; e.hidden = true;
        if (e.timer <= 0) {
          const spots = [];
          for (let ty = 0; ty < 11; ty++) for (let tx = 0; tx < 16; tx++)
            if (W.tile(tx, ty) === T.WATER || W.tile(tx, ty) === T.DWATER) spots.push([tx, ty]);
          if (!spots.length) { e.dead = true; break; }
          const s = pick(spots);
          e.x = s[0] * 16 + 1; e.y = s[1] * 16 + 1;
          e.state = 'up'; e.hidden = false; e.timer = 1.5; e.fired = false;
        }
      } else {
        e.timer -= dt;
        if (!e.fired && e.timer < 1.0) {
          e.dir = chaseDir(e, P, 1); enemyShoot(e, P); e.fired = true;
        }
        if (e.timer <= 0) { e.state = 'idle'; e.hidden = true; e.timer = rnd(1.6, 3.2); }
      }
      break;
    }

    case 'flyer': {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.fvx = rnd(-1, 1); e.fvy = rnd(-1, 1);
        const m = Math.hypot(e.fvx, e.fvy) || 1;
        e.fvx /= m; e.fvy /= m; e.timer = rnd(0.3, 0.9);
      }
      moveEnt(e, (e.fvx || 0) * e.sp * dt, (e.fvy || 0) * e.sp * dt, flyOpts);
      break;
    }

    case 'drift': {
      const ang = Math.atan2((P.y) - e.y, (P.x) - e.x);
      moveEnt(e, Math.cos(ang) * e.sp * dt, Math.sin(ang) * e.sp * dt, flyOpts);
      break;
    }

    case 'armos': {
      if (e.state === 'idle') {
        if (dist(P.x, P.y, e.x, e.y) < 22) { e.state = 'awake'; EQ.audio.sfx('secret'); }
      } else {
        e.timer -= dt;
        if (e.timer <= 0) { e.dir = chaseDir(e, P, 0.9); e.timer = rnd(0.4, 0.9); }
        const d = DV[e.dir];
        if (moveEnt(e, d[0] * e.sp * dt, d[1] * e.sp * dt)) e.timer = 0;
      }
      break;
    }

    case 'boulder': {
      moveEnt(e, rnd(-0.4, 0.4) * 40 * dt, e.sp * dt, flyOpts);
      if (e.y > K.VIEW_H - 8) e.dead = true;
      break;
    }

    case 'rope': {
      const alignedY = Math.abs((P.y) - e.y) < 12, alignedX = Math.abs((P.x) - e.x) < 12;
      if (!e.charging && (alignedX || alignedY)) {
        e.charging = true;
        e.dir = alignedY ? ((P.x < e.x) ? 'left' : 'right') : ((P.y < e.y) ? 'up' : 'down');
      }
      const mul = e.charging ? 2.6 : 1;
      e.timer -= dt;
      if (!e.charging && e.timer <= 0) { e.dir = pick(DIRS); e.timer = rnd(0.5, 1.3); }
      const d = DV[e.dir];
      if (moveEnt(e, d[0] * e.sp * mul * dt, d[1] * e.sp * mul * dt)) { e.charging = false; e.timer = 0; }
      break;
    }

    case 'wall': {
      if (e.state === 'idle') {
        e.timer -= dt;
        if (e.timer <= 0) {
          e.state = 'crawl';
          const side = pick(['left','right','up','down']);
          if (side === 'left')  { e.x = 8;  e.y = clamp(P.y, 32, K.VIEW_H - 40); e.dir = 'right'; }
          if (side === 'right') { e.x = K.VIEW_W - 22; e.y = clamp(P.y, 32, K.VIEW_H - 40); e.dir = 'left'; }
          if (side === 'up')    { e.y = 8;  e.x = clamp(P.x, 32, K.VIEW_W - 40); e.dir = 'down'; }
          if (side === 'down')  { e.y = K.VIEW_H - 22; e.x = clamp(P.x, 32, K.VIEW_W - 40); e.dir = 'up'; }
          e.hidden = false; e.travel = 0;
        } else e.hidden = true;
      } else {
        const d = DV[e.dir];
        moveEnt(e, d[0] * e.sp * dt, d[1] * e.sp * dt, flyOpts);
        e.travel += e.sp * dt;
        if (e.travel > 90) { e.state = 'idle'; e.timer = rnd(1.2, 2.6); e.hidden = true; }
      }
      break;
    }

    case 'caster': {   // blinks out, reappears, throws magic
      e.timer -= dt;
      if (e.state === 'idle') {
        e.alpha = 1;
        if (e.timer <= 0) {
          e.dir = chaseDir(e, P, 1); enemyShoot(e, P);
          e.state = 'fade'; e.timer = 0.6;
        }
      } else if (e.state === 'fade') {
        e.alpha = clamp(e.timer / 0.6, 0, 1);
        if (e.timer <= 0) {
          e.x = clamp(rnd(24, K.VIEW_W - 40), 16, K.VIEW_W - 32);
          e.y = clamp(rnd(24, K.VIEW_H - 40), 16, K.VIEW_H - 32);
          if (W.blocked(e.x, e.y, e.w, e.h)) { e.timer = 0.05; break; }
          e.state = 'rise'; e.timer = 0.5;
        }
      } else {
        e.alpha = 1 - clamp(e.timer / 0.5, 0, 1);
        if (e.timer <= 0) { e.state = 'idle'; e.timer = e.rate; }
      }
      e.ghost = e.state !== 'idle';
      break;
    }

    case 'caster2': {  // walks through walls and fires while moving
      e.timer -= dt;
      if (e.timer <= 0) { e.dir = chaseDir(e, P, 0.8); e.timer = rnd(0.5, 1.1); }
      const d = DV[e.dir];
      e.x = clamp(e.x + d[0] * e.sp * dt, 8, K.VIEW_W - e.w - 8);
      e.y = clamp(e.y + d[1] * e.sp * dt, 8, K.VIEW_H - e.h - 8);
      e.shootT -= dt;
      if (e.shootT <= 0) { enemyShoot(e, P); e.shootT = e.rate * rnd(0.8, 1.4); }
      break;
    }

    case 'eater': {
      if (e.holding) {
        e.holdT -= dt;
        e.x = P.x - 1; e.y = P.y - 1;
        if (e.holdT <= 0) { e.holding = false; P.trapped = 0; }
        break;
      }
      e.timer -= dt;
      if (e.timer <= 0) { e.dir = chaseDir(e, P, 0.85); e.timer = rnd(0.6, 1.3); }
      const d = DV[e.dir];
      moveEnt(e, d[0] * e.sp * dt, d[1] * e.sp * dt);
      break;
    }

    case 'bounce': {
      if (e.bvx === undefined) { const a = rnd(0, 6.28); e.bvx = Math.cos(a); e.bvy = Math.sin(a); }
      if (moveEnt(e, e.bvx * e.sp * dt, 0, null)) e.bvx *= -1;
      if (moveEnt(e, 0, e.bvy * e.sp * dt, null)) e.bvy *= -1;
      break;
    }

    case 'worm': {
      e.timer -= dt;
      if (e.timer <= 0) { e.wdir = rnd(0, 6.28); e.timer = rnd(0.5, 1.2); }
      if (e.wa === undefined) e.wa = rnd(0, 6.28);
      const target = Math.atan2(P.y - e.y, P.x - e.x);
      let diff = ((target - e.wa + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      e.wa += clamp(diff, -2.4 * dt, 2.4 * dt);
      const nx = Math.cos(e.wa) * e.sp * dt, ny = Math.sin(e.wa) * e.sp * dt;
      if (moveEnt(e, nx, ny, flyOpts)) e.wa += Math.PI * rnd(0.4, 1.6);
      e.trail.unshift({ x: e.x, y: e.y });
      if (e.trail.length > 90) e.trail.length = 90;
      e.segments.forEach((s, i) => {
        const p = e.trail[Math.min(e.trail.length - 1, (i + 1) * 11)];
        if (p) { s.x = p.x; s.y = p.y; }
      });
      break;
    }

    case 'patra': {
      e.timer -= dt;
      if (e.timer <= 0) { e.pdir = rnd(0, 6.28); e.timer = rnd(1.0, 2.0); }
      moveEnt(e, Math.cos(e.pdir || 0) * e.sp * dt, Math.sin(e.pdir || 0) * e.sp * dt, flyOpts);
      e.orbit = 22 + Math.sin(e.t * 0.9) * 12;
      e.minis.forEach(m => { m.a += dt * 1.6; });
      e.shellUp = e.minis.some(m => m.alive);
      break;
    }

    case 'trap': {
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      const px = P.x + 7, py = P.y + 7;
      if (e.state === 'idle') {
        if (Math.abs(px - cx) < 12) { e.state = 'fire'; e.tdir = py > cy ? 'down' : 'up'; e.home = { x:e.x, y:e.y }; }
        else if (Math.abs(py - cy) < 12) { e.state = 'fire'; e.tdir = px > cx ? 'right' : 'left'; e.home = { x:e.x, y:e.y }; }
      } else if (e.state === 'fire') {
        const d = DV[e.tdir];
        if (moveEnt(e, d[0] * 180 * dt, d[1] * 180 * dt)) e.state = 'back';
      } else {
        const dx = e.home.x - e.x, dy = e.home.y - e.y;
        if (Math.hypot(dx, dy) < 2) { e.x = e.home.x; e.y = e.home.y; e.state = 'idle'; }
        else moveEnt(e, Math.sign(dx) * 60 * dt, Math.sign(dy) * 60 * dt, flyOpts);
      }
      break;
    }

    case 'orbit': break;

    default: break;
  }
}

function chaseDirCached(e, P) {
  if (!e._cdT || e._cdT < 0) { e._cd = chaseDir(e, P, 0.85); e._cdT = 0.6; }
  e._cdT -= 0.016;
  return e._cd || 'down';
}

/* ================================================================= BOSSES */
function spawnBoss(kind, opts) {
  const cx = K.VIEW_W / 2, cy = K.VIEW_H / 2;
  const mk = (o) => { const e = Ent('boss', o.x, o.y, Object.assign({ boss:true, drops:false }, o)); Ents.list.push(e); return e; };
  EQ.audio.sfx('bossRoar');
  switch (kind) {
    case 'sarquin':
      return [mk({ bkind:'sarquin', x:cx + 40, y:cy - 30, w:28, h:28, hp:14, dmg:4, ai:'bSarquin', sp:18 })];
    case 'sarquinPair':
      return [mk({ bkind:'sarquin', x:cx + 46, y:cy - 46, w:28, h:28, hp:12, dmg:4, ai:'bSarquin', sp:20 }),
              mk({ bkind:'sarquin', x:cx + 46, y:cy + 10, w:28, h:28, hp:12, dmg:4, ai:'bSarquin', sp:20 })];
    case 'grovak':
      return [mk({ bkind:'grovak', x:cx - 40, y:cy - 12, w:30, h:22, hp:8, dmg:4, ai:'bGrovak', sp:26, bombsEaten:0 })];
    case 'vellthorn':
      return [mk({ bkind:'vellthorn', x:cx - 8, y:cy - 8, w:16, h:16, hp:1, dmg:4, ai:'bVellthorn', sp:24,
                   heads:[0,1,2,3].map(i => ({ a:(i/4)*Math.PI*2, hp:3, alive:true, shootT: rnd(0.5,2) })) })];
    case 'skalgar':
      return [mk({ bkind:'skalgar', x:cx - 16, y:cy - 20, w:30, h:30, hp:1, dmg:4, ai:'bSkalgar', sp:0,
                   necks:[0,1].map(i => ({ a:(i/2)*Math.PI*2, r:34, hp:6, alive:true, shootT: rnd(0.6,2), flying:false })) })];
    case 'umbroth':
      return [mk({ bkind:'umbroth', x:cx - 24, y:cy - 24, w:46, h:46, hp:99, dmg:6, ai:'bUmbroth', sp:26,
                   shrunk:false, invuln:true })];
    case 'chelvane':
      return [mk({ bkind:'chelvane', x:cx - 16, y:cy - 34, w:30, h:30, hp:6, dmg:4, ai:'bChelvane', sp:28,
                   tint: opts && opts.tint })];
    case 'ghyrn':
      return [mk({ bkind:'ghyrn', x:cx - 16, y:cy - 16, w:30, h:30, hp:12, dmg:8, ai:'bGhyrn', sp:0,
                   phase:'solid', stunT:0, hits:0 })];
  }
  return [];
}
EQ.spawnBoss = spawnBoss;

function updateBoss(e, dt, P) {
  e.t += dt;
  if (e.inv > 0) e.inv -= dt;
  if (e.flash > 0) e.flash -= dt;
  e.frame = Math.floor(e.t * 3) % 2;

  switch (e.ai) {

    case 'bSarquin': {
      e.timer -= dt;
      if (e.timer <= 0) { e.vy = rnd(-1, 1); e.timer = rnd(0.5, 1.4); }
      moveEnt(e, Math.sin(e.t * 0.7) * e.sp * dt, (e.vy || 0) * e.sp * dt, flyOpts);
      e.x = clamp(e.x, K.VIEW_W / 2, K.VIEW_W - e.w - 18);
      e.y = clamp(e.y, 24, K.VIEW_H - e.h - 18);
      e.shootT -= dt;
      if (e.shootT <= 0) { e.shoot = 'fire3'; enemyShoot(e, P); e.shootT = rnd(1.5, 2.6); e.frame = 1; }
      break;
    }

    case 'bGrovak': {
      e.timer -= dt;
      if (e.stun > 0) { e.stun -= dt; break; }
      if (e.timer <= 0) { e.dir = chaseDir(e, P, 0.8); e.timer = rnd(0.7, 1.5); }
      const d = DV[e.dir];
      if (moveEnt(e, d[0] * e.sp * dt, d[1] * e.sp * dt)) e.timer = 0;
      break;
    }

    case 'bVellthorn': {
      const alive = e.heads.filter(h => h.alive).length;
      const speed = e.sp * (1 + (4 - alive) * 0.55);
      e.timer -= dt;
      if (e.timer <= 0) { e.mdir = rnd(0, 6.28); e.timer = rnd(0.6, 1.4); }
      moveEnt(e, Math.cos(e.mdir || 0) * speed * dt, Math.sin(e.mdir || 0) * speed * dt, flyOpts);
      e.x = clamp(e.x, 26, K.VIEW_W - e.w - 26); e.y = clamp(e.y, 26, K.VIEW_H - e.h - 26);
      e.heads.forEach(h => {
        if (!h.alive) return;
        h.a += dt * 0.7;
        h.shootT -= dt;
        if (h.shootT <= 0) {
          h.shootT = rnd(1.6, 3.2);
          const hx = e.x + 8 + Math.cos(h.a) * 22, hy = e.y + 8 + Math.sin(h.a) * 22;
          const ang = Math.atan2(P.y - hy, P.x - hx);
          shot('fireball', hx - 4, hy - 4, 'left', { dmg: 4, vx: Math.cos(ang) * 92, vy: Math.sin(ang) * 92, life: 4 });
        }
      });
      if (alive === 0) killBoss(e);
      break;
    }

    case 'bSkalgar': {
      e.necks.forEach((n, i) => {
        if (!n.alive) return;
        if (n.flying) {
          n.fx += n.fvx * dt; n.fy += n.fvy * dt;
          if (n.fx < 8 || n.fx > K.VIEW_W - 24) n.fvx *= -1;
          if (n.fy < 8 || n.fy > K.VIEW_H - 24) n.fvy *= -1;
          return;
        }
        n.a += dt * (1.0 + i * 0.3);
        n.r = 30 + Math.sin(e.t * 1.4 + i) * 12;
        n.shootT -= dt;
        if (n.shootT <= 0) {
          n.shootT = rnd(1.4, 2.8);
          const hx = e.x + 15 + Math.cos(n.a) * n.r, hy = e.y + 15 + Math.sin(n.a) * n.r;
          const ang = Math.atan2(P.y - hy, P.x - hx);
          shot('fireball', hx - 4, hy - 4, 'left', { dmg: 4, vx: Math.cos(ang) * 98, vy: Math.sin(ang) * 98, life: 4 });
        }
      });
      if (e.necks.every(n => !n.alive || n.flying)) {
        if (e.necks.every(n => !n.alive)) killBoss(e);
      }
      break;
    }

    case 'bUmbroth': {
      if (!e.shrunk) {
        const ang = Math.atan2(P.y - e.y, P.x - e.x);
        moveEnt(e, Math.cos(ang) * e.sp * dt, Math.sin(ang) * e.sp * dt, flyOpts);
      }
      break;
    }

    case 'bChelvane': {
      e.timer -= dt;
      if (e.timer <= 0) { e.cvx = pick([-1, 1]); e.timer = rnd(1.0, 2.2); }
      moveEnt(e, (e.cvx || 1) * e.sp * dt, Math.sin(e.t * 0.8) * 14 * dt, flyOpts);
      if (e.x < 20 || e.x > K.VIEW_W - e.w - 20) e.cvx *= -1;
      e.x = clamp(e.x, 20, K.VIEW_W - e.w - 20);
      e.y = clamp(e.y, 20, 70);
      e.eyeOpen = (Math.sin(e.t * 1.25) > 0.25);
      e.frame = e.eyeOpen ? 1 : 0;
      e.shootT -= dt;
      if (e.shootT <= 0) {
        e.shootT = rnd(1.4, 2.4);
        const ang = Math.atan2(P.y - e.y, P.x - e.x);
        shot('fireball', e.x + 14, e.y + 20, 'down', { dmg:4, vx: Math.cos(ang)*88, vy: Math.sin(ang)*88, life:4 });
      }
      // spits crawlers
      e.spawnT2 = (e.spawnT2 || 3) - dt;
      if (e.spawnT2 <= 0) { e.spawnT2 = rnd(3, 6); spawn('gel', e.x + 8, e.y + 26); }
      break;
    }

    case 'bGhyrn': {
      if (e.stunT > 0) {
        e.stunT -= dt; e.visible = true;
        if (e.stunT <= 0) e.phase = 'blink';
        break;
      }
      e.timer -= dt;
      if (e.phase === 'solid') {
        e.visible = true;
        const ang = Math.atan2(P.y - e.y, P.x - e.x);
        moveEnt(e, Math.cos(ang) * 30 * dt, Math.sin(ang) * 30 * dt, flyOpts);
        if (e.timer <= 0) { e.phase = 'blink'; e.timer = rnd(1.2, 2.2); }
        e.shootT -= dt;
        if (e.shootT <= 0) {
          e.shootT = rnd(1.0, 1.9);
          const a2 = Math.atan2(P.y - e.y, P.x - e.x);
          shot('fireball', e.x + 12, e.y + 12, 'left', { dmg:6, vx: Math.cos(a2)*118, vy: Math.sin(a2)*118, life:4 });
        }
      } else {
        e.visible = (Math.floor(e.t * 8) % 2) === 0;
        const ang = Math.atan2(P.y - e.y, P.x - e.x);
        moveEnt(e, Math.cos(ang) * 52 * dt, Math.sin(ang) * 52 * dt, flyOpts);
        if (e.timer <= 0) { e.phase = 'solid'; e.timer = rnd(1.4, 2.6); }
      }
      break;
    }
  }
}

function killBoss(e) {
  e.dead = true;
  EQ.audio.sfx('enemyDie');
  burst(e.x + e.w / 2, e.y + e.h / 2, 26, '#ffd36a');
  EQ.onBossDead && EQ.onBossDead(e);
}

/* ------------------------------------------------------------------ damage */
function hurtEnemy(e, dmg, dir, weapon) {
  if (e.dead) return false;
  if (e.inv > 0) return false;

  // Peahats can only be cut when they settle
  if (e.ai === 'peahat' && e.invulnNow) return false;
  // Wizzrobes are untouchable while phased out
  if (e.ghost) return false;
  // Darknuts turn everything aside with their shield
  if (e.shielded && weapon !== 'bomb' && weapon !== 'fire' && weapon !== 'rod') {
    const opp = { up:'down', down:'up', left:'right', right:'left' }[dir];
    if (e.dir === opp) { EQ.audio.sfx('shieldBlock'); return false; }
  }
  // Umbroth is armoured until the pipe shrinks it
  if (e.bkind === 'umbroth' && !e.shrunk) { EQ.audio.sfx('shieldBlock'); return false; }
  // Grovak only ever dies from swallowing bombs
  if (e.bkind === 'grovak' && weapon !== 'swordFinish') { EQ.audio.sfx('shieldBlock'); return false; }
  // Chelvane can only be hurt through the open eye, by an arrow
  if (e.bkind === 'chelvane') {
    if (!e.eyeOpen || (weapon !== 'arrow' && weapon !== 'arrowSilver')) { EQ.audio.sfx('shieldBlock'); return false; }
  }
  // Ghyrn: sword while solid, then the silver arrow to finish
  if (e.bkind === 'ghyrn') {
    if (weapon === 'arrowSilver') {
      if (e.stunT > 0) { e.dead = true; EQ.audio.sfx('bossRoar'); burst(e.x+15, e.y+15, 40, '#ffd36a'); EQ.onBossDead && EQ.onBossDead(e); return true; }
      return false;
    }
    if (!e.visible || e.phase !== 'solid') return false;
    e.hits++; e.inv = 0.4; e.flash = 0.2; EQ.audio.sfx('bossHit');
    if (e.hits >= 6) { e.stunT = 6; e.phase = 'stun'; }
    return true;
  }
  if (e.invuln) return false;

  e.hp -= dmg;
  e.inv = 0.22; e.flash = 0.18;
  if (dir) { const d = DV[dir]; e.kbx = d[0]; e.kby = d[1]; e.kb = 0.13; }
  EQ.audio.sfx(e.boss ? 'bossHit' : 'hit');
  if (e.hp <= 0) killEnemy(e, dir);
  return true;
}
EQ.hurtEnemy = hurtEnemy;

function killEnemy(e, dir) {
  e.dead = true;
  EQ.audio.sfx('enemyDie');
  burst(e.x + e.w / 2, e.y + e.h / 2, e.boss ? 24 : 10, e.boss ? '#ffd36a' : '#ffffff');
  if (e.boss) { EQ.onBossDead && EQ.onBossDead(e); return; }
  if (e.splits && !e.noSplit) {
    for (let i = 0; i < e.splitN; i++)
      spawn(e.splits, e.x + rnd(-8, 8), e.y + rnd(-8, 8), { noSplit: true, spawnT: 0.2 });
  }
  if (e.drops) dropSomething(e);
  EQ.onEnemyDead && EQ.onEnemyDead(e);
}

/* --------------------------------------------------------------- pickups */
const DROP_TABLE = [
  ['rupee', 26], ['heart', 22], ['bomb', 12], ['rupee5', 8],
  ['fairy', 3], ['clock', 2], ['none', 27],
];
function dropSomething(e) {
  const G = EQ.G;
  if (e.keyDrop) { addDrop('key', e.x, e.y); return; }
  let roll = Math.random() * DROP_TABLE.reduce((s, d) => s + d[1], 0);
  for (const [k, wgt] of DROP_TABLE) { roll -= wgt; if (roll <= 0) { if (k !== 'none') addDrop(k, e.x, e.y); return; } }
}
function addDrop(kind, x, y, opts) {
  Ents.drops.push(Object.assign({ kind, x: clamp(x, 8, K.VIEW_W - 24), y: clamp(y, 8, K.VIEW_H - 24),
                                  w: 14, h: 14, t: 0, life: kind === 'fairy' ? 9 : 8, perm: false }, opts || {}));
}
EQ.addDrop = addDrop;

/* -------------------------------------------------------------------- fx */
function burst(x, y, n, colour) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, 6.28), s = rnd(28, 96);
    Ents.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rnd(0.25, 0.6),
                   c: colour || '#ffffff', r: rnd(1, 2.6) });
  }
}
EQ.burst = burst;

function ring(x, y, colour) {
  Ents.fx.push({ ring: true, x, y, t: 0, life: 0.45, c: colour || '#ffd36a' });
}
EQ.ring = ring;

/* ------------------------------------------------------------ shot update */
function updateShots(dt, P) {
  for (let i = Ents.shots.length - 1; i >= 0; i--) {
    const s = Ents.shots[i];
    s.t += dt;
    if (s.kind === 'boomerang' || s.kind === 'eboomerang') {
      const back = s.t > s.out;
      if (!back) { s.x += s.vx * dt; s.y += s.vy * dt; }
      else {
        const ox = s.owner ? s.owner.x : (s.ownerP ? P.x : s.x);
        const oy = s.owner ? s.owner.y : (s.ownerP ? P.y : s.y);
        const a = Math.atan2(oy - s.y, ox - s.x);
        s.x += Math.cos(a) * s.sp * 1.35 * dt; s.y += Math.sin(a) * s.sp * 1.35 * dt;
        if (dist(s.x, s.y, ox, oy) < 12) { Ents.shots.splice(i, 1); if (s.onReturn) s.onReturn(); continue; }
      }
      if (!back && (s.x < -8 || s.y < -8 || s.x > K.VIEW_W || s.y > K.VIEW_H)) s.out = 0;
    } else {
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
    // walls stop most things
    if (s.kind !== 'boomerang' && s.kind !== 'eboomerang' && s.kind !== 'flame' && s.kind !== 'magic') {
      if (W.blocked(s.x + 2, s.y + 2, s.w - 4, s.h - 4, { fly: s.kind === 'beam' || s.kind === 'beamE' ? false : false })) {
        if (s.onWall) s.onWall(s);
        Ents.shots.splice(i, 1); continue;
      }
    }
    if (s.kind === 'flame') {
      s.vx *= 0.94; s.vy *= 0.94;
      if (s.t > 0.30 && !s.landed) { s.landed = true; s.vx = 0; s.vy = 0; }
      if (s.landed && !s.burned) {
        s.burned = true;
        W.burnAt(Math.floor((s.x + 4) / 16), Math.floor((s.y + 4) / 16));
      }
    }
    if (s.t > s.life || s.x < -20 || s.y < -20 || s.x > K.VIEW_W + 20 || s.y > K.VIEW_H + 20) {
      Ents.shots.splice(i, 1); continue;
    }
  }
}

/* ---------------------------------------------------------------- drawing */
function sprFor(e) {
  const S = EQ.ENEMY_SPR;
  let set = S[e.sprKey];
  if (e.frame === 1 && e.altKey && S[e.altKey]) set = S[e.altKey];
  if (!set) set = S.octorok;
  return set[e.dir] || set.down;
}

function drawEnemy(ctx, e) {
  if (e.hidden) return;
  if (e.spawnT > 0) {
    // materialising puff
    const k = 1 - e.spawnT / 0.55;
    ctx.save(); ctx.globalAlpha = k;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.28 + e.t * 6, r = (1 - k) * 12;
      ctx.fillRect(e.x + 7 + Math.cos(a) * r, e.y + 7 + Math.sin(a) * r, 2, 2);
    }
    ctx.restore(); return;
  }
  ctx.save();
  if (e.alpha !== undefined) ctx.globalAlpha = clamp(e.alpha, 0, 1);
  if (e.boss) drawBoss(ctx, e);
  else {
    const img = sprFor(e);
    const yy = e.y - (e.z || 0);
    // ground shadow
    if (e.z) { ctx.globalAlpha *= 0.35; ctx.fillStyle = '#000'; ctx.beginPath();
               ctx.ellipse(e.x + 8, e.y + 15, 6, 2.4, 0, 0, 6.28); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.drawImage(img, Math.round(e.x + e.ox), Math.round(yy + e.oy));
    if (e.flash > 0) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.8;
      ctx.drawImage(img, Math.round(e.x + e.ox), Math.round(yy + e.oy));
    }
  }
  ctx.restore();
  if (e.ai === 'worm' && e.segments) {
    const S = EQ.ENEMY_SPR[e.segKey];
    e.segments.forEach(s => { if (S) ctx.drawImage(S.down, Math.round(s.x - 1), Math.round(s.y - 1)); });
  }
  if (e.ai === 'patra' && e.minis) {
    const S = EQ.ENEMY_SPR.patraMini;
    e.minis.forEach(m => {
      if (!m.alive) return;
      ctx.drawImage(S.down, Math.round(e.x + 8 + Math.cos(m.a) * e.orbit - 8),
                            Math.round(e.y + 8 + Math.sin(m.a) * e.orbit - 8));
    });
  }
}

function drawBoss(ctx, e) {
  const B = EQ.BOSS_SPR;
  const f = e.frame ? 1 : 0;
  const px = Math.round(e.x), py = Math.round(e.y);
  const stamp = (img, x, y) => {
    ctx.drawImage(img, x, y);
    if (e.flash > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85; ctx.drawImage(img, x, y); ctx.restore(); }
  };
  switch (e.bkind) {
    case 'sarquin': stamp(B.sarquin[f], px, py); break;
    case 'grovak':  stamp(B.grovak[e.stun > 0 ? 1 : f], px, py); break;
    case 'vellthorn':
      e.heads.forEach(h => {
        if (!h.alive) return;
        stamp(B.vellthornHead[f], Math.round(px + Math.cos(h.a) * 22 - 8), Math.round(py + Math.sin(h.a) * 22 - 8));
      });
      stamp(B.vellthornCore, px, py);
      break;
    case 'skalgar':
      e.necks.forEach(n => {
        if (!n.alive) return;
        let hx, hy;
        if (n.flying) { hx = n.fx; hy = n.fy; }
        else {
          hx = px + 15 + Math.cos(n.a) * n.r - 8; hy = py + 15 + Math.sin(n.a) * n.r - 8;
          ctx.strokeStyle = '#4a6f78'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(px + 15, py + 15); ctx.lineTo(hx + 8, hy + 8); ctx.stroke();
          ctx.strokeStyle = '#6f9ea8'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(px + 15, py + 15); ctx.lineTo(hx + 8, hy + 8); ctx.stroke();
        }
        stamp(B.skalgarHead[f], Math.round(hx), Math.round(hy));
      });
      stamp(B.skalgarBody, px, py);
      break;
    case 'umbroth':
      if (e.shrunk) stamp(B.umbrothChild, px + 15, py + 15);
      else stamp(B.umbroth[f], px, py);
      break;
    case 'chelvane': {
      const img = B.chelvane[e.eyeOpen ? 1 : 0];
      const tinted = e.tint === 'blue' ? (e._blue || (e._blue = EQ.tintCanvas(img, '#3f7de0', 0.45))) : img;
      stamp(tinted, px, py); break;
    }
    case 'ghyrn': {
      if (!e.visible) { ctx.save(); ctx.globalAlpha = 0.16; ctx.drawImage(B.ghyrnGhost[f], px, py); ctx.restore(); break; }
      if (e.stunT > 0) { ctx.save(); ctx.globalAlpha = 0.55 + Math.sin(e.t * 22) * 0.35; stamp(B.ghyrn[f], px, py); ctx.restore(); }
      else stamp(B.ghyrn[f], px, py);
      break;
    }
  }
}

function drawShots(ctx) {
  const S = EQ.SPR;
  Ents.shots.forEach(s => {
    let img = null;
    if (s.kind === 'rock') img = S.rock;
    else if (s.kind === 'spear') img = S.arrow[s.dir];
    else if (s.kind === 'fireball' || s.kind === 'flame') img = S.flame;
    else if (s.kind === 'magic') img = S.magicShot;
    else if (s.kind === 'beam' || s.kind === 'beamE') img = S.beam;
    else if (s.kind === 'arrow') img = S.arrow[s.dir];
    else if (s.kind === 'arrowSilver') img = S.arrowSilverDir[s.dir];
    else if (s.kind === 'boomerang') img = s.magic ? S.boomerangMagic : S.boomerang;
    else if (s.kind === 'eboomerang') img = S.boomerang;
    else if (s.kind === 'bomb') { drawBomb(ctx, s); return; }
    else if (s.kind === 'rodShot') img = S.magicShot;
    if (!img) return;
    ctx.save();
    if (s.kind === 'boomerang' || s.kind === 'eboomerang') {
      ctx.translate(s.x + 8, s.y + 8); ctx.rotate(s.t * 22); ctx.drawImage(img, -8, -8);
    } else ctx.drawImage(img, Math.round(s.x - 4), Math.round(s.y - 4));
    ctx.restore();
  });
}

function drawBomb(ctx, s) {
  const S = EQ.SPR;
  const blink = s.t > s.life - 0.7 && (Math.floor(s.t * 14) % 2 === 0);
  ctx.save();
  if (blink) { ctx.globalCompositeOperation = 'lighter'; }
  ctx.drawImage(S.bomb, Math.round(s.x - 4), Math.round(s.y - 4));
  ctx.restore();
}

function drawDrops(ctx) {
  const S = EQ.SPR;
  Ents.drops.forEach(d => {
    if (!d.perm && d.life - d.t < 2 && Math.floor(d.t * 10) % 2) return;
    let img = S.heart;
    if (d.kind === 'rupee') img = S.rupee;
    else if (d.kind === 'rupee5') img = S.rupeeBlue;
    else if (d.kind === 'bomb') img = S.bomb;
    else if (d.kind === 'key') img = S.key;
    else if (d.kind === 'fairy') img = S.fairy;
    else if (d.kind === 'clock') img = S.clock;
    else if (d.kind === 'heartContainer') img = S.heartContainer;
    else if (d.kind === 'shard') img = S.shard;
    else if (d.kind === 'map') img = S.map;
    else if (d.kind === 'compass') img = S.compass;
    else if (S[d.kind]) img = S[d.kind];
    const bob = d.kind === 'fairy' ? Math.sin(d.t * 6) * 3 : 0;
    ctx.drawImage(img, Math.round(d.x - 1), Math.round(d.y - 1 + bob));
  });
}

function drawFx(ctx) {
  Ents.fx.forEach(p => {
    const k = 1 - p.t / p.life;
    ctx.save(); ctx.globalAlpha = clamp(k, 0, 1);
    if (p.ring) {
      ctx.strokeStyle = p.c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, (1 - k) * 30 + 4, 0, 6.28); ctx.stroke();
    } else {
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.r, p.r);
    }
    ctx.restore();
  });
}

/* ------------------------------------------------------------- master tick */
function update(dt, P) {
  for (let i = Ents.list.length - 1; i >= 0; i--) {
    const e = Ents.list[i];
    if (e.boss) updateBoss(e, dt, P); else updateEnemy(e, dt, P);
    if (e.dead) Ents.list.splice(i, 1);
  }
  updateShots(dt, P);
  for (let i = Ents.drops.length - 1; i >= 0; i--) {
    const d = Ents.drops[i];
    d.t += dt;
    if (d.kind === 'fairy') {
      if (d.fa === undefined) d.fa = rnd(0, 6.28);
      d.fa += dt * 1.4;
      d.x = clamp(d.x + Math.cos(d.fa) * 42 * dt, 8, K.VIEW_W - 24);
      d.y = clamp(d.y + Math.sin(d.fa * 1.3) * 42 * dt, 8, K.VIEW_H - 24);
    }
    if (!d.perm && d.t > d.life) Ents.drops.splice(i, 1);
  }
  for (let i = Ents.fx.length - 1; i >= 0; i--) {
    const p = Ents.fx[i];
    p.t += dt;
    if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; }
    if (p.t > p.life) Ents.fx.splice(i, 1);
  }
}

function draw(ctx) {
  drawDrops(ctx);
  Ents.list.forEach(e => drawEnemy(ctx, e));
  drawShots(ctx);
  drawFx(ctx);
}

EQ.Entities = { update, draw, spawn, spawnBoss, clearAll, hurtEnemy, addDrop, burst, ring, shot };

})(window);
