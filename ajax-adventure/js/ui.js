/* ============================================================================
   EMBERQUEST — ui.js
   Status bar, inventory / map screen, message boxes, title and endings.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;
const K = EQ.K, TXT = EQ.text;
const { clamp } = EQ.util;

const UI = EQ.UI = {};

/* -------------------------------------------------------------- primitives */
function panel(ctx, x, y, w, h, fill, edge) {
  ctx.fillStyle = fill || '#0b0a14';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = edge || '#5a6078';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}
UI.panel = panel;

/* A heart at 8x8: state 2 = full, 1 = half, 0 = empty. */
function heart(ctx, x, y, state) {
  const R = '#e33a30', D = '#8d191c', E = '#2a2030';
  const rows = [
    "01100110",
    "11111111",
    "11111111",
    "11111111",
    "01111110",
    "00111100",
    "00011000",
  ];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < 8; c++) {
    if (rows[r][c] !== '1') continue;
    let col = E;
    if (state === 2) col = (r < 2 && c < 4) ? '#ff8a72' : R;
    else if (state === 1) col = c < 4 ? R : E;
    ctx.fillStyle = col;
    ctx.fillRect(x + c, y + r, 1, 1);
  }
  ctx.fillStyle = '#0d0b14';
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < 8; c++) {
    if (rows[r][c] === '1') continue;
    const n = (rows[r - 1] && rows[r - 1][c] === '1') || (rows[r + 1] && rows[r + 1][c] === '1')
           || (rows[r][c - 1] === '1') || (rows[r][c + 1] === '1');
    if (n) ctx.fillRect(x + c, y + r, 1, 1);
  }
}
UI.heart = heart;

/* ------------------------------------------------------------- the minimap */
function overworldMini(ctx, x, y, G) {
  const cw = 4, ch = 3;
  ctx.fillStyle = '#101626'; ctx.fillRect(x, y, 16 * cw, 8 * ch);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 16; c++) {
    if (!G.flags.seen[c + ',' + r]) continue;
    ctx.fillStyle = '#3d5f8f';
    ctx.fillRect(x + c * cw, y + r * ch, cw, ch);
  }
  const W = EQ.World;
  if (W.kind === 'ow') {
    ctx.fillStyle = (Math.floor(Date.now() / 260) % 2) ? '#8ceb72' : '#ffffff';
    ctx.fillRect(x + W.col * cw + 1, y + W.row * ch, 2, 2);
  }
  ctx.strokeStyle = '#5a6078'; ctx.strokeRect(x - 0.5, y - 0.5, 16 * cw + 1, 8 * ch + 1);
}

function dungeonMini(ctx, x, y, G, level, big) {
  const L = EQ.dungeon(level);
  if (!L) return;
  const GW = L.w, GH = L.h;
  const cw = big ? Math.floor(64 / GW) : Math.max(3, Math.floor(32 / GW));
  const ch = big ? Math.floor(64 / GH) : Math.max(2, Math.floor(24 / GH));
  const hasMap = !!G.dmap[level];
  ctx.fillStyle = '#101626'; ctx.fillRect(x, y, GW * cw, GH * ch);
  const W = EQ.World;
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const room = L._rooms[c + ',' + r];
    if (!room) continue;
    const seen = G.flags.roomSeen[level + ':' + c + ',' + r];
    if (!hasMap && !seen) continue;
    ctx.fillStyle = seen ? '#4d7fd0' : '#2a3f68';
    ctx.fillRect(x + c * cw, y + r * ch, cw - 1, ch - 1);
    if (big && room.ch === 'T') { ctx.fillStyle = '#f6c32e'; ctx.fillRect(x + c * cw + 2, y + r * ch + 2, cw - 5, ch - 5); }
  }
  // compass marks where the level prize sits
  if (G.dcompass[level]) {
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      const room = L._rooms[c + ',' + r];
      if (room && (room.ch === 'T' || room.ch === 'P')) {
        ctx.fillStyle = (Math.floor(Date.now() / 300) % 2) ? '#f6c32e' : '#ffee8a';
        ctx.fillRect(x + c * cw + 1, y + r * ch + 1, Math.max(2, cw - 3), Math.max(1, ch - 3));
      }
    }
  }
  if (W.kind === 'dun' && W.level === level) {
    ctx.fillStyle = (Math.floor(Date.now() / 240) % 2) ? '#8ceb72' : '#ffffff';
    ctx.fillRect(x + W.rx * cw + (big ? 3 : 1), y + W.ry * ch + (big ? 3 : 0), 2, 2);
  }
  ctx.strokeStyle = '#5a6078'; ctx.strokeRect(x - 0.5, y - 0.5, GW * cw + 1, GH * ch + 1);
}
UI.dungeonMini = dungeonMini;

