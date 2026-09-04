/* ============================================================================
   EMBERQUEST — game.js
   The state machine that ties everything together: title, overworld travel,
   dungeon crawling, cave scenes, item pickups, saving, death and the ending.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;
const K = EQ.K, T = EQ.T, W = EQ.World, UI = EQ.UI;
const { clamp, rnd, rndi, pick, aabb } = EQ.util;
const DV = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
const OPP = { up:'down', down:'up', left:'right', right:'left' };

/* ------------------------------------------------------------ game state */
function freshState() {
  return {
    rupees: 0, keys: 0, bombs: 0, bombMax: 8, maxHearts: 3,
    inv: {}, bItem: null, everBomb: false,
    shards: {}, dmap: {}, dcompass: {}, lastLevel: 0,
    flags: {
      seen:{}, secrets:{}, cleared:{}, doors:{}, roomSeen:{}, roomCleared:{},
      litRooms:{}, pushed:{}, taken:{}, caveDone:{}, bossDead:{}, oneOff:{},
    },
    owReturn: { col:7, row:7, x:112, y:96 },
    deaths: 0, playTime: 0, warpIdx: 0,
  };
}

const Game = EQ.Game = {
  state: 'title', t: 0, fade: 0, fadeDir: 0, onFade: null,
  invSlide: 0, invOpen: false,
  cave: null, pendingLevel: 0,
  lockedPrompt: 0,
  shakeT: 0, shakeMag: 0,
};

/* --------------------------------------------------------------- start-up */
function newGame() {
  EQ.G = freshState();
  const G = EQ.G;
  EQ.P.reset(112, 96, 'up');
  EQ.P.hp = 6; EQ.P.maxhp = 6;
  G.maxHearts = 3;
  W.loadOverworld(7, 7);
  G.flags.seen['7,7'] = true;
  EQ.clearEntities();
  populateOverworld();
  Game.state = 'play';
  EQ.audio.music('overworld');
}

/* --------------------------------------------------------------- saving */
const SAVE_KEY = 'emberquest.save.v1';
function save() {
  try {
    const G = EQ.G;
    const blob = {
      G, p: { hp: EQ.P.hp, maxhp: EQ.P.maxhp },
      w: { kind: W.kind, col: W.col, row: W.row, level: W.level, rx: W.rx, ry: W.ry },
      pos: { x: EQ.P.x, y: EQ.P.y, dir: EQ.P.dir },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
    return true;
  } catch (e) { return false; }
}
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function load() {
  try {
    const blob = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!blob) return false;
    EQ.G = blob.G;
    EQ.P.reset(blob.pos.x, blob.pos.y, blob.pos.dir);
    EQ.P.hp = blob.p.hp; EQ.P.maxhp = blob.p.maxhp;
    EQ.clearEntities();
    if (blob.w.kind === 'dun') { W.loadDungeonRoom(blob.w.level, blob.w.rx, blob.w.ry); populateRoom(); EQ.audio.music('dungeon'); }
    else { W.loadOverworld(blob.w.col, blob.w.row); populateOverworld(); EQ.audio.music('overworld'); }
    Game.state = 'play';
    return true;
  } catch (e) { return false; }
}
EQ.saveGame = save; EQ.hasSave = hasSave;

/* --------------------------------------------------------- screen fading */
function fadeTo(fn, speed) {
  Game.fadeDir = 1; Game.onFade = fn; Game.fadeSpeed = speed || 3.4;
}
function updateFade(dt) {
  if (Game.fadeDir === 0) return;
  Game.fade += Game.fadeDir * dt * (Game.fadeSpeed || 3.4);
  if (Game.fadeDir > 0 && Game.fade >= 1) {
    Game.fade = 1; Game.fadeDir = -1;
    if (Game.onFade) { const f = Game.onFade; Game.onFade = null; f(); }
  } else if (Game.fadeDir < 0 && Game.fade <= 0) { Game.fade = 0; Game.fadeDir = 0; }
}

function shake(mag, time) { Game.shakeMag = mag; Game.shakeT = time; }

/* ================================================== OVERWORLD POPULATION */
function populateOverworld() {
  EQ.clearEntities();
  const G = EQ.G;
  const sc = W.screen;
  G.flags.seen[W.col + ',' + W.row] = true;

  // No enemies on the very first screen, or in a walled dead-end pocket
  if (W.col === 7 && W.row === 7) return;

  const spawns = EQ.OW_SPAWNS(sc);
  spawns.forEach(sp => {
    let x = sp.x, y = sp.y;
    if (W.blocked(x, y, 14, 14) || Math.hypot(x - EQ.P.x, y - EQ.P.y) < 40) {
      const pos = findFreeSpot(30); if (!pos) return;
      x = pos.x; y = pos.y;
    }
    EQ.spawnEnemy(sp.name, x, y);
  });

  // Death Mountain drops rocks on you
  if (W.biome === 'mount' && W.row <= 1) Game.rockTimer = 1.2;
  else Game.rockTimer = 0;
}

