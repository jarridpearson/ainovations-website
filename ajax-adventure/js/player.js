/* ============================================================================
   EMBERQUEST — player.js
   Kael: movement, the sword (and its beam), the shield, and every B-item.
   Health is counted in half-hearts.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;
const K = EQ.K, T = EQ.T, W = EQ.World;
const { clamp, rnd, dist, aabb } = EQ.util;
const DV = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
const OPP = { up:'down', down:'up', left:'right', right:'left' };

const P = EQ.P = {
  x: 120, y: 88, dir: 'down', w: 16, h: 16,
  speed: 92, moving: false, frame: 0, walkT: 0,
  hp: 6, maxhp: 6,
  inv: 0, flash: 0, kb: 0, kbx: 0, kby: 0,
  attack: 0, attackDur: 0.30, swung: false,
  useT: 0, useKind: null,
  trapped: 0, jinx: 0, holdUp: 0, holdItem: null,
  boomerangOut: false, bombsOut: 0,
  dead: false, deathT: 0, spinT: 0,
  candleUsed: false,          // blue lantern: one flame per screen
  raftT: 0, raftDir: null,
  lastSafe: { x: 120, y: 88 },

  /* --------------------------------------------------------------- helpers */
  box() { return { x: this.x + 2, y: this.y + 6, w: 12, h: 9 }; },
  hitbox() { return { x: this.x + 1, y: this.y + 2, w: 14, h: 13 }; },
  cx() { return this.x + 8; },
  cy() { return this.y + 8; },
  full() { return this.hp >= this.maxhp; },

  reset(x, y, dir) {
    this.x = x; this.y = y; this.dir = dir || 'down';
    this.inv = 0; this.kb = 0; this.attack = 0; this.useT = 0;
    this.trapped = 0; this.jinx = 0; this.dead = false; this.deathT = 0;
    this.boomerangOut = false; this.candleUsed = false; this.raftT = 0;
  },

  sprSet() {
    const G = EQ.G;
    if (G.inv.ringRed) return EQ.SPR.kaelRed;
    if (G.inv.ringBlue) return EQ.SPR.kaelBlue;
    return EQ.SPR.kael;
  },

  swordTier() {
    const G = EQ.G;
    return G.inv.swordMagic ? 3 : G.inv.swordWhite ? 2 : G.inv.swordWood ? 1 : 0;
  },
  swordDamage() { const t = this.swordTier(); return t === 3 ? 8 : t === 2 ? 4 : 2; },

  /* ------------------------------------------------------------------ tick */
  update(dt, hooks) {
    const G = EQ.G;
    if (this.dead) { this.deathT += dt; return; }

    if (this.inv > 0) this.inv -= dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.jinx > 0) this.jinx -= dt;
    if (this.holdUp > 0) { this.holdUp -= dt; if (this.holdUp <= 0) this.holdItem = null; return; }

    /* knockback overrides input */
    if (this.kb > 0) {
      this.kb -= dt;
      this.tryMove(this.kbx * 210 * dt, this.kby * 210 * dt);
      return;
    }

    if (this.trapped > 0) {
      this.trapped -= dt;
      // mash to escape
      if (EQ.Input.pressed.a || EQ.Input.pressed.b) this.trapped -= 0.12;
      return;
    }

    /* riding the raft: no control until the crossing finishes */
    if (this.raftT > 0) {
      this.raftT -= dt;
      const d = DV[this.raftDir];
      this.x += d[0] * 52 * dt; this.y += d[1] * 52 * dt;
      this.dir = this.raftDir;
      return;
    }

    /* --- attack --------------------------------------------------------- */
    if (this.attack > 0) {
      this.attack -= dt;
      if (this.attack <= 0) { this.attack = 0; this.swung = false; }
    }
    if (this.useT > 0) { this.useT -= dt; if (this.useT <= 0) this.useKind = null; }

    const busy = this.attack > 0 || this.useT > 0;

    /* --- movement ------------------------------------------------------- */
    const inDir = EQ.Input.dir();
    this.moving = false;
    if (!busy && (inDir.dx || inDir.dy)) {
      // one axis at a time, like the original
      let dx = 0, dy = 0;
      if (inDir.dx && inDir.dy) {
        if (this.dir === 'left' || this.dir === 'right') dy = inDir.dy, this.dir = inDir.dy < 0 ? 'up' : 'down';
        else dx = inDir.dx, this.dir = inDir.dx < 0 ? 'left' : 'right';
      } else if (inDir.dx) { dx = inDir.dx; this.dir = dx < 0 ? 'left' : 'right'; }
      else { dy = inDir.dy; this.dir = dy < 0 ? 'up' : 'down'; }

      const sp = this.speed * dt;
      const moved = this.tryMove(dx * sp, dy * sp, true);
      this.moving = moved;
      if (moved) { this.walkT += dt; this.frame = Math.floor(this.walkT * 7) % 2; }
    }

    /* --- buttons -------------------------------------------------------- */
    if (!busy) {
      if (EQ.Input.pressed.a) this.swing();
      if (EQ.Input.pressed.b) this.useItem(hooks);
    }

    /* --- sword hitbox --------------------------------------------------- */
    if (this.attack > 0) {
      const k = 1 - this.attack / this.attackDur;
      if (k > 0.15 && k < 0.75) this.swordHits();
    }

    /* --- pick things up, take hits ------------------------------------- */
    this.collect(hooks);
    this.takeContact(dt, hooks);
    this.takeShots(hooks);

    /* remember a safe tile for wallmaster / pit recovery */
    if (!W.blocked(this.x + 2, this.y + 6, 12, 9)) { this.lastSafe.x = this.x; this.lastSafe.y = this.y; }
  },

  /* Move with wall-sliding: if blocked head-on, try nudging along the wall. */
  tryMove(dx, dy, allowSlide) {
    const opts = this.moveOpts();
    let moved = false;
    if (dx) {
      if (!W.blocked(this.x + dx + 2, this.y + 6, 12, 9, opts)) { this.x += dx; moved = true; }
      else if (allowSlide) {
        for (const ny of [-3, 3, -6, 6]) {
          if (!W.blocked(this.x + dx + 2, this.y + ny + 6, 12, 9, opts)) {
            this.y += Math.sign(ny) * Math.min(Math.abs(dx) * 1.4, Math.abs(ny));
            moved = true; break;
          }
        }
      }
    }
    if (dy) {
      if (!W.blocked(this.x + 2, this.y + dy + 6, 12, 9, opts)) { this.y += dy; moved = true; }
      else if (allowSlide) {
        for (const nx of [-3, 3, -6, 6]) {
          if (!W.blocked(this.x + nx + 2, this.y + dy + 6, 12, 9, opts)) {
            this.x += Math.sign(nx) * Math.min(Math.abs(dy) * 1.4, Math.abs(nx));
            moved = true; break;
          }
        }
      }
    }
    return moved;
  },

  moveOpts() {
    const G = EQ.G;
    return { ladder: !!G.inv.ladder };
  },

  /* -------------------------------------------------------------- the sword */
  swing() {
    const G = EQ.G;
    if (!this.swordTier()) { return; }
    if (this.jinx > 0) { EQ.audio.sfx('error'); return; }
    this.attack = this.attackDur; this.swung = false;
    EQ.audio.sfx('sword');
    if (this.full() && this.hp === this.maxhp) {
      const d = DV[this.dir];
      EQ.spawnShot('beam', this.cx() - 4 + d[0] * 12, this.cy() - 4 + d[1] * 12, this.dir,
        { from:'player', dmg: this.swordDamage(), sp: 210, life: 1.2,
          onWall: (s) => EQ.burst(s.x + 4, s.y + 4, 6, '#bfe8ff') });
      EQ.audio.sfx('beam');
    }
  },

  swordRect() {
    const d = DV[this.dir];
    const len = 15;
    if (this.dir === 'left')  return { x: this.x - len + 4, y: this.y + 4, w: len, h: 10 };
    if (this.dir === 'right') return { x: this.x + 12,      y: this.y + 4, w: len, h: 10 };
    if (this.dir === 'up')    return { x: this.x + 3, y: this.y - len + 4, w: 10, h: len };
    return { x: this.x + 3, y: this.y + 12, w: 10, h: len };
  },

  swordHits() {
    const r = this.swordRect();
    EQ.Ents.list.forEach(e => {
      if (e.dead || e.hidden) return;
      if (!aabb(r, { x: e.x, y: e.y, w: e.w, h: e.h })) return;
      if (e.jinx) { this.jinx = 3.2; EQ.audio.sfx('error'); e.inv = 0.5; return; }
      if (e.bkind === 'grovak' && e.stun > 0) { EQ.hurtEnemy(e, 99, this.dir, 'swordFinish'); return; }
      EQ.hurtEnemy(e, this.swordDamage(), this.dir, 'sword');
    });
    // heads and orbiters have their own hit tests
    EQ.Ents.list.forEach(e => {
      if (e.bkind === 'vellthorn') e.heads.forEach(h => {
        if (!h.alive) return;
        const hx = e.x + Math.cos(h.a) * 22, hy = e.y + Math.sin(h.a) * 22;
        if (aabb(r, { x: hx - 8, y: hy - 8, w: 16, h: 16 })) {
          if (h.inv > 0) return;
          h.hp -= this.swordDamage(); h.inv = 0.3;
          EQ.audio.sfx('bossHit');
          if (h.hp <= 0) { h.alive = false; EQ.burst(hx, hy, 12, '#9cff8a'); }
        }
      });
      if (e.bkind === 'skalgar') e.necks.forEach(n => {
        if (!n.alive) return;
        const hx = n.flying ? n.fx + 8 : e.x + 15 + Math.cos(n.a) * n.r;
        const hy = n.flying ? n.fy + 8 : e.y + 15 + Math.sin(n.a) * n.r;
        if (aabb(r, { x: hx - 8, y: hy - 8, w: 16, h: 16 })) {
          if (n.inv > 0) return;
          n.hp -= this.swordDamage(); n.inv = 0.3;
          EQ.audio.sfx('bossHit');
          if (n.hp <= 0 && !n.flying) { n.flying = true; n.fx = hx - 8; n.fy = hy - 8;
                                        n.fvx = rnd(-70, 70); n.fvy = rnd(-70, 70); n.hp = 3; }
          else if (n.hp <= 0) { n.alive = false; EQ.burst(hx, hy, 12, '#9fd8e8'); }
        }
      });
      if (e.bkind === 'umbroth' && e.shrunk) EQ.hurtEnemy(e, this.swordDamage(), this.dir, 'sword');
      if (e.ai === 'patra' && e.minis) e.minis.forEach(m => {
        if (!m.alive) return;
        const mx = e.x + 8 + Math.cos(m.a) * e.orbit, my = e.y + 8 + Math.sin(m.a) * e.orbit;
        if (aabb(r, { x: mx - 8, y: my - 8, w: 16, h: 16 })) { m.alive = false; EQ.burst(mx, my, 8, '#e0c0ff'); EQ.audio.sfx('hit'); }
      });
    });
    // sword also cuts through bushes if you hold the ember blade
    if (this.swordTier() === 3) {
      const tx = Math.floor((r.x + r.w / 2) / 16), ty = Math.floor((r.y + r.h / 2) / 16);
      if (W.tile(tx, ty) === T.BUSH) W.burnAt(tx, ty);
    }
  },

  /* ------------------------------------------------------------- B-items */
  useItem(hooks) {
    const G = EQ.G;
    const it = G.bItem;
    if (!it) return;
    const d = DV[this.dir];
    const cx = this.cx() - 4, cy = this.cy() - 4;

    switch (it) {
      case 'bomb': {
        if (G.bombs <= 0) { EQ.audio.sfx('error'); return; }
        G.bombs--;
        this.useT = 0.16; this.useKind = 'bomb';
        const bx = clamp(this.x + d[0] * 14, 2, K.VIEW_W - 18);
        const by = clamp(this.y + d[1] * 14, 2, K.VIEW_H - 18);
        EQ.spawnShot('bomb', bx, by, this.dir, {
          from:'player', vx:0, vy:0, life:1.5, w:14, h:14,
          onExpire: () => this.explode(bx + 7, by + 7),
        });
        EQ.audio.sfx('bombDrop');
        break;
      }
      case 'boomerang':
      case 'boomerangMagic': {
        if (this.boomerangOut) return;
        this.boomerangOut = true;
        this.useT = 0.18; this.useKind = 'throw';
        const magic = (it === 'boomerangMagic');
        EQ.spawnShot('boomerang', cx, cy, this.dir, {
          from:'player', dmg: 0, stun: magic ? 1.6 : 1.0, sp: magic ? 175 : 145,
          out: magic ? 0.55 : 0.34, life: 5, ownerP: true, magic,
          onReturn: () => { this.boomerangOut = false; },
        });
        EQ.audio.sfx('boomerang');
        break;
      }
      case 'bow': {
        if (!G.inv.arrow && !G.inv.arrowSilver) { EQ.audio.sfx('error'); return; }
        if (G.rupees <= 0) { EQ.audio.sfx('error'); return; }
        G.rupees--;
        this.useT = 0.18; this.useKind = 'throw';
        const silver = !!G.inv.arrowSilver;
        EQ.spawnShot(silver ? 'arrowSilver' : 'arrow', cx, cy, this.dir, {
          from:'player', dmg: silver ? 8 : 4, sp: 235, life: 1.4, weapon: silver ? 'arrowSilver' : 'arrow',
        });
        EQ.audio.sfx('arrow');
        break;
      }
      case 'candleBlue':
      case 'candleRed': {
        if (it === 'candleBlue' && this.candleUsed) { EQ.audio.sfx('error'); return; }
        this.candleUsed = true;
        this.useT = 0.20; this.useKind = 'throw';
        EQ.spawnShot('flame', cx + d[0] * 12, cy + d[1] * 12, this.dir, {
          from:'player', dmg: 2, sp: 120, life: 1.5, weapon:'fire',
        });
        EQ.audio.sfx('fire');
        if (W.dark) { W.lit = 3.0; EQ.G.flags.litRooms[W.level + ':' + W.rx + ',' + W.ry] = true; }
        break;
      }
      case 'recorder': {
        this.useT = 0.9; this.useKind = 'pipe';
        EQ.audio.sfx('recorder');
        hooks && hooks.onPipe && hooks.onPipe();
        break;
      }
      case 'bait': {
        this.useT = 0.2; this.useKind = 'throw';
        EQ.addDrop('baitDrop', this.x + d[0] * 18, this.y + d[1] * 18, { perm:false, life:9, bait:true });
        break;
      }
      case 'potionBlue':
      case 'potionRed': {
        this.hp = this.maxhp;
        EQ.audio.sfx('item');
        if (it === 'potionRed') { G.inv.potionRed = false; G.inv.potionBlue = true; }
        else { G.inv.potionBlue = false; }
        G.bItem = EQ.pickNextB();
        break;
      }
      case 'rod': {
        this.useT = 0.22; this.useKind = 'throw';
        const book = !!G.inv.book;
        EQ.spawnShot('rodShot', cx + d[0] * 10, cy + d[1] * 10, this.dir, {
          from:'player', dmg: 6, sp: 190, life: 1.4, weapon:'rod',
          onWall: (s) => {
            if (!book) return;
            EQ.spawnShot('flame', s.x, s.y, this.dir, { from:'player', dmg:4, sp:0, vx:0, vy:0, life:1.6, weapon:'fire' });
          },
        });
        EQ.audio.sfx('magic');
        break;
      }
      case 'letter': EQ.audio.sfx('error'); break;
    }
  },

  explode(px, py) {
    EQ.audio.sfx('bomb');
    EQ.ring(px, py, '#ffd36a');
    EQ.burst(px, py, 18, '#ffe9a8');
    W.bombAt(px, py);
    const r = { x: px - 22, y: py - 22, w: 44, h: 44 };
    EQ.Ents.list.forEach(e => {
      if (e.dead) return;
      if (!aabb(r, { x: e.x, y: e.y, w: e.w, h: e.h })) return;
      if (e.bkind === 'grovak') {
        e.bombsEaten = (e.bombsEaten || 0) + 1;
        e.stun = 2.2; EQ.audio.sfx('bossHit');
        if (e.bombsEaten >= 2) { e.stun = 6; }
        return;
      }
      EQ.hurtEnemy(e, 4, null, 'bomb');
    });
    if (aabb(r, this.hitbox()) && this.inv <= 0) this.hurt(2, null);
  },

  /* --------------------------------------------------------- taking damage */
  hurt(dmg, fromDir) {
    const G = EQ.G;
    if (this.inv > 0 || this.dead) return;
    let d = dmg;
    if (G.inv.ringRed) d = Math.max(1, Math.round(d / 4));
    else if (G.inv.ringBlue) d = Math.max(1, Math.round(d / 2));
    this.hp -= d;
    this.inv = 1.1; this.flash = 1.1;
    if (fromDir) { const v = DV[fromDir]; this.kbx = v[0]; this.kby = v[1]; this.kb = 0.16; }
    EQ.audio.sfx('playerHurt');
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.deathT = 0; EQ.onPlayerDead && EQ.onPlayerDead(); }
  },

  heal(halves) { this.hp = clamp(this.hp + halves, 0, this.maxhp); },

  /* Does the shield stop this? Only from the facing direction, and only
     while not swinging. The warded shield also turns aside magic.            */
  blocks(shotKind, fromDir) {
    const G = EQ.G;
    if (this.attack > 0) return false;
    if (fromDir !== OPP[this.dir] && fromDir !== this.dir) {
      // fromDir is the direction the shot travels; block when it comes at our face
    }
    const facing = this.dir;
    const incoming = fromDir;
    const meets = (facing === 'left' && incoming === 'right') || (facing === 'right' && incoming === 'left')
               || (facing === 'up' && incoming === 'down') || (facing === 'down' && incoming === 'up');
    if (!meets) return false;
    if (shotKind === 'magic' || shotKind === 'beamE') return !!G.inv.shieldMagic;
    if (shotKind === 'fireball') return !!G.inv.shieldMagic;
    return true;   // rocks, spears, boomerangs, arrows
  },

  takeContact(dt, hooks) {
    if (this.inv > 0) return;
    const hb = this.hitbox();
    for (const e of EQ.Ents.list) {
      if (e.dead || e.hidden || e.spawnT > 0 || e.ghost) continue;
      if (!aabb(hb, { x: e.x, y: e.y, w: e.w, h: e.h })) continue;
      if (e.jinx) { if (this.jinx <= 0) { this.jinx = 3.2; EQ.audio.sfx('error'); } continue; }
      if (e.grab) { hooks && hooks.onGrabbed && hooks.onGrabbed(); return; }
      if (e.ai === 'eater' && !e.holding) {
        e.holding = true; e.holdT = 2.2; this.trapped = 2.2;
        const G = EQ.G;
        if (G.inv.shieldMagic) { G.inv.shieldMagic = false; EQ.audio.sfx('error'); }
        return;
      }
      const away = Math.abs(e.x - this.x) > Math.abs(e.y - this.y)
        ? (e.x < this.x ? 'right' : 'left') : (e.y < this.y ? 'down' : 'up');
      this.hurt(e.dmg, away);
      return;
    }
    // boss appendages
    for (const e of EQ.Ents.list) {
      if (!e.boss) continue;
      if (e.bkind === 'vellthorn') for (const h of e.heads) {
        if (!h.alive) continue;
        const hx = e.x + Math.cos(h.a) * 22 - 8, hy = e.y + Math.sin(h.a) * 22 - 8;
        if (aabb(hb, { x: hx, y: hy, w: 16, h: 16 })) { this.hurt(e.dmg, null); return; }
      }
      if (e.bkind === 'skalgar') for (const n of e.necks) {
        if (!n.alive) continue;
        const hx = n.flying ? n.fx : e.x + 15 + Math.cos(n.a) * n.r - 8;
        const hy = n.flying ? n.fy : e.y + 15 + Math.sin(n.a) * n.r - 8;
        if (aabb(hb, { x: hx, y: hy, w: 16, h: 16 })) { this.hurt(e.dmg, null); return; }
      }
    }
  },

  takeShots(hooks) {
    const hb = this.hitbox();
    for (let i = EQ.Ents.shots.length - 1; i >= 0; i--) {
      const s = EQ.Ents.shots[i];
      if (s.from === 'player') { this.playerShotHits(s, i); continue; }
      if (!aabb(hb, { x: s.x, y: s.y, w: s.w, h: s.h })) continue;
      const travel = Math.abs(s.vx) > Math.abs(s.vy) ? (s.vx > 0 ? 'right' : 'left') : (s.vy > 0 ? 'down' : 'up');
      if (this.blocks(s.kind, travel)) {
        EQ.audio.sfx('shieldBlock');
        EQ.burst(s.x + 4, s.y + 4, 5, '#ffffff');
        EQ.Ents.shots.splice(i, 1);
        continue;
      }
      if (s.stun) { this.trapped = Math.max(this.trapped, s.stun); EQ.Ents.shots.splice(i, 1); continue; }
      if (this.inv > 0) continue;
      this.hurt(s.dmg, travel);
      if (s.kind !== 'eboomerang') EQ.Ents.shots.splice(i, 1);
      return;
    }
  },

  /* Player projectiles hitting enemies (and scenery). */
  playerShotHits(s, i) {
    if (s.kind === 'bomb') {
      if (s.t >= s.life) { EQ.Ents.shots.splice(i, 1); s.onExpire && s.onExpire(); }
      return;
    }
    const sr = { x: s.x, y: s.y, w: s.w, h: s.h };
    for (const e of EQ.Ents.list) {
      if (e.dead || e.hidden || e.spawnT > 0) continue;
      if (!aabb(sr, { x: e.x, y: e.y, w: e.w, h: e.h })) continue;
      const dir = Math.abs(s.vx) > Math.abs(s.vy) ? (s.vx > 0 ? 'right' : 'left') : (s.vy > 0 ? 'down' : 'up');
      if (s.kind === 'boomerang') {
        if (e.pipeKill || e.ai === 'flyer' || e.ai === 'blob' || e.hp <= 1) EQ.hurtEnemy(e, 1, dir, 'boomerang');
        else { e.stunned = Math.max(e.stunned, s.stun); EQ.audio.sfx('hit'); }
        s.out = 0; return;
      }
      const weapon = s.weapon || (s.kind === 'beam' ? 'beam' : 'shot');
      if (EQ.hurtEnemy(e, s.dmg, dir, weapon)) {
        if (s.kind !== 'flame') { EQ.Ents.shots.splice(i, 1); }
        return;
      }
    }
    // boss appendages take arrows and magic too
    for (const e of EQ.Ents.list) {
      if (!e.boss) continue;
      if (e.bkind === 'vellthorn') for (const h of e.heads) {
        if (!h.alive) continue;
        const hx = e.x + Math.cos(h.a) * 22 - 8, hy = e.y + Math.sin(h.a) * 22 - 8;
        if (aabb(sr, { x: hx, y: hy, w: 16, h: 16 })) {
          h.hp -= s.dmg; EQ.audio.sfx('bossHit');
          if (h.hp <= 0) { h.alive = false; EQ.burst(hx + 8, hy + 8, 12, '#9cff8a'); }
          EQ.Ents.shots.splice(i, 1); return;
        }
      }
    }
    // the boomerang sweeps up loose pickups
    if (s.kind === 'boomerang') {
      EQ.Ents.drops.forEach(d => {
        if (aabb(sr, { x: d.x, y: d.y, w: d.w, h: d.h })) { d.x = this.x; d.y = this.y; }
      });
    }
  },

  /* ------------------------------------------------------------ pickups */
  collect(hooks) {
    const hb = this.hitbox();
    for (let i = EQ.Ents.drops.length - 1; i >= 0; i--) {
      const d = EQ.Ents.drops[i];
      if (d.bait) continue;
      if (!aabb(hb, { x: d.x, y: d.y, w: d.w, h: d.h })) continue;
      EQ.Ents.drops.splice(i, 1);
      hooks && hooks.onPickup && hooks.onPickup(d);
    }
  },

  /* -------------------------------------------------------------- drawing */
  draw(ctx, ox, oy) {
    ox = ox || 0; oy = oy || 0;
    const G = EQ.G;
    if (this.dead) { this.drawDeath(ctx, ox, oy); return; }

    const set = this.sprSet();
    let img = (set[this.dir] || set.down)[this.moving ? this.frame : 0];
    const px = Math.round(this.x + ox), py = Math.round(this.y + oy);

    // holding an item overhead
    if (this.holdUp > 0) {
      img = set.up[0];
      ctx.drawImage(img, px, py);
      const hi = EQ.SPR[this.holdItem] || EQ.SPR.shard;
      const bob = Math.sin(this.holdUp * 8) * 1;
      ctx.save(); ctx.globalAlpha = 0.9;
      ctx.drawImage(hi, px, py - 15 + bob);
      ctx.restore();
      return;
    }

    ctx.save();
    if (this.inv > 0 && Math.floor(this.flash * 22) % 2) ctx.globalAlpha = 0.45;
    // soft contact shadow
    ctx.globalAlpha *= 1;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(px + 8, py + 15, 5.5, 2.2, 0, 0, 6.28); ctx.fill();
    ctx.drawImage(img, px, py);
    if (this.jinx > 0) {
      ctx.globalAlpha = 0.6; ctx.fillStyle = '#d29bff';
      for (let i = 0; i < 3; i++) {
        const a = this.jinx * 6 + i * 2.1;
        ctx.fillRect(px + 8 + Math.cos(a) * 11, py + 2 + Math.sin(a) * 5, 2, 2);
      }
    }
    ctx.restore();

    // the blade itself
    if (this.attack > 0) {
      const k = 1 - this.attack / this.attackDur;
      const reach = k < 0.35 ? k / 0.35 : k > 0.7 ? (1 - (k - 0.7) / 0.3) : 1;
      const tier = Math.max(1, this.swordTier()) - 1;
      const sw = EQ.SPR.sword[tier][this.dir];
      const off = Math.round(6 + reach * 8);
      let sx = px, sy = py;
      if (this.dir === 'up')    { sx = px + 4; sy = py - off; }
      if (this.dir === 'down')  { sx = px + 4; sy = py + off; }
      if (this.dir === 'left')  { sx = px - off; sy = py + 4; }
      if (this.dir === 'right') { sx = px + off; sy = py + 4; }
      ctx.drawImage(sw, Math.round(sx), Math.round(sy));
    }

    // the item being used, held out in front
    if (this.useT > 0 && this.useKind === 'throw') {
      const held = EQ.SPR[G.bItem] || null;
      if (held) {
        const d = DV[this.dir];
        ctx.drawImage(held, Math.round(px + d[0] * 10), Math.round(py + d[1] * 10));
      }
    }
    if (this.useT > 0 && this.useKind === 'pipe') {
      ctx.drawImage(EQ.SPR.recorder, px, py - 6);
      ctx.save(); ctx.globalAlpha = 0.7; ctx.fillStyle = '#8ed2ff';
      for (let i = 0; i < 4; i++) {
        const a = this.useT * 7 + i * 1.6;
        ctx.fillRect(px + 10 + Math.cos(a) * 12, py - 4 + Math.sin(a) * 8 - i * 2, 2, 2);
      }
      ctx.restore();
    }
  },

  drawDeath(ctx, ox, oy) {
    const set = this.sprSet();
    const t = this.deathT;
    const px = Math.round(this.x + ox), py = Math.round(this.y + oy);
    if (t < 1.6) {
      const order = ['down','left','up','right'];
      const img = (set[order[Math.floor(t * 9) % 4]] || set.down)[0];
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(img, px, py);
      ctx.restore();
    } else if (t < 2.4) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - (t - 1.6) / 0.8);
      ctx.fillStyle = '#e33a30';
      const r = (t - 1.6) * 26;
      ctx.beginPath(); ctx.arc(px + 8, py + 8, r, 0, 6.28); ctx.fill();
      ctx.restore();
    }
  },
};

/* Choose whichever B-item is available when the current one is used up. */
EQ.pickNextB = function () {
  const G = EQ.G;
  for (const k of EQ.B_ITEMS) {
    if (k === 'bomb') { if (G.bombs > 0) return 'bomb'; continue; }
    if (G.inv[k]) return k;
  }
  return null;
};

})(window);