/* ----------------------------------------------------------------- the HUD */
UI.drawHUD = function (ctx, G) {
  const W = EQ.World;
  ctx.fillStyle = '#07060e'; ctx.fillRect(0, 0, K.FB_W, K.HUD_H);
  ctx.fillStyle = '#161a2a'; ctx.fillRect(0, K.HUD_H - 3, K.FB_W, 3);
  ctx.fillStyle = '#2b3350'; ctx.fillRect(0, K.HUD_H - 3, K.FB_W, 1);

  /* map box */
  if (W.kind === 'dun') {
    TXT.draw(ctx, 'LEVEL-' + W.level, 8, 6, '#8ed2ff');
    dungeonMini(ctx, 16, 18, G, W.level, false);
  } else {
    overworldMini(ctx, 8, 18, G);
  }

  /* counters */
  const cx = 92;
  ctx.drawImage(EQ.SPR.rupee, cx - 6, 8);
  TXT.draw(ctx, 'x' + String(G.rupees).padStart(3, '0'), cx + 10, 14, '#ffffff');
  ctx.drawImage(EQ.SPR.key, cx - 6, 26);
  TXT.draw(ctx, 'x' + (G.inv.magicKey ? ' A ' : String(G.keys).padStart(3, '0')), cx + 10, 32, '#ffffff');
  ctx.drawImage(EQ.SPR.bomb, cx - 6, 38);
  TXT.draw(ctx, 'x' + String(G.bombs).padStart(3, '0'), cx + 10, 44, '#ffffff');

  /* B and A boxes */
  panel(ctx, 148, 12, 20, 20, '#12101f', '#5a6078');
  panel(ctx, 172, 12, 20, 20, '#12101f', '#5a6078');
  TXT.draw(ctx, 'B', 155, 34, '#8ed2ff'); TXT.draw(ctx, 'A', 179, 34, '#8ed2ff');
  if (G.bItem) {
    const s = G.bItem === 'bomb' ? EQ.SPR.bomb : EQ.SPR[G.bItem];
    if (s) ctx.drawImage(s, 150, 14);
  }
  const st = EQ.P.swordTier();
  if (st) ctx.drawImage(EQ.SPR.swordIcon[st - 1], 178, 14);

  /* hearts */
  TXT.draw(ctx, '-LIFE-', 206, 12, '#e33a30');
  const total = G.maxHearts;
  for (let i = 0; i < total; i++) {
    const hpHalves = EQ.P.hp - i * 2;
    const state = hpHalves >= 2 ? 2 : hpHalves === 1 ? 1 : 0;
    const col = i % 8, row = (i / 8) | 0;
    heart(ctx, 198 + col * 7, 24 + row * 9, state);
  }
};

/* ---------------------------------------------------------- message boxes */
UI.message = null;
UI.say = function (text, opts) {
  UI.message = Object.assign({ text, i: 0, t: 0, done: false, speed: 34 }, opts || {});
};
UI.updateMessage = function (dt) {
  const m = UI.message; if (!m) return;
  if (!m.done) {
    m.t += dt;
    const n = Math.floor(m.t * m.speed);
    if (n > m.i) {
      for (let k = m.i; k < Math.min(n, m.text.length); k++)
        if (m.text[k] !== ' ' && m.text[k] !== '\n' && k % 2 === 0) EQ.audio.sfx('text');
      m.i = n;
    }
    if (m.i >= m.text.length) { m.i = m.text.length; m.done = true; }
  }
  if (EQ.Input.pressed.a || EQ.Input.pressed.b || EQ.Input.pressed.start) {
    if (!m.done) { m.i = m.text.length; m.done = true; }
    else { UI.message = null; if (m.onClose) m.onClose(); }
  }
};
UI.drawMessage = function (ctx) {
  const m = UI.message; if (!m) return;
  const lines = m.text.slice(0, m.i).split('\n');
  const h = 16 + lines.length * 10;
  const y = K.HUD_H + 12;
  panel(ctx, 12, y, K.FB_W - 24, h, 'rgba(8,7,18,0.92)', '#7b8296');
  lines.forEach((l, i) => TXT.draw(ctx, l, 22, y + 9 + i * 10, '#ffffff'));
  if (m.done) {
    const blink = Math.floor(Date.now() / 320) % 2;
    if (blink) TXT.draw(ctx, '>', K.FB_W - 28, y + h - 12, '#ffee8a');
  }
};