function findFreeSpot(tries) {
  for (let i = 0; i < (tries || 40); i++) {
    const x = rndi(1, 14) * 16 + 1, y = rndi(1, 9) * 16 + 1;
    if (W.blocked(x, y, 14, 14)) continue;
    if (Math.hypot(x - EQ.P.x, y - EQ.P.y) < 46) continue;
    return { x, y };
  }
  return null;
}

/* =================================================== DUNGEON POPULATION */
function populateRoom() {
  EQ.clearEntities();
  const G = EQ.G, room = W.room, L = EQ.dungeon(W.level);
  const rk = W.level + ':' + W.rx + ',' + W.ry;
  G.flags.roomSeen[rk] = true;
  G.lastLevel = W.level;
  W.shutters = {};
  W.refreshDoors();

  const cleared = G.flags.roomCleared[rk];
  const taken = G.flags.taken[rk];

  /* --- the boss -------------------------------------------------------- */
  if (room.ch === 'B') {
    if (!G.flags.bossDead[W.level]) {
      EQ.spawnBoss(L.bossKind, { tint: L.bossTint });
      W.closeShutters();
      EQ.audio.music('boss');
    } else if (!taken) {
      EQ.addDrop('heartContainer', 116, 76, { perm:true, tag:'heartContainer' });
    }
    return;
  }
  /* --- room prizes ------------------------------------------------------ */
  const place = (kind, tag) => { if (!taken) EQ.addDrop(kind, 116, 76, { perm:true, tag: tag || kind }); };
  switch (room.ch) {
    case 'm': place('map', 'map'); break;
    case 'c': place('compass', 'compass'); break;
    case 'k': place('key', 'key'); break;
    case 'I': if (room.item) place(room.item, room.item); break;
    case 'P': Game.roomNPC = { spr:'princess', ending:true }; break;
    case 'T': if (!G.shards[W.level]) EQ.addDrop('shard', 116, 72, { perm:true, tag:'shard' }); break;
  }
  if (room.ch !== 'P') Game.roomNPC = null;

  /* --- enemies ---------------------------------------------------------- */
  if (cleared || !room.enemies || !room.enemies.length) {
    if (room.shutOnEntry && !taken && room.ch !== 'S') { /* prize still here, doors stay open */ }
    return;
  }
  const list = room.spawns && room.spawns.length
    ? room.spawns
    : (room.enemies || []).map(n => ({ name: n }));
  list.forEach((sp, i) => {
    let x = sp.x, y = sp.y;
    if (x === undefined || W.blocked(x, y, 14, 14)) {
      const pos = findFreeSpot(30); if (!pos) return;
      x = pos.x; y = pos.y;
    }
    EQ.spawnEnemy(sp.name, x, y, { keyDrop: (room.dropsKey && i === list.length - 1) });
  });
  if (room.shutOnEntry) W.closeShutters();
}

/* Fired by entities.js whenever anything dies. */
EQ.onEnemyDead = function () {
  if (W.kind !== 'dun') return;
  if (!EQ.Ents.list.some(e => !e.dead)) roomCleared();
};
EQ.onBossDead = function (e) {
  const G = EQ.G;
  if (W.kind !== 'dun') return;
  if (W.room && W.room.ch === 'B') {
    G.flags.bossDead[W.level] = true;
    EQ.addDrop('heartContainer', e.x + 8, e.y + 8, { perm:true, tag:'heartContainer' });
  }
  shake(4, 0.6);
  setTimeout(() => { if (W.kind === 'dun') EQ.audio.music('dungeon'); }, 900);
  roomCleared();
};
function roomCleared() {
  const G = EQ.G, rk = W.level + ':' + W.rx + ',' + W.ry;
  G.flags.roomCleared[rk] = true;
  W.openShutters();
}

/* ==================================================== TRANSIT AND WARPS */
function tryScreenChange() {
  const P = EQ.P;
  let dir = null;
  if (P.x < -3) dir = 'left';
  else if (P.x > K.VIEW_W - 13) dir = 'right';
  else if (P.y < -3) dir = 'up';
  else if (P.y > K.VIEW_H - 13) dir = 'down';
  if (!dir) return false;

  if (W.kind === 'cave') { P.x = clamp(P.x, 4, K.VIEW_W - 20); P.y = clamp(P.y, 4, K.VIEW_H - 20); return false; }

  /* walking back out of a level's entrance room leaves the level */
  if (W.kind === 'dun' && dir === 'down') {
    const L = EQ.dungeon(W.level);
    if (W.rx === L.entry[0] && W.ry === L.entry[1]) {
      EQ.audio.sfx('stairs');
      fadeTo(() => exitDungeon());
      return true;
    }
  }

  /* Lost Woods / Lost Hills logic before the ordinary move */
  if (W.kind === 'ow') {
    const region = lostRegion(W.col, W.row);
    if (region) {
      const r = handleLost(region, dir);
      if (r === 'reset') { doScroll(dir, true, region); return true; }
    }
  }

  doScroll(dir, false);
  return true;
}

