/* ============================================================================
   EMBERQUEST — world.js
   Owns whatever area is on screen: an overworld screen, a dungeon room, or a
   cave interior. Handles tile building, collision, screen transitions and
   every kind of buried secret.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;
const T = EQ.T, K = EQ.K;
const CW = 16, CH = 11;
const idx = (x, y) => y * CW + x;

const World = EQ.World = {
  kind: 'ow',            // ow | dun | cave
  col: 7, row: 7,        // overworld position
  level: 0, rx: 3, ry: 7,// dungeon position
  caveId: null, caveReturn: null,
  tiles: new Uint8Array(CW * CH),
  mask:  new Uint8Array(CW * CH),   // authoritative collision for overworld screens
  biome: 'grass',
  room: null,
  dark: false, lit: 0,
  scroll: null,          // active transition
  waterFrame: 0, fireFrame: 0, _animT: 0,

  /* ------------------------------------------------------------- helpers */
  tile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= CW || ty >= CH) return T.MTN;
    return this.tiles[idx(tx, ty)];
  },
  setTile(tx, ty, v) {
    if (tx < 0 || ty < 0 || tx >= CW || ty >= CH) return;
    const i = idx(tx, ty);
    this.tiles[i] = v;
    this.mask[i] = EQ.SOLID[v] ? 1 : 0;
  },

  /* Collision. Overworld screens use the mask lifted from the original map;
     dungeons and caves fall back to the tile table. */
  solidAt(tx, ty, opts) {
    if (tx < 0 || ty < 0 || tx >= CW || ty >= CH) return true;
    if (opts && opts.fly) return false;
    const i = idx(tx, ty), v = this.tiles[i];
    if (v === T.DWATER) return !(opts && opts.ladder);
    if (this.kind === 'ow') return !!this.mask[i];
    return !!EQ.SOLID[v];
  },

  /* Is this tile solid for the given actor?  opts.ladder / opts.fly relax it. */
  solidTile(v, opts) {
    opts = opts || {};
    if (opts.fly) return false;
    if (v === T.DWATER || v === T.WATER) {
      if (opts.ladder && v === T.DWATER) return false;
      if (opts.swim) return false;
      return true;
    }
    return !!EQ.SOLID[v];
  },

  /* Rectangle test in pixel space (relative to the play area). */
  blocked(x, y, w, h, opts) {
    const x0 = Math.floor(x / 16), x1 = Math.floor((x + w - 1) / 16);
    const y0 = Math.floor(y / 16), y1 = Math.floor((y + h - 1) / 16);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++)
      if (this.solidAt(tx, ty, opts)) return true;
    return false;
  },

  /* Does a rect sit entirely on tiles matching a predicate? */
  allTiles(x, y, w, h, pred) {
    const x0 = Math.floor(x / 16), x1 = Math.floor((x + w - 1) / 16);
    const y0 = Math.floor(y / 16), y1 = Math.floor((y + h - 1) / 16);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++)
      if (!pred(this.tile(tx, ty), tx, ty)) return false;
    return true;
  },

  /* ------------------------------------------------------- area switching */
  loadOverworld(col, row) {
    const sc = EQ.OVERWORLD.screen(col, row);
    if (!sc) return false;
    this.kind = 'ow'; this.col = col; this.row = row;
    this.biome = sc.biome; this.room = null; this.dark = false;
    this.tiles.set(sc.tiles);
    this.mask.set(sc.solid);
    this.screen = sc;
    this.applyOverworldFlags();
    return true;
  },

  /* Anything already opened stays open. */
  featKey(f) {
    return this.col + ',' + this.row + ':' + f.tx + ',' + f.ty;
  },
  applyOverworldFlags() {
    const G = EQ.G, key = this.col + ',' + this.row;
    (this.screen.feats || []).forEach(f => {
      if (!f.gate) return;
      if (!G.flags.secrets[this.featKey(f)]) return;
      this.setTile(f.tx, f.ty, f.t === 'dungeon' ? T.DUNGEON : T.CAVE);
      if (f.gate === 'recorder') {
        for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++)
          if (this.tile(f.tx + dx, f.ty + dy) === T.WATER)
            this.setTile(f.tx + dx, f.ty + dy, T.GROUND);
      }
    });
    const cleared = G.flags.cleared[key];
    if (cleared) cleared.forEach(p => this.setTile(p[0], p[1], p[2]));
  },

  loadDungeonRoom(level, rx, ry) {
    const L = EQ.dungeon(level);
    const room = L._rooms[rx + ',' + ry];
    if (!room) return false;
    this.kind = 'dun'; this.level = level; this.rx = rx; this.ry = ry;
    this.room = room; this.biome = 'grass';
    this.dark = room.dark && !EQ.G.flags.litRooms[level + ':' + rx + ',' + ry];
    this.lit = 0;
    this.buildRoomTiles();
    return true;
  },

  doorState(dir) {
    const room = this.room; if (!room) return 'wall';
    const k = this.level + ':' + this.rx + ',' + this.ry + ':' + dir;
    const forced = EQ.G.flags.doors[k];
    if (forced) return forced;
    return room.doors[dir];
  },
  setDoorState(dir, v) {
    const OPP = { up:'down', down:'up', left:'right', right:'left' };
    const DX = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
    EQ.G.flags.doors[this.level + ':' + this.rx + ',' + this.ry + ':' + dir] = v;
    EQ.G.flags.doors[this.level + ':' + (this.rx + DX[0]) + ',' + (this.ry + DX[1]) + ':' + OPP[dir]] = v;
  },

  buildRoomTiles() {
    const room = this.room, L = EQ.dungeon(this.level);
    const t = this.tiles;
    for (let i = 0; i < t.length; i++) t[i] = T.DWALL;
    const lay = room.grid || EQ.LAYOUTS[room.lay] || EQ.LAYOUTS.plain;
    for (let y = 0; y < 7; y++) {
      const line = lay[y] || '';
      for (let x = 0; x < 12; x++) {
        const ch = line[x] || '.';
        const v = ch === '#' ? T.DBLOCK : ch === '~' ? T.DWATER : ch === 'S' ? T.DSTATUE
                : ch === 'P' ? T.DBLOCKP : ch === 'F' ? T.DFIRE : ch === 'B' ? T.DSAND : T.DFLOOR;
        t[idx(2 + x, 2 + y)] = v;
      }
    }
    // doorways
    const open = d => { const s = this.doorState(d); return s === 'open'; };
    this.shutters = {};
    ['up','down','left','right'].forEach(d => {
      const s = this.doorState(d);
      if (s === 'wall') return;
      const passable = (s === 'open');
      if (d === 'up')    for (let x = 7; x <= 8; x++) for (let y = 0; y <= 1; y++) t[idx(x, y)] = passable ? T.DFLOOR : T.DWALL;
      if (d === 'down')  for (let x = 7; x <= 8; x++) for (let y = 9; y <= 10; y++) t[idx(x, y)] = passable ? T.DFLOOR : T.DWALL;
      if (d === 'left')  for (let y = 4; y <= 6; y++) for (let x = 0; x <= 1; x++) t[idx(x, y)] = passable ? T.DFLOOR : T.DWALL;
      if (d === 'right') for (let y = 4; y <= 6; y++) for (let x = 14; x <= 15; x++) t[idx(x, y)] = passable ? T.DFLOOR : T.DWALL;
    });
    // a stair down into one of the grey passages
    if (room.stairTo && room.stairTo.length) { t[idx(4, 5)] = T.DSTAIRS; }
    // inside a passage, a stair back out at each end
    if (room.passage) { t[idx(3, 5)] = T.DSTAIRS; t[idx(12, 5)] = T.DSTAIRS; }
    this.syncMask();
  },

  syncMask() {
    for (let i = 0; i < this.tiles.length; i++)
      this.mask[i] = EQ.SOLID[this.tiles[i]] ? 1 : 0;
  },

  /* Recompute door tiles without rebuilding the whole room (shutters). */
  refreshDoors() {
    const t = this.tiles;
    ['up','down','left','right'].forEach(d => {
      const s = this.doorState(d);
      if (s === 'wall') return;
      const shut = this.shutters && this.shutters[d];
      const passable = (s === 'open') && !shut;
      if (d === 'up')    for (let x = 7; x <= 8; x++) for (let y = 0; y <= 1; y++) t[idx(x, y)] = passable ? T.DFLOOR : T.DWALL;
      if (d === 'down')  for (let x = 7; x <= 8; x++) for (let y = 9; y <= 10; y++) t[idx(x, y)] = passable ? T.DFLOOR : T.DWALL;
      if (d === 'left')  for (let y = 4; y <= 6; y++) for (let x = 0; x <= 1; x++) t[idx(x, y)] = passable ? T.DFLOOR : T.DWALL;
      if (d === 'right') for (let y = 4; y <= 6; y++) for (let x = 14; x <= 15; x++) t[idx(x, y)] = passable ? T.DFLOOR : T.DWALL;
    });
    this.syncMask();
  },

  closeShutters() {
    this.shutters = { up:true, down:true, left:true, right:true };
    this.refreshDoors();
    EQ.audio.sfx('shutter');
  },
  openShutters() {
    if (!this.shutters || !Object.keys(this.shutters).length) return;
    this.shutters = {};
    this.refreshDoors();
    EQ.audio.sfx('shutter');
  },

  loadCave(caveId) {
    this.kind = 'cave'; this.caveId = caveId;
    const t = this.tiles;
    for (let i = 0; i < t.length; i++) t[i] = T.DVOID;
    // a walkable strip across the middle of the cave
    for (let y = 4; y <= 8; y++) for (let x = 1; x < 15; x++) t[idx(x, y)] = T.DFLOOR;
    for (let x = 6; x <= 9; x++) t[idx(x, 9)] = T.DFLOOR;
    for (let x = 6; x <= 9; x++) t[idx(x, 10)] = T.DSTAIRS;
    this.dark = false;
    this.syncMask();
    return true;
  },

  /* --------------------------------------------------------------- drawing */
  tileSet() {
    if (this.kind === 'dun') return EQ.ART.dung[this.level] || EQ.ART.dung[1];
    if (this.kind === 'cave') return EQ.ART.dung[1];
    return EQ.ART.over[this.biome] || EQ.ART.over.grass;
  },

  drawTiles(ctx, ox, oy, tiles, kindOverride, biomeOverride, levelOverride) {
    const kind = kindOverride || this.kind;
    let set;
    if (kind === 'dun') set = EQ.ART.dung[levelOverride || this.level] || EQ.ART.dung[1];
    else if (kind === 'cave') set = EQ.ART.dung[1];
    else set = EQ.ART.over[biomeOverride || this.biome] || EQ.ART.over.grass;

    const anim = EQ.ART.anim;
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const v = tiles[idx(x, y)];
        let img;
        if (v === T.WATER)       img = anim.water[this.waterFrame];
        else if (v === T.WFALL)  img = anim.wfall[this.waterFrame];
        else if (v === T.DWATER) img = anim.dwater[this.waterFrame];
        else if (v === T.DFIRE)  img = anim.dfire[this.fireFrame];
        else if (v === T.GROUND && set.gv) img = set.gv[(x * 7 + y * 13) % 3];
        else if (v === T.DFLOOR && set.fv) img = set.fv[(x * 5 + y * 11) % 3];
        else if (v === T.MTN && set.mv)    img = set.mv[(x * 3 + y * 7) % 3];
        else if (v === T.TREE && set.tv)   img = set.tv[(x + y) % 2];
        else img = set[v];
        if (!img) img = set[T.GROUND] || set[T.DFLOOR];
        if (img) ctx.drawImage(img, ox + x * 16, oy + y * 16);
      }
    }
  },

  draw(ctx) {
    if (this.kind === 'cave') {
      ctx.drawImage(EQ.ART.caveBg, 0, 0);
      return;
    }
    if (this.scroll) { this.drawScroll(ctx); return; }
    this.drawTiles(ctx, 0, 0, this.tiles);
    if (this.kind === 'dun') this.drawDoorDressing(ctx, 0, 0);
  },

  /* Locks, shutters and the mortar around a doorway. */
  drawDoorDressing(ctx, ox, oy) {
    const p = EQ.DPAL[this.level] || EQ.DPAL[1];
    const draw = (dir) => {
      const s = this.doorState(dir);
      const shut = this.shutters && this.shutters[dir];
      if (s === 'wall') return;
      let x, y, w, h;
      if (dir === 'up')    { x = 7*16; y = 0;      w = 32; h = 32; }
      if (dir === 'down')  { x = 7*16; y = 9*16;   w = 32; h = 32; }
      if (dir === 'left')  { x = 0;    y = 4*16;   w = 32; h = 48; }
      if (dir === 'right') { x = 14*16;y = 4*16;   w = 32; h = 48; }
      ctx.save(); ctx.translate(ox, oy);
      if (s === 'locked') {
        ctx.fillStyle = p.b1; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#f6c32e';
        const cx = x + w / 2, cy = y + h / 2;
        ctx.fillRect(cx - 3, cy - 1, 6, 8);
        ctx.strokeStyle = '#f6c32e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy - 2, 3, Math.PI, 0); ctx.stroke();
      } else if (shut) {
        ctx.fillStyle = p.b0; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = p.wd;
        for (let i = 4; i < (dir === 'up' || dir === 'down' ? h : h); i += 5) ctx.fillRect(x, y + i, w, 1);
      } else if (s === 'open') {
        ctx.fillStyle = p.stl;
        if (dir === 'up' || dir === 'down') { ctx.fillRect(x - 3, y, 3, h); ctx.fillRect(x + w, y, 3, h); }
        else { ctx.fillRect(x, y - 3, w, 3); ctx.fillRect(x, y + h, w, 3); }
      }
      ctx.restore();
    };
    ['up','down','left','right'].forEach(draw);
  },

  /* Darkness overlay for unlit dungeon rooms. */
  drawDark(ctx, px, py) {
    if (!this.dark || this.lit > 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(4,3,10,0.90)';
    ctx.fillRect(0, 0, K.VIEW_W, K.VIEW_H);
    const g = ctx.createRadialGradient(px, py, 4, px, py, 46);
    g.addColorStop(0, 'rgba(255,220,150,0.55)');
    g.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.fillRect(px - 60, py - 60, 120, 120);
    ctx.restore();
  },

  /* ---------------------------------------------------------- transitions */
  startScroll(dir, onDone) {
    const from = new Uint8Array(this.tiles);
    const fromMask = new Uint8Array(this.mask);
    const fromKind = this.kind, fromBiome = this.biome, fromLevel = this.level;
    const fromRoom = this.room, fromShut = this.shutters;
    let ok = false;
    if (this.kind === 'ow') {
      const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
      ok = this.loadOverworld(this.col + d[0], this.row + d[1]);
    } else if (this.kind === 'dun') {
      const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
      ok = this.loadDungeonRoom(this.level, this.rx + d[0], this.ry + d[1]);
    }
    if (!ok) {
      this.tiles.set(from); this.mask.set(fromMask); this.kind = fromKind; this.biome = fromBiome;
      this.level = fromLevel; this.room = fromRoom; this.shutters = fromShut;
      return false;
    }
    this.scroll = {
      dir, t: 0, dur: this.kind === 'dun' ? 0.34 : 0.42,
      from, fromKind, fromBiome, fromLevel, fromRoom, onDone,
    };
    return true;
  },

  drawScroll(ctx) {
    const s = this.scroll, k = Math.min(1, s.t / s.dur);
    const e = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;
    const D = { up:[0,1], down:[0,-1], left:[1,0], right:[-1,0] }[s.dir];
    const W = K.VIEW_W, H = K.VIEW_H;
    const ox = Math.round(D[0] * W * e), oy = Math.round(D[1] * H * e);
    // outgoing screen
    this.drawTiles(ctx, ox, oy, s.from, s.fromKind, s.fromBiome, s.fromLevel);
    // incoming screen
    const nx = ox - D[0] * W, ny = oy - D[1] * H;
    this.drawTiles(ctx, nx, ny, this.tiles);
    if (this.kind === 'dun') this.drawDoorDressing(ctx, nx, ny);
  },

  updateScroll(dt) {
    if (!this.scroll) return null;
    this.scroll.t += dt;
    const s = this.scroll;
    const k = Math.min(1, s.t / s.dur);
    if (k >= 1) { this.scroll = null; if (s.onDone) s.onDone(); return 'done'; }
    return 'busy';
  },
  scrollOffset() {
    const s = this.scroll; if (!s) return { x:0, y:0, k:0 };
    const k = Math.min(1, s.t / s.dur);
    const e = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;
    const D = { up:[0,1], down:[0,-1], left:[1,0], right:[-1,0] }[s.dir];
    return { x: Math.round(D[0]*K.VIEW_W*e) - D[0]*K.VIEW_W,
             y: Math.round(D[1]*K.VIEW_H*e) - D[1]*K.VIEW_H, k };
  },

  /* -------------------------------------------------------------- secrets */
  featAt(tx, ty) {
    if (this.kind !== 'ow' || !this.screen) return null;
    return (this.screen.feats || []).find(f => f.tx === tx && f.ty === ty) || null;
  },

  /* Called when a bomb goes off, a bush burns, or a grave is shifted. */
  reveal(tx, ty, how) {
    const G = EQ.G;
    if (this.kind !== 'ow') return null;
    const f = this.featAt(tx, ty);
    if (!f || f.gate !== how) return null;
    G.flags.secrets[this.featKey(f)] = true;
    const v = (f.t === 'dungeon') ? T.DUNGEON : T.CAVE;
    this.setTile(tx, ty, v);
    this.rememberTile(tx, ty, v);
    if (how === 'recorder') {
      for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++)
        if (this.tile(tx + dx, ty + dy) === T.WATER) {
          this.setTile(tx + dx, ty + dy, T.GROUND);
          this.rememberTile(tx + dx, ty + dy, T.GROUND);
        }
    }
    EQ.audio.sfx('secret');
    return f.t === 'dungeon' ? 'dungeon' : 'cave';
  },

  rememberTile(tx, ty, v) {
    const G = EQ.G, key = this.col + ',' + this.row;
    (G.flags.cleared[key] = G.flags.cleared[key] || []).push([tx, ty, v]);
  },

  /* Burn a bush or tree; may reveal an entrance. */
  burnAt(tx, ty) {
    const v = this.tile(tx, ty);
    if (v !== T.BUSH && v !== T.TREE) return false;
    if (!this.reveal(tx, ty, 'burn')) {
      this.setTile(tx, ty, T.GROUND);
      this.rememberTile(tx, ty, T.GROUND);
    }
    EQ.audio.sfx('burn');
    return true;
  },

  /* A bomb blast opens marked walls, and bomb-doors in a dungeon. */
  bombAt(px, py) {
    const tx = Math.floor(px / 16), ty = Math.floor(py / 16);
    let hit = false;
    if (this.kind === 'ow') {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (this.reveal(tx + dx, ty + dy, 'bomb')) hit = true;
    }
    if (this.kind === 'dun') hit = this.bombWalls(tx, ty) || hit;
    return hit;
  },

  bombWalls(tx, ty) {
    let hit = false;
    const tryDir = (dir, cond) => {
      if (!cond || this.doorState(dir) !== 'bomb') return;
      this.setDoorState(dir, 'open');
      this.refreshDoors();
      EQ.audio.sfx('secret');
      hit = true;
    };
    tryDir('up',    ty <= 2 && tx >= 6 && tx <= 9);
    tryDir('down',  ty >= 8 && tx >= 6 && tx <= 9);
    tryDir('left',  tx <= 2 && ty >= 3 && ty <= 7);
    tryDir('right', tx >= 13 && ty >= 3 && ty <= 7);
    return hit;
  },

  /* Push a marked gravestone, or shift a dungeon block. */
  pushAt(tx, ty, dir) {
    if (this.kind === 'ow') {
      if (this.reveal(tx, ty, 'push')) return true;
      return false;
    }
    const v = this.tile(tx, ty);
    const D = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
    if (this.kind === 'dun' && v === T.DBLOCKP) {
      const nx = tx + D[0], ny = ty + D[1];
      if (this.solidAt(nx, ny)) return false;
      const rk = this.level + ':' + this.rx + ',' + this.ry;
      if (EQ.G.flags.pushed[rk]) return false;
      EQ.G.flags.pushed[rk] = true;
      this.setTile(nx, ny, T.DBLOCKP);
      this.setTile(tx, ty, T.DSTAIRS);
      EQ.audio.sfx('push');
      EQ.audio.sfx('secret');
      return true;
    }
    return false;
  },

  /* ------------------------------------------------------------- ticking */
  update(dt) {
    this._animT += dt;
    this.waterFrame = Math.floor(this._animT * 5) % 4;
    this.fireFrame = Math.floor(this._animT * 6) % 2;
    if (this.lit > 0) this.lit -= dt;
  },
};

})(window);