/* ------------------------------------------------------- inventory screen */
const GRID = [
  ['boomerang','boomerangMagic'], ['bomb'], ['bow'], ['arrow','arrowSilver'],
  ['candleBlue','candleRed'], ['recorder'], ['bait'], ['potionBlue','potionRed'], ['rod'],
];

UI.invCursor = 0;

UI.drawInventory = function (ctx, G, slideY) {
  const y0 = slideY || 0;
  ctx.save(); ctx.translate(0, y0);
  ctx.fillStyle = '#07060e'; ctx.fillRect(0, 0, K.FB_W, K.HUD_H + K.VIEW_H);

  TXT.draw(ctx, 'INVENTORY', 12, 8, '#8ed2ff');

  /* selectable B items */
  panel(ctx, 10, 20, 116, 62, '#12101f', '#5a6078');
  const owned = UI.ownedB(G);
  owned.forEach((k, i) => {
    const col = i % 5, row = (i / 5) | 0;
    const x = 18 + col * 22, y = 28 + row * 24;
    if (i === UI.invCursor) {
      ctx.fillStyle = 'rgba(246,195,46,0.28)'; ctx.fillRect(x - 3, y - 3, 22, 22);
      ctx.strokeStyle = '#f6c32e'; ctx.strokeRect(x - 2.5, y - 2.5, 21, 21);
    }
    const s = k === 'bomb' ? EQ.SPR.bomb : EQ.SPR[k];
    if (s) ctx.drawImage(s, x, y);
    if (k === 'bomb') TXT.draw(ctx, String(G.bombs), x + 4, y + 17, '#ffffff');
  });
  const sel = owned[UI.invCursor];
  if (sel) {
    const nm = sel === 'bomb' ? 'BOMBS' : (EQ.ITEMS[sel] ? EQ.ITEMS[sel].name : sel);
    TXT.draw(ctx, nm, 12, 86, '#ffee8a');
  }

  /* passives */
  panel(ctx, 132, 20, 114, 62, '#12101f', '#5a6078');
  TXT.draw(ctx, 'CARRIED', 138, 24, '#8ed2ff');
  const pas = ['ladder','raft','bracelet','magicKey','book','ringBlue','ringRed','letter'];
  let n = 0;
  pas.forEach(k => {
    if (!G.inv[k]) return;
    const col = n % 5, row = (n / 5) | 0; n++;
    const s = EQ.SPR[k]; if (s) ctx.drawImage(s, 138 + col * 21, 34 + row * 20);
  });

  /* the level map */
  const lvl = EQ.World.kind === 'dun' ? EQ.World.level : (G.lastLevel || 0);
  panel(ctx, 10, 96, 116, 126, '#12101f', '#5a6078');
  if (lvl) {
    TXT.draw(ctx, 'LEVEL-' + lvl, 16, 100, '#8ed2ff');
    dungeonMini(ctx, 30, 112, G, lvl, true);
  } else {
    TXT.draw(ctx, 'OVERWORLD', 16, 100, '#8ed2ff');
    ctx.save(); ctx.translate(14, 118); ctx.scale(1.6, 1.6);
    overworldMini(ctx, 0, 0, G);
    ctx.restore();
  }

  /* sunshards */
  panel(ctx, 132, 96, 114, 126, '#12101f', '#5a6078');
  TXT.draw(ctx, 'TRIFORCE', 138, 100, '#8ed2ff');
  for (let i = 1; i <= 8; i++) {
    const col = (i - 1) % 4, row = ((i - 1) / 4) | 0;
    const x = 142 + col * 26, y = 112 + row * 26;
    if (G.shards[i]) ctx.drawImage(EQ.SPR.shard, x, y);
    else { ctx.strokeStyle = '#2b3350'; ctx.strokeRect(x + 3.5, y + 5.5, 10, 10); }
    TXT.draw(ctx, String(i), x + 6, y + 20, G.shards[i] ? '#ffee8a' : '#454b5e');
  }
  const got = Object.keys(G.shards).filter(k => G.shards[k]).length;
  TXT.draw(ctx, got + ' OF 8', 138, 168, got === 8 ? '#8ceb72' : '#ffffff');
  TXT.draw(ctx, 'HEART CONTAINERS', 138, 182, '#8ed2ff');
  TXT.draw(ctx, G.maxHearts + ' HEARTS', 138, 194, '#ffffff');
  TXT.draw(ctx, 'START TO CLOSE', 138, 210, '#7b8296');

  ctx.restore();
};