function doScroll(dir, lostReset, region) {
  const P = EQ.P;
  const ok = W.startScroll(dir, () => {
    if (W.kind === 'ow') populateOverworld(); else populateRoom();
  });
  if (!ok) {
    P.x = clamp(P.x, 0, K.VIEW_W - 16);
    P.y = clamp(P.y, 0, K.VIEW_H - 16);
    return;
  }
  // slide the player in from the opposite edge
  if (dir === 'left')  P.x = K.VIEW_W - 18;
  if (dir === 'right') P.x = 2;
  if (dir === 'up')    P.y = K.VIEW_H - 18;
  if (dir === 'down')  P.y = 2;
  P.x = clamp(P.x, 2, K.VIEW_W - 18);
  P.y = clamp(P.y, 2, K.VIEW_H - 18);
  if (lostReset && region) {
    // dumped back at the region entrance
    const [c, r] = region.entry.split(',').map(Number);
    W.loadOverworld(c, r);
    W.scroll = null;
    populateOverworld();
    EQ.G.lostStep = 0;
  }
  EQ.clearEntities();
}

function lostRegion(col, row) {
  const k = col + ',' + row;
  for (const name in EQ.LOST) {
    const r = EQ.LOST[name];
    if (r.screens.indexOf(k) >= 0) return Object.assign({ name }, r);
  }
  return null;
}

/* Returns 'ok' while the sequence is still on track, 'reset' when broken. */
function handleLost(region, dir) {
  const G = EQ.G;
  if (G.lostRegion !== region.name) { G.lostRegion = region.name; G.lostStep = 0; }
  const want = region.path[G.lostStep || 0];
  if (dir === want) {
    G.lostStep = (G.lostStep || 0) + 1;
    if (G.lostStep >= region.path.length) {
      G.lostStep = 0;
      G.flags.oneOff['lost:' + region.name] = true;
      EQ.audio.sfx('secret');
      return 'clear';
    }
    return 'ok';
  }
  G.lostStep = 0;
  return 'reset';
}

/* ------------------------------------------------------ stairs and doors */
function checkWarps() {
  const P = EQ.P, G = EQ.G;
  const tx = Math.floor((P.x + 8) / 16), ty = Math.floor((P.y + 11) / 16);
  const t = W.tile(tx, ty);
  const centred = Math.abs((P.x + 8) - (tx * 16 + 8)) < 6;

  if (W.kind === 'ow') {
    if ((t === T.CAVE || t === T.STAIRS || t === T.DUNGEON) && centred) {
      const f = W.featAt(tx, ty);
      if (!f) return;
      if (f.gate && !G.flags.secrets[W.featKey(f)]) return;   // still sealed
      G.owReturn = { col: W.col, row: W.row, x: P.x, y: ty * 16 };
      EQ.audio.sfx('stairs');
      if (f.t === 'dungeon') fadeTo(() => enterDungeon(f.n));
      else if (f.id)         { const hi = f.hintIndex || 0; fadeTo(() => enterCave(f.id, hi)); }
    }
    if (t === T.BRIDGE && G.inv.raft && !P.raftT && P.dir === 'up') {
      P.raftT = 1.9; P.raftDir = 'up';
      EQ.audio.sfx('stairs');
    }
  } else if (W.kind === 'dun') {
    if (t === T.DSTAIRS && centred) {
      const room = W.room;
      if (room.stairTo && room.stairTo.length && tx === 4) {
        const dest = room.stairTo[0];
        const p = EQ.dungeon(W.level)._rooms[dest];
        // come out at whichever end of the corridor is not this room
        const side = (p && p.ends && p.ends[1] === room.key) ? 'right' : 'left';
        EQ.audio.sfx('stairs');
        fadeTo(() => {
          const d = dest.split(',').map(Number);
          W.loadDungeonRoom(W.level, d[0], d[1]);
          EQ.P.reset(side === 'left' ? 56 : 184, 84, side === 'left' ? 'right' : 'left');
          populateRoom();
        });
      } else if (room.passage) {
        const ends = room.ends || [];
        const back = (tx <= 7 ? ends[0] : ends[1]) || ends[0] || EQ.dungeon(W.level).entry.join(',');
        EQ.audio.sfx('stairs');
        fadeTo(() => {
          const d = back.split(',').map(Number);
          W.loadDungeonRoom(W.level, d[0], d[1]);
          EQ.P.reset(64, 84, 'down');
          populateRoom();
        });
      }
    }
  } else if (W.kind === 'cave') {
    if (t === T.DSTAIRS && P.y > K.VIEW_H - 40) {
      EQ.audio.sfx('stairs');
      fadeTo(() => exitCave());
    }
  }
}