UI.ownedB = function (G) {
  const out = [];
  EQ.B_ITEMS.forEach(k => {
    if (k === 'bomb') { if (G.bombs > 0 || G.everBomb) out.push('bomb'); return; }
    if (G.inv[k]) out.push(k);
  });
  return out;
};

UI.invInput = function (G) {
  const owned = UI.ownedB(G);
  if (!owned.length) return;
  let moved = false;
  if (EQ.Input.pressed.left)  { UI.invCursor--; moved = true; }
  if (EQ.Input.pressed.right) { UI.invCursor++; moved = true; }
  if (EQ.Input.pressed.up)    { UI.invCursor -= 5; moved = true; }
  if (EQ.Input.pressed.down)  { UI.invCursor += 5; moved = true; }
  if (moved) {
    UI.invCursor = clamp(UI.invCursor, 0, owned.length - 1);
    G.bItem = owned[UI.invCursor];
    EQ.audio.sfx('menu');
  }
};

/* --------------------------------------------------------------- the title */
UI.drawTitle = function (ctx, t) {
  const g = ctx.createLinearGradient(0, 0, 0, K.FB_H);
  g.addColorStop(0, '#0a0a1c'); g.addColorStop(0.55, '#131b3a'); g.addColorStop(1, '#07060e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, K.FB_W, K.FB_H);

  // drifting embers
  for (let i = 0; i < 40; i++) {
    const s = (i * 97) % 256, y = ((i * 53 + t * 14) % (K.FB_H + 20)) - 10;
    ctx.fillStyle = i % 3 ? 'rgba(246,195,46,0.5)' : 'rgba(255,143,34,0.4)';
    ctx.fillRect(s, K.FB_H - y, 1, 2);
  }

  // the crest: eight shards orbiting a broken ember core
  const cx = K.FB_W / 2, cy = 60;
  const pulse = 1 + Math.sin(t * 2) * 0.05;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(pulse, pulse);

  // outer glow
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 42);
  glow.addColorStop(0, 'rgba(255,180,60,0.40)');
  glow.addColorStop(1, 'rgba(255,180,60,0)');
  ctx.fillStyle = glow; ctx.fillRect(-46, -46, 92, 92);

  // eight shards, each a slim kite pointing outward
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2 + Math.sin(t * 0.6) * 0.05;
    const r0 = 15, r1 = 33, wsp = 0.16;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.lineTo(Math.cos(a + wsp) * r0, Math.sin(a + wsp) * r0);
    ctx.lineTo(Math.cos(a) * (r0 - 4), Math.sin(a) * (r0 - 4));
    ctx.lineTo(Math.cos(a - wsp) * r0, Math.sin(a - wsp) * r0);
    ctx.closePath();
    ctx.fillStyle = (i % 2) ? '#f6c32e' : '#ffee8a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,10,0.65)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // cracked core
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#ff8f22'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, -2, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffee8a'; ctx.fill();
  ctx.strokeStyle = '#8d4a08'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(-1, -1); ctx.lineTo(-5, 5); ctx.lineTo(1, 10);
  ctx.stroke();
  ctx.restore();

  TXT.centered(ctx, 'THE AJAX ADVENTURE', cx, 108, '#ffee8a', { adv: 8 });
  TXT.centered(ctx, 'FIRST QUEST', cx, 126, '#8ed2ff');
  if (UI.titleHasSave) {
    TXT.centered(ctx, 'CONTINUE',  cx, 152, UI.titleSel === 0 ? '#ffee8a' : '#7b8296');
    TXT.centered(ctx, 'NEW GAME',  cx, 166, UI.titleSel === 1 ? '#ffee8a' : '#7b8296');
    if (Math.floor(t * 4) % 2)
      ctx.drawImage(EQ.SPR.heart, cx - 48, (UI.titleSel === 0 ? 152 : 166) - 1);
  } else if (Math.floor(t * 1.8) % 2) {
    TXT.centered(ctx, 'PRESS ENTER TO BEGIN', cx, 158, '#ffffff');
  }
  TXT.centered(ctx, 'ARROWS MOVE   X SWORD   Z ITEM', cx, 186, '#7b8296');
  TXT.centered(ctx, 'ENTER INVENTORY   M MUTE', cx, 198, '#7b8296');
  TXT.centered(ctx, 'ORIGINAL ARTWORK', cx, 218, '#454b5e');
  TXT.centered(ctx, 'CLASSIC 8-BIT LAYOUT', cx, 228, '#454b5e');
};