/* Locked doors: touching one with a key in hand opens it. */
function checkDoors() {
  if (W.kind !== 'dun') return;
  const P = EQ.P, G = EQ.G;
  const cx = P.x + 8, cy = P.y + 8;
  const near = [];
  if (cy < 40 && cx > 106 && cx < 150) near.push('up');
  if (cy > K.VIEW_H - 40 && cx > 106 && cx < 150) near.push('down');
  if (cx < 44 && cy > 56 && cy < 118) near.push('left');
  if (cx > K.VIEW_W - 44 && cy > 56 && cy < 118) near.push('right');
  near.forEach(dir => {
    if (W.doorState(dir) !== 'locked') return;
    if (G.inv.magicKey || G.keys > 0) {
      if (!G.inv.magicKey) G.keys--;
      W.setDoorState(dir, 'open');
      W.refreshDoors();
      EQ.audio.sfx('door');
    } else if (Game.lockedPrompt <= 0) {
      Game.lockedPrompt = 1.4;
      EQ.audio.sfx('error');
      UI.say('THE DOOR IS LOCKED.');
    }
  });
}

/* --------------------------------------------------- entering / leaving */
function enterDungeon(n) {
  const G = EQ.G;
  const L = EQ.dungeon(n);
  W.loadDungeonRoom(n, L.entry[0], L.entry[1]);
  EQ.P.reset(116, 128, 'up');
  G.lastLevel = n;
  populateRoom();
  EQ.audio.music('dungeon');
  UI.say('LEVEL-' + n + '\n' + L.name);
}
function exitDungeon() {
  const G = EQ.G, r = G.owReturn;
  W.loadOverworld(r.col, r.row);
  EQ.P.reset(r.x, clamp(r.y + 18, 0, K.VIEW_H - 18), 'down');
  populateOverworld();
  EQ.audio.music('overworld');
}

function enterCave(id, hintIndex) {
  const G = EQ.G;
  const def = EQ.CAVES[id];
  Game.hintIndex = hintIndex || 0;
  if (!def) { exitCave(); return; }
  W.loadCave(id);
  EQ.clearEntities();
  EQ.P.reset(116, 128, 'up');
  Game.cave = buildCave(id, def);
  EQ.audio.music('cave');
  if (Game.cave.intro) UI.say(Game.cave.intro);
}
function exitCave() {
  const G = EQ.G, r = G.owReturn;
  Game.cave = null;
  W.loadOverworld(r.col, r.row);
  EQ.P.reset(r.x, clamp(r.y + 18, 0, K.VIEW_H - 20), 'down');
  populateOverworld();
  EQ.audio.music('overworld');
}

/* ------------------------------------------------------------ cave logic */
function buildCave(id, def) {
  const G = EQ.G;
  const done = G.flags.caveDone[id];
  const c = { id, def, npc: def.npc, offer: [], intro: def.text, kind: def.kind };

  const sprOf = k => {
    if (k === 'bombUp') return 'bomb';
    if (EQ.ITEMS[k] && EQ.ITEMS[k].spr) return EQ.ITEMS[k].spr;
    return k;
  };

  switch (def.kind) {
    case 'give': {
      if (done) { c.intro = 'GO ON, THEN.'; break; }
      if (def.needHearts && G.maxHearts < def.needHearts) { c.intro = def.deny; break; }
      if (def.needItem && !G.inv[def.needItem]) { c.intro = def.deny; break; }
      c.offer.push({ key: def.item, spr: sprOf(def.item), x: 120, y: 96, w:16, h:16, free:true });
      break;
    }
    case 'heart': {
      if (done) { c.intro = 'EMPTY NOW.'; break; }
      c.offer.push({ key:'heartContainer', spr:'heartContainer', x:120, y:96, w:16, h:16, free:true });
      break;
    }
    case 'shop': {
      if (def.needItem && !G.inv[def.needItem]) { c.intro = def.deny; break; }
      def.stock.forEach((s, i) => {
        c.offer.push({ key: s[0], price: s[1], spr: sprOf(s[0]), x: 62 + i * 60, y: 96, w:16, h:16 });
      });
      break;
    }
    case 'takeOne': {
      if (done) { c.intro = 'YOU CHOSE ALREADY.'; break; }
      def.stock.forEach((k, i) => {
        c.offer.push({ key: k, spr: sprOf(k), x: 62 + i * 60, y: 96, w:16, h:16, free:true, once:true });
      });
      break;
    }
    case 'gamble': {
      c.offer = [0,1,2].map(i => ({ key:'chest', spr:'rupee', x: 62 + i * 60, y: 96, w:16, h:16, gamble:true }));
      break;
    }
    case 'pay': {
      if (!done) {
        const amt = Math.min(def.amount, G.rupees);
        G.rupees -= amt;
        G.flags.caveDone[id] = true;
        c.intro = def.text;
      } else c.intro = 'MIND THE DOOR THIS TIME.';
      break;
    }
    case 'gift': {
      if (!done) { G.rupees = clamp(G.rupees + def.amount, 0, 255); G.flags.caveDone[id] = true; EQ.audio.sfx('rupee'); }
      else c.intro = 'THAT IS ALL I HAD.';
      break;
    }
    case 'hint':
      c.intro = EQ.OW_HINTS[(Game.hintIndex || 0) % EQ.OW_HINTS.length];
      break;
  }
  return c;
}