UI.drawGameOver = function (ctx, t) {
  ctx.fillStyle = '#07060e'; ctx.fillRect(0, 0, K.FB_W, K.FB_H);
  TXT.centered(ctx, 'YOU HAVE FALLEN', K.FB_W / 2, 96, '#e33a30', { adv: 8 });
  if (t > 1.2) {
    TXT.centered(ctx, 'CONTINUE', K.FB_W / 2, 130, UI.goSel === 0 ? '#ffee8a' : '#7b8296');
    TXT.centered(ctx, 'SAVE AND QUIT', K.FB_W / 2, 144, UI.goSel === 1 ? '#ffee8a' : '#7b8296');
    const y = UI.goSel === 0 ? 130 : 144;
    ctx.drawImage(EQ.SPR.heart, 74, y - 5);
  }
};
UI.goSel = 0;
UI.titleSel = 0;
UI.titleHasSave = false;

UI.drawEnding = function (ctx, t) {
  const g = ctx.createLinearGradient(0, 0, 0, K.FB_H);
  g.addColorStop(0, '#2a1c46'); g.addColorStop(0.6, '#6b3a5c'); g.addColorStop(1, '#e0a05a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, K.FB_W, K.FB_H);
  for (let i = 0; i < 60; i++) {
    const x = (i * 71) % 256, y = (i * 37) % 120;
    ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + (i % 5) * 0.1) + ')';
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.drawImage(EQ.SPR.princess, 104, 128);
  ctx.drawImage(EQ.SPR.kael.down[0], 136, 128);
  TXT.centered(ctx, 'PEACE RETURNS TO THE LAND.', K.FB_W / 2, 62, '#ffffff');
  TXT.centered(ctx, 'THE TRIFORCE IS WHOLE.', K.FB_W / 2, 76, '#ffee8a');
  if (t > 3) TXT.centered(ctx, 'THANK YOU FOR PLAYING', K.FB_W / 2, 176, '#ffffff');
  if (t > 4.5) TXT.centered(ctx, 'ENTER TO RETURN TO TITLE', K.FB_W / 2, 196, '#7b8296');
};

/* -------------------------------------------------------------- cave scene */
UI.drawCaveScene = function (ctx, scene, G) {
  const npcSpr = scene.npc === 'oldwoman' ? EQ.SPR.oldwoman
               : scene.npc === 'merchant' ? EQ.SPR.merchant : EQ.SPR.oldman;
  // torch glow
  ctx.save();
  const g = ctx.createRadialGradient(128, 70, 8, 128, 70, 110);
  g.addColorStop(0, 'rgba(255,180,80,0.30)'); g.addColorStop(1, 'rgba(255,180,80,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, K.VIEW_W, K.VIEW_H);
  ctx.restore();
  if (scene.npc) ctx.drawImage(npcSpr, 120, 56);

  if (scene.offer && scene.offer.length) {
    scene.offer.forEach((o) => {
      if (o.taken) return;
      const x = o.x, y = o.y;
      let s = EQ.SPR[o.spr];
      if (Array.isArray(s)) s = s[0];
      if (!s || !s.width) s = EQ.SPR.rupee;
      ctx.drawImage(s, x, y);
      if (o.price !== undefined) TXT.draw(ctx, String(o.price), x + 3, y + 20, o.afford ? '#ffffff' : '#e33a30');
    });
  }
};

})(window);