function updateCave(dt) {
  const c = Game.cave; if (!c) return;
  const G = EQ.G, P = EQ.P;
  const hb = P.hitbox();
  c.offer.forEach(o => {
    if (o.taken) return;
    o.afford = o.price === undefined || G.rupees >= o.price;
    if (!aabb(hb, o)) return;
    if (o.gamble) {
      if (G.rupees < 10) { if (Game.lockedPrompt <= 0) { Game.lockedPrompt = 1; UI.say('TEN COIN. YOU HAVE NONE.'); } return; }
      G.rupees -= 10;
      const win = pick([-10, 10, 50, -10, 20]);
      G.rupees = clamp(G.rupees + Math.max(0, win), 0, 255);
      o.taken = true;
      EQ.audio.sfx(win > 0 ? 'rupee' : 'error');
      UI.say(win > 0 ? ('YOU WIN ' + win + '.') : 'NOTHING. TRY AGAIN.');
      setTimeout(() => { o.taken = false; }, 500);
      return;
    }
    if (!o.free) {
      if (G.rupees < o.price) {
        if (Game.lockedPrompt <= 0) { Game.lockedPrompt = 1.2; EQ.audio.sfx('error'); UI.say('NOT ENOUGH COIN.'); }
        return;
      }
      G.rupees -= o.price;
    }
    o.taken = true;
    giveItem(o.key, true);
    if (o.once) { c.offer.forEach(x => { if (x !== o) x.taken = true; }); G.flags.caveDone[c.id] = true; }
    if (c.kind === 'give' || c.kind === 'heart') G.flags.caveDone[c.id] = true;
  });
}

/* ------------------------------------------------------------ item grants */
function giveItem(key, hold) {
  const G = EQ.G, P = EQ.P;
  let name = null;

  switch (key) {
    case 'heartContainer':
      G.maxHearts = clamp(G.maxHearts + 1, 1, 16);
      P.maxhp = G.maxHearts * 2; P.hp = P.maxhp;
      name = 'HEART CONTAINER'; EQ.audio.sfx('item'); break;
    case 'heart': P.heal(2); EQ.audio.sfx('heart'); return;
    case 'rupee': G.rupees = clamp(G.rupees + 1, 0, 255); EQ.audio.sfx('rupee'); return;
    case 'rupee5': G.rupees = clamp(G.rupees + 5, 0, 255); EQ.audio.sfx('rupee'); return;
    case 'key': G.keys = clamp(G.keys + 1, 0, 99); EQ.audio.sfx('key'); return;
    case 'bomb':
      G.bombs = clamp(G.bombs + 4, 0, G.bombMax); G.everBomb = true;
      if (!G.bItem) G.bItem = 'bomb';
      EQ.audio.sfx('key'); return;
    case 'bombUp':
      G.bombMax = clamp(G.bombMax + 4, 8, 16);
      G.bombs = G.bombMax; G.everBomb = true;
      name = 'BOMB SATCHEL'; EQ.audio.sfx('item'); break;
    case 'fairy': P.heal(6); EQ.audio.sfx('heart'); return;
    case 'clock':
      EQ.Ents.list.forEach(e => { if (!e.boss) e.stunned = 6; });
      EQ.audio.sfx('secret'); return;
    case 'map': G.dmap[W.level] = true; name = 'MAP'; EQ.audio.sfx('item'); break;
    case 'compass': G.dcompass[W.level] = true; name = 'COMPASS'; EQ.audio.sfx('item'); break;
    case 'shard': {
      G.shards[W.level] = true;
      name = 'TRIFORCE PIECE';
      EQ.audio.stopMusic(); EQ.audio.sfx('triforce');
      P.hp = P.maxhp;
      P.holdUp = 2.6; P.holdItem = 'shard';
      setTimeout(() => {
        const got = Object.keys(G.shards).filter(k => G.shards[k]).length;
        UI.say('TRIFORCE PIECE ' + W.level + '.\n' + got + ' OF 8 RECOVERED.', {
          onClose: () => fadeTo(() => { exitDungeon(); }),
        });
      }, 2600);
      return;
    }
    default: {
      if (EQ.ITEMS[key]) {
        G.inv[key] = true;
        name = EQ.ITEMS[key].name;
        // upgrades replace their lesser version in the B slots
        if (key === 'boomerangMagic') G.inv.boomerang = false;
        if (key === 'candleRed') G.inv.candleBlue = false;
        if (key === 'arrowSilver') G.inv.arrow = false;
        if (key === 'swordWhite' || key === 'swordMagic') { /* tiers stack */ }
        if (EQ.ITEMS[key].slot === 'b' && !G.bItem) G.bItem = key;
        if (key === 'ladder' || key === 'raft' || key === 'bracelet') { /* passive */ }
        EQ.audio.sfx('item');
      }
      break;
    }
  }

  if (hold && name) {
    P.holdUp = 1.5;
    const isr = EQ.ITEMS[key] && EQ.ITEMS[key].spr;
    P.holdItem = (isr && EQ.SPR[isr] && EQ.SPR[isr].width) ? isr
               : ((EQ.SPR[key] && EQ.SPR[key].width) ? key : 'shard');
    setTimeout(() => UI.say('YOU GOT THE ' + name + '.'), 1500);
  } else if (name) {
    UI.say('YOU GOT THE ' + name + '.');
  }
  // keep the B slot pointing at something real
  if (G.bItem && !(G.bItem === 'bomb' ? G.bombs >= 0 : G.inv[G.bItem])) G.bItem = EQ.pickNextB();
}
EQ.giveItem = giveItem;

/* ------------------------------------------------------------- the pipe */
function onPipe() {
  const G = EQ.G;
  // 1. drain the pond hiding level 7
  if (W.kind === 'ow') {
    const f = (W.screen.feats || []).find(x => x.t === 'dungeon' && x.gate === 'recorder');
    if (f && !G.flags.secrets[W.col + ',' + W.row + ':L' + f.n]) {
      G.flags.secrets[W.col + ',' + W.row + ':L' + f.n] = true;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++)
        if (W.tile(f.tx + dx, f.ty + dy) === T.WATER) {
          W.setTile(f.tx + dx, f.ty + dy, T.GROUND);
          W.rememberTile(f.tx + dx, f.ty + dy, T.GROUND);
        }
      W.setTile(f.tx, f.ty, T.DUNGEON);
      W.rememberTile(f.tx, f.ty, T.DUNGEON);
      EQ.audio.sfx('secret');
      shake(3, 0.5);
      UI.say('THE WATER PULLS BACK.');
      return;
    }
    // 2. otherwise, the wind carries you to a level you have already cleared
    const cleared = [];
    for (let i = 1; i <= 8; i++) if (G.shards[i]) cleared.push(i);
    if (!cleared.length) { UI.say('THE WIND DOES NOT ANSWER YET.'); return; }
    G.warpIdx = (G.warpIdx + 1) % cleared.length;
    const lvl = cleared[G.warpIdx];
    const ow = EQ.LEVEL_OW[lvl];
    EQ.audio.sfx('whistleWarp');
    fadeTo(() => {
      W.loadOverworld(ow[0], ow[1]);
      EQ.P.reset(112, 120, 'up');
      populateOverworld();
    });
    return;
  }
  // 3. in a dungeon: shrink Umbroth, and reveal a hidden stair
  let did = false;
  EQ.Ents.list.forEach(e => {
    if (e.bkind === 'umbroth' && !e.shrunk) {
      e.shrunk = true; e.invuln = false; e.hp = 8; e.w = 16; e.h = 16;
      e.x += 15; e.y += 15;
      EQ.audio.sfx('secret'); did = true;
    }
  });
  if (!did) UI.say('THE NOTE HANGS AND FADES.');
}

/* --------------------------------------------------------- wallmaster grab */
function onGrabbed() {
  const L = EQ.dungeon(W.level);
  EQ.audio.sfx('playerHurt');
  fadeTo(() => {
    W.loadDungeonRoom(W.level, L.entry[0], L.entry[1]);
    EQ.P.reset(116, 128, 'up');
    populateRoom();
  });
}

/* -------------------------------------------------------------- pickups */
function onPickup(d) {
  const G = EQ.G;
  if (d.tag === 'shard') { giveItem('shard', true); markTaken(); return; }
  if (d.perm) markTaken();
  giveItem(d.tag || d.kind, !!d.perm);
}
function markTaken() {
  if (W.kind !== 'dun') return;
  EQ.G.flags.taken[W.level + ':' + W.rx + ',' + W.ry] = true;
}

EQ.onPlayerDead = function () {
  EQ.audio.stopMusic();
  setTimeout(() => { EQ.audio.music('gameover'); }, 400);
};

/* ================================================================ UPDATE */
const HOOKS = { onPipe, onGrabbed, onPickup };

function update(dt) {
  Game.t += dt;
  EQ.Input.pollPad();
  updateFade(dt);
  if (Game.shakeT > 0) Game.shakeT -= dt;
  if (Game.lockedPrompt > 0) Game.lockedPrompt -= dt;

  if (EQ.Input.pressed.mute) EQ.audio.toggleMute();

  switch (Game.state) {
    case 'title':
      UI.titleHasSave = hasSave();
      if (UI.titleHasSave && (EQ.Input.pressed.up || EQ.Input.pressed.down)) {
        UI.titleSel = 1 - UI.titleSel; EQ.audio.sfx('menu');
      }
      if (EQ.Input.pressed.start || EQ.Input.pressed.a || EQ.Input.pressed.b) {
        EQ.audio.unlock();
        if (UI.titleHasSave && UI.titleSel === 0) { if (!load()) newGame(); }
        else newGame();
      }
      break;

    case 'play':      updatePlay(dt); break;
    case 'inventory': updateInventory(dt); break;

    case 'gameover':
      Game.t += 0;
      if (EQ.Input.pressed.up || EQ.Input.pressed.down) { UI.goSel = 1 - UI.goSel; EQ.audio.sfx('menu'); }
      if (EQ.Input.pressed.start || EQ.Input.pressed.a) {
        if (UI.goSel === 0) {
          const G = EQ.G;
          G.deaths++;
          EQ.P.hp = EQ.P.maxhp; EQ.P.dead = false;
          fadeTo(() => {
            if (W.kind === 'dun') {
              const L = EQ.dungeon(W.level);
              W.loadDungeonRoom(W.level, L.entry[0], L.entry[1]);
              EQ.P.reset(116, 128, 'up'); populateRoom(); EQ.audio.music('dungeon');
            } else {
              W.loadOverworld(7, 7);
              EQ.P.reset(112, 96, 'up'); populateOverworld(); EQ.audio.music('overworld');
            }
            Game.state = 'play';
          });
        } else { save(); Game.state = 'title'; Game.t = 0; EQ.audio.music('title'); }
      }
      break;

    case 'ending':
      if (Game.t > 5 && EQ.Input.pressed.start) { Game.state = 'title'; Game.t = 0; EQ.audio.music('title'); }
      break;
  }
  W.update(dt);
  EQ.Input.endFrame();
}

function updatePlay(dt) {
  const G = EQ.G, P = EQ.P;
  G.playTime += dt;

  /* a message pauses the world */
  if (UI.message) { UI.updateMessage(dt); return; }

  /* mid-scroll: nothing moves except the camera */
  if (W.scroll) { W.updateScroll(dt); return; }

  if (Game.fadeDir !== 0) return;

  /* open the inventory */
  if (EQ.Input.pressed.start) {
    Game.invOpen = true; Game.state = 'inventory';
    const owned = UI.ownedB(G);
    UI.invCursor = Math.max(0, owned.indexOf(G.bItem));
    EQ.audio.sfx('select');
    return;
  }

  if (P.dead) {
    P.update(dt, HOOKS);
    if (P.deathT > 2.6) { Game.state = 'gameover'; Game.t = 0; UI.goSel = 0; }
    return;
  }

  P.update(dt, HOOKS);
  EQ.Entities.update(dt, P);

  /* bait holds ground enemies in place */
  const bait = EQ.Ents.drops.find(d => d.bait);
  if (bait) {
    EQ.Ents.list.forEach(e => {
      if (e.boss) return;
      if (Math.hypot(e.x - bait.x, e.y - bait.y) < 44) e.stunned = Math.max(e.stunned, 0.2);
    });
  }

  /* falling rocks on the high slopes */
  if (Game.rockTimer > 0) {
    Game.rockTimer -= dt;
    if (Game.rockTimer <= 0) {
      Game.rockTimer = rnd(1.1, 2.4);
      EQ.spawnEnemy('boulder', rndi(1, 14) * 16, -12, { spawnT: 0 });
    }
  }

  /* NPC in a dungeon room */
  if (Game.roomNPC && !Game.roomNPCShown) {
    if (Math.abs(P.x - 116) < 30 && P.y < 110) {
      Game.roomNPCShown = true;
      if (Game.roomNPC.bombUp && !G.flags.oneOff['bombup:' + W.level]) {
        G.flags.oneOff['bombup:' + W.level] = true;
        giveItem('bombUp', false);
      } else if (Game.roomNPC.ending) {
        finishGame();
        return;
      } else UI.say(Game.roomNPC.text);
    }
  } else if (!Game.roomNPC) Game.roomNPCShown = false;

  checkPush(dt);
  checkDoors();
  checkWarps();
  if (W.kind === 'cave') updateCave(dt);
  if (!tryScreenChange()) {
    P.x = clamp(P.x, -4, K.VIEW_W - 12);
    P.y = clamp(P.y, -4, K.VIEW_H - 12);
  }

  /* low-health warning */
  if (P.hp <= 2 && !P.dead) {
    Game.lowT = (Game.lowT || 0) - dt;
    if (Game.lowT <= 0) { Game.lowT = 0.62; EQ.audio.sfx('lowHealth'); }
  }
}

/* Lean on a marked stone long enough, with the strength to move it. */
function checkPush(dt) {
  const P = EQ.P, G = EQ.G;
  const d = EQ.Input.dir();
  if ((!d.dx && !d.dy) || P.attack > 0) { Game.pushT = 0; return; }
  const V = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[P.dir];
  const tx = Math.floor((P.x + 8) / 16) + V[0];
  const ty = Math.floor((P.y + 10) / 16) + V[1];
  if (!W.solidAt(tx, ty)) { Game.pushT = 0; return; }
  if (W.kind === 'ow') {
    const f = W.featAt(tx, ty);
    if (!f || f.gate !== 'push') { Game.pushT = 0; return; }
    if (!G.inv.bracelet) { Game.pushT = 0; return; }
  }
  Game.pushT = (Game.pushT || 0) + dt;
  if (Game.pushT > 0.55) { Game.pushT = 0; W.pushAt(tx, ty, P.dir); }
}

function updateInventory(dt) {
  Game.invSlide = Math.min(1, (Game.invSlide || 0) + dt * 5);
  UI.invInput(EQ.G);
  if (EQ.Input.pressed.start) {
    Game.invOpen = false; Game.state = 'play'; Game.invSlide = 0;
    EQ.audio.sfx('select');
  }
}

function finishGame() {
  EQ.audio.stopMusic();
  EQ.audio.music('ending');
  Game.state = 'ending'; Game.t = 0;
  save();
}

/* ================================================================== DRAW */
function draw(ctx) {
  ctx.save();
  if (Game.shakeT > 0) {
    ctx.translate(rnd(-Game.shakeMag, Game.shakeMag), rnd(-Game.shakeMag, Game.shakeMag));
  }

  if (Game.state === 'title') { UI.drawTitle(ctx, Game.t); ctx.restore(); drawFade(ctx); return; }
  if (Game.state === 'ending') { UI.drawEnding(ctx, Game.t); ctx.restore(); drawFade(ctx); return; }
  if (Game.state === 'gameover') { UI.drawGameOver(ctx, Game.t); ctx.restore(); drawFade(ctx); return; }

  const G = EQ.G, P = EQ.P;

  /* status bar */
  UI.drawHUD(ctx, G);

  /* play area */
  ctx.save();
  ctx.beginPath(); ctx.rect(0, K.HUD_H, K.VIEW_W, K.VIEW_H); ctx.clip();
  ctx.translate(0, K.HUD_H);

  W.draw(ctx);

  const off = W.scroll ? W.scrollOffset() : { x:0, y:0 };
  if (W.kind === 'cave' && Game.cave) UI.drawCaveScene(ctx, Game.cave, G);

  if (!W.scroll) {
    EQ.Entities.draw(ctx);
    P.draw(ctx, 0, 0);
    W.drawDark(ctx, P.x + 8, P.y + 8);
  } else {
    P.draw(ctx, off.x, off.y);
  }

  ctx.restore();

  /* overlays */
  if (Game.state === 'inventory') {
    const k = Game.invSlide;
    const y = -(1 - k) * (K.HUD_H + K.VIEW_H);
    UI.drawInventory(ctx, G, y);
  }
  UI.drawMessage(ctx);

  ctx.restore();
  drawFade(ctx);
}

function drawFade(ctx) {
  if (Game.fade <= 0) return;
  ctx.fillStyle = 'rgba(0,0,0,' + clamp(Game.fade, 0, 1) + ')';
  ctx.fillRect(0, 0, K.FB_W, K.FB_H);
}

/* ================================================================= BOOT */
let canvas, ctx, scale = 3, last = 0, acc = 0;

function fitCanvas() {
  const wrap = document.getElementById('wrap');
  const availW = wrap.clientWidth, availH = wrap.clientHeight;
  const s = Math.max(1, Math.min(Math.floor(availW / K.FB_W), Math.floor(availH / K.FB_H)));
  scale = s;
  canvas.style.width = (K.FB_W * s) + 'px';
  canvas.style.height = (K.FB_H * s) + 'px';
}

function frame(ts) {
  requestAnimationFrame(frame);
  if (!last) last = ts;
  let dt = (ts - last) / 1000; last = ts;
  if (dt > 0.1) dt = 0.1;
  acc += dt;
  const STEP = 1 / 60;
  let guard = 0;
  while (acc >= STEP && guard++ < 4) { update(STEP); acc -= STEP; }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, K.FB_W, K.FB_H);
  draw(ctx);
}

EQ.boot = function () {
  canvas = document.getElementById('screen');
  canvas.width = K.FB_W; canvas.height = K.FB_H;
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  EQ.buildArt();
  EQ.compileAllDungeons();
  EQ.Input.init();
  EQ.G = freshState();

  addEventListener('resize', fitCanvas);
  fitCanvas();

  Game.state = 'title';
  EQ.audio.music('title');

  document.getElementById('loading') && document.getElementById('loading').remove();
  requestAnimationFrame(frame);
};

EQ.newGameFromMenu = function () { Game.newPressed = true; newGame(); };

/* Deterministic stepping — used by automated checks, and handy when the tab
   is backgrounded and requestAnimationFrame is throttled. */
EQ.__populate = function () { if (W.kind === 'dun') populateRoom(); else populateOverworld(); };
EQ.tick = function (frames, dt) {
  dt = dt || 1 / 60;
  for (let i = 0; i < (frames || 1); i++) update(dt);
  if (ctx) { ctx.clearRect(0, 0, K.FB_W, K.FB_H); draw(ctx); }
};
EQ.press = function (btn, frames) {
  EQ.Input.set(btn, true); EQ.tick(1);
  if (frames > 1) EQ.tick(frames - 1);
  EQ.Input.set(btn, false); EQ.tick(1);
};
EQ.hold = function (btn, frames) {
  EQ.Input.set(btn, true); EQ.tick(frames || 30); EQ.Input.set(btn, false); EQ.tick(1);
};

})(window);
