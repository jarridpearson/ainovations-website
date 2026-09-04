/* ============================================================================
   EMBERQUEST — sprites.js
   Every character, item and boss. Sprites are authored as flat colour
   silhouettes; the outline and the light-to-dark shading are applied
   procedurally at bake time, which is what gives them the modernised look.
   All artwork here is original.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;
const { makeCanvas, bake, flipH, flipV, rot90 } = EQ;

/* ---------------------------------------------------------------- pipeline */
function outlineInPlace(c, colour) {
  const x = c.getContext('2d');
  const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
  const W = c.width, H = c.height;
  const a = (px, py) => (px < 0 || py < 0 || px >= W || py >= H) ? 0 : d[(py * W + px) * 4 + 3];
  const out = [];
  for (let y = 0; y < H; y++) for (let px = 0; px < W; px++) {
    if (a(px, y)) continue;
    if (a(px - 1, y) > 200 || a(px + 1, y) > 200 || a(px, y - 1) > 200 || a(px, y + 1) > 200)
      out.push([px, y]);
  }
  const r = parseInt(colour.slice(1, 3), 16), g = parseInt(colour.slice(3, 5), 16), b = parseInt(colour.slice(5, 7), 16);
  out.forEach(p => {
    const i = (p[1] * W + p[0]) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  });
  x.putImageData(img, 0, 0);
  return c;
}

function shadeInPlace(c, strength) {
  const x = c.getContext('2d');
  const s = strength === undefined ? 1 : strength;
  x.globalCompositeOperation = 'source-atop';
  const g = x.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, 'rgba(255,255,255,' + (0.16 * s) + ')');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,' + (0.30 * s) + ')');
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  return c;
}

/* Bake a silhouette: colours -> outline -> shading. */
function spr(rows, opts) {
  opts = opts || {};
  const c = bake(rows, { swap: opts.swap });
  if (opts.outline !== false) outlineInPlace(c, opts.outline || '#0d0b14');
  if (opts.shade !== false) shadeInPlace(c, opts.shade);
  return c;
}

/* Back view for free: strip eye/highlight pixels and fill with the body colour */
function noEyes(rows, body) {
  return rows.map(r => r.replace(/[02]/g, body));
}

const S = EQ.SPR = {};
const put = (name, rows, opts) => { S[name] = spr(rows, opts); return S[name]; };

/* ============================================================ PLAYER: KAEL */
const KAEL_DOWN = [
  "................",
  ".....999999.....",
  "....99aaaa99....",
  "....9aaaaaa9....",
  "...aaa7777aaa...",
  "....l777777l....",
  "....l707707l....",
  "....l777777l....",
  ".....aaaaaa.....",
  "...33aa99aa77...",
  "..3g3a9999a777..",
  "..3g3aaaaaa77...",
  "...33ajjjja.....",
  "....aaaaaaaa....",
  "....nn.mm.nn....",
  "................",
];
const KAEL_DOWN_B = KAEL_DOWN.slice(0, 14).concat(["...nnn..mmm.....", "................"]);

const KAEL_UP = [
  "................",
  ".....999999.....",
  "....99aaaa99....",
  "....9aaaaaa9....",
  "...aaallllaaa...",
  "....llllllll....",
  "....llllllll....",
  "....aaaaaaaa....",
  ".....aaaaaa.....",
  "..77aa3333aa....",
  ".777a3g33g3a....",
  ".77.aa3333aa....",
  "....ajjjjja.....",
  "....aaaaaaaa....",
  "....nn.mm.nn....",
  "................",
];
const KAEL_UP_B = KAEL_UP.slice(0, 14).concat(["...nnn..mmm.....", "................"]);

const KAEL_SIDE = [
  "................",
  "....999999......",
  "...99aaaa99.....",
  "...9aaaaaa9.....",
  "..aaall7777a....",
  "...ll77707......",
  "...ll777777.....",
  "....aaaaaa......",
  "...3aaaaaa77....",
  "..3g3aaaaa777...",
  "..3g3aaaaa77....",
  "...3ajjjja......",
  "....aaaaaa......",
  "....nnn.mm......",
  "................",
  "................",
];
const KAEL_SIDE_B = KAEL_SIDE.slice(0, 13).concat(["....nn.mmm......", "................", "................"]);

S.kael = {
  down:  [spr(KAEL_DOWN), spr(KAEL_DOWN_B)],
  up:    [spr(KAEL_UP),   spr(KAEL_UP_B)],
  right: [spr(KAEL_SIDE), spr(KAEL_SIDE_B)],
};
S.kael.left = S.kael.right.map(flipH);

/* Tunic tiers: blue ring / red ring recolour the whole outfit. */
function kaelTinted(swap) {
  return {
    down:  [spr(KAEL_DOWN, { swap }), spr(KAEL_DOWN_B, { swap })],
    up:    [spr(KAEL_UP,   { swap }), spr(KAEL_UP_B,   { swap })],
    right: [spr(KAEL_SIDE, { swap }), spr(KAEL_SIDE_B, { swap })],
  };
}
const TUNIC_BLUE = { a: 'g', '9': 'f', b: 'h' };
const TUNIC_RED  = { a: 'd', '9': 'c', b: 'e' };
S.kaelBlue = kaelTinted(TUNIC_BLUE); S.kaelBlue.left = S.kaelBlue.right.map(flipH);
S.kaelRed  = kaelTinted(TUNIC_RED);  S.kaelRed.left  = S.kaelRed.right.map(flipH);

/* ------------------------------------------------------------------ swords */
const SWORD_UP = [
  "...22...",
  "..2332..",
  "..2332..",
  "..2332..",
  "..2332..",
  "..2332..",
  "..2332..",
  "..2332..",
  "..2332..",
  ".jjjjjj.",
  "..jmmj..",
  "..mmmm..",
  "...mm...",
  "........",
];
function swordSet(swap) {
  const up = spr(SWORD_UP, { swap });
  return { up, down: flipV(up), right: rot90(up), left: flipH(rot90(up)) };
}
S.sword = [
  swordSet({ '2': 'l', '3': 'm' }),   // 1 - wooden blade
  swordSet(null),                      // 2 - white / steel
  swordSet({ '2': 'i', '3': 'j' }),    // 3 - magical / gold
];

/* --------------------------------------------------------------- item icons */
put('heart', [
  "................", "................",
  "...dddd..dddd...",
  "..dccdddddddd d.".slice(0, 16),
  "..dccdddddddd...",
  "..dddddddddddd..",
  "...dddddddddd...",
  "....dddddddd....",
  ".....dddddd.....",
  "......dddd......",
  ".......dd.......",
]);
put('heartContainer', [
  "................", ".jjjjjjjjjjjjjj.",
  ".j..dddd..dddd j".slice(0, 16),
  ".j.dddddddddd.j.",
  ".j.dddddddddd.j.",
  ".j..dddddddd..j.",
  ".j...dddddd...j.",
  ".j....dddd....j.",
  ".j.....dd.....j.",
  ".jjjjjjjjjjjjjj.",
]);
put('rupee', [
  "................", "................", "................",
  ".......aa.......",
  "......a99a......",
  ".....a9aa9a.....",
  ".....a9aa9a.....",
  ".....a9aa9a.....",
  ".....a9aa9a.....",
  "......a99a......",
  ".......aa.......",
]);
S.rupeeBlue = spr([
  "................", "................", "................",
  ".......gg.......",
  "......gffg......",
  ".....gfggfg.....",
  ".....gfggfg.....",
  ".....gfggfg.....",
  ".....gfggfg.....",
  "......gffg......",
  ".......gg.......",
]);
put('key', [
  "................", "................", "................",
  "......jjjj......",
  ".....jj00jj.....",
  ".....j0..0j.....",
  ".....jj00jj.....",
  "......jjjj......",
  ".......jj.......",
  ".......jj.......",
  ".......jjj......",
  ".......jj.......",
  ".......jjj......",
]);
S.magicKey = spr([
  "................", "................", "................",
  "......3333......",
  ".....3300335....".slice(0, 16),
  ".....30..03.....",
  ".....3300335....".slice(0, 16),
  "......3333......",
  ".......33.......",
  ".......33.......",
  ".......333......",
  ".......33.......",
  ".......333......",
]);
put('bomb', [
  "................", "................",
  ".........j......",
  "........j.......",
  ".......jj.......",
  "......5115......",
  ".....1111111....",
  "....111111111...",
  "....114111111...",
  "....111111111...",
  "....111111111...",
  ".....1111111....",
  "......11111.....",
]);
put('map', [
  "................", "................", "................", "................",
  "...uuuuuuuuuu...",
  "...uuuuuuuuuu...",
  "...umuuuuumuu...",
  "...uumuuumuuu...",
  "...uuummmuuuu...",
  "...uuuumuuuuu...",
  "...uuuuuuuuuu...",
  "...uuuuuuuuuu...",
]);
put('compass', [
  "................", "................", "................", "................",
  "......jjjj......",
  "....jjj00jjj....",
  "...jj000d00jj...",
  "...j0000d000j...",
  "...j000dd000j...",
  "...jj00d000jj...",
  "....jjj00jjj....",
  "......jjjj......",
]);
put('shard', [
  "................", "................", "................",
  ".......jj.......",
  "......jiij......",
  ".....jiiiij.....",
  "....jiiiiiij....",
  "...jiiiiiiiij...",
  "..jiiiiiiiiiij..",
  ".jjjjjjjjjjjjjj.",
]);
put('fairy', [
  "................", "................", "................", "................",
  "..222..tt..222..",
  "...22.tttt.22...",
  "....2.tttt.2....",
  "......tttt......",
  ".......tt.......",
  "......t..t......",
]);
put('clock', [
  "................", "................", "................", "................",
  "....vvvvvvvv....",
  "...v22222222v...",
  "...v22022022v...",
  "...v22002222v...",
  "...v22222222v...",
  "....vvvvvvvv....",
]);
put('bait', [
  "................", "................", "................", "................", "................",
  "......mmmm......",
  ".....mllllm.....",
  "....mllllllm....",
  "....mllllllm....",
  ".....mllllm.....",
  "....33mmmm33....",
]);
put('letter', [
  "................", "................", "................", "................", "................",
  "...2222222222...",
  "...2dd2222dd2...",
  "...22dd22dd22...",
  "...2222dd2222...",
  "...2222222222...",
  "...2222222222...",
]);
const POTION_ROWS = [
  "................", "................", "................",
  ".......mm.......",
  ".......mm.......",
  "....33333333....",
  "....3dddddd3....",
  "....3dddddd3....",
  "....3dddddd3....",
  "....3dddddd3....",
  "....3dddddd3....",
  "....33333333....",
];
put('potionRed', POTION_ROWS);
S.potionBlue = spr(POTION_ROWS, { swap: { d: 'g' } });
put('boomerang', [
  "................", "................", "................", "................",
  "...mm...........",
  "...mlm..........",
  "...mllm.........",
  "...mmllm........",
  "....mmllm.......",
  ".....mmllmm.....",
  "......mmllmm....",
  ".......mmmmm....",
]);
S.boomerangMagic = spr([
  "................", "................", "................", "................",
  "...jj...........",
  "...jij..........",
  "...jiij.........",
  "...jjiij........",
  "....jjiij.......",
  ".....jjiijj.....",
  "......jjiijj....",
  ".......jjjjj....",
]);
put('bow', [
  "................", "................",
  ".......mm.......",
  "......mm.3......",
  ".....mm..3......",
  ".....m...3......",
  ".....m...3......",
  ".....m...3......",
  ".....m...3......",
  ".....mm..3......",
  "......mm.3......",
  ".......mm.......",
]);
put('arrowItem', [
  "................", "................", "................",
  "..........333...",
  ".........3m33...",
  "........3mm3....",
  ".......3mm3.....",
  "......3mm3......",
  ".....3mm3.......",
  "....2mm3........",
  "...22m3.........",
  "..222...........",
]);
S.arrowSilver = spr([
  "................", "................", "................",
  "..........333...",
  ".........3233...",
  "........3223....",
  ".......3223.....",
  "......3223......",
  ".....3223.......",
  "....2223........",
  "...22233........",
  "..2222..........",
]);
put('candle', [
  "................", "................",
  ".......r........",
  "......rir.......",
  "......rir.......",
  ".......r........",
  "......2222......",
  "......2dd2......",
  "......2dd2......",
  "......2dd2......",
  "......2dd2......",
  ".....jjjjjj.....",
]);
S.candleBlue = spr([
  "................", "................",
  ".......f........",
  "......fsf.......",
  "......fsf.......",
  ".......f........",
  "......2222......",
  "......2gg2......",
  "......2gg2......",
  "......2gg2......",
  "......2gg2......",
  ".....jjjjjj.....",
]);
put('recorder', [
  "................", "................", "................", "................", "................", "................",
  "...jjjjjjjjjj...",
  "...jj0j0j0jjj...",
  "...jjjjjjjjjj...",
]);
put('rod', [
  "................", "................", "................",
  "..........ff....",
  ".........f22f...",
  ".........f22f...",
  "..........ff....",
  "........mm......",
  ".......mm.......",
  "......mm........",
  ".....mm.........",
  "....mm..........",
]);
put('book', [
  "................", "................", "................", "................",
  "...ppppppppp....",
  "...p2222222p....",
  "...p2jjjjj2p....",
  "...p2j222j2p....",
  "...p2jjjjj2p....",
  "...p2222222p....",
  "...ppppppppp....",
]);
const RING_ROWS = [
  "................", "................", "................", "................",
  "......jjjj......",
  ".....j0dd0j.....",
  "....j0dddd0j....",
  "....j0dddd0j....",
  ".....j0dd0j.....",
  "......jjjj......",
];
put('ringBlue', RING_ROWS.map(r => r.replace(/d/g, 'g')));
put('ringRed', RING_ROWS);
put('ladder', [
  "................", "................", "................",
  "....m......m....",
  "....mmmmmmmm....",
  "....m......m....",
  "....mmmmmmmm....",
  "....m......m....",
  "....mmmmmmmm....",
  "....m......m....",
  "....mmmmmmmm....",
  "....m......m....",
  "....m......m....",
]);
put('raft', [
  "................", "................", "................", "................", "................", "................",
  "..mmmmmmmmmmmm..",
  "..mlmlmlmlmlmm..",
  "..mmmmmmmmmmmm..",
]);
put('bracelet', [
  "................", "................", "................", "................", "................",
  "....jjjjjjjj....",
  "....j000000j....",
  "....j0iiii0j....",
  "....j0iiii0j....",
  "....j000000j....",
  "....jjjjjjjj....",
]);
const SHIELD_ROWS = [
  "................", "................", "................",
  "...3333333333...",
  "...3gggggggg3...",
  "...3g222222g3...",
  "...3g2gggg2g3...",
  "...3g2gggg2g3...",
  "...3g222222g3...",
  "....3gggggg3....",
  ".....3gggg3.....",
  "......3gg3......",
  ".......33.......",
];
put('shieldWood', SHIELD_ROWS.map(r => r.replace(/g/g, 'm').replace(/3/g, 'l')));
put('shieldMagic', SHIELD_ROWS);
S.swordIcon = [S.sword[0].up, S.sword[1].up, S.sword[2].up];
S.swordIcon0 = S.sword[0].up; S.swordIcon1 = S.sword[1].up; S.swordIcon2 = S.sword[2].up;

/* ================================================================= ENEMIES */
const E = {};
function enemy(name, rows, opts) {
  const down = spr(rows, opts);
  const up = spr(noEyes(rows, opts && opts.body || detectBody(rows)), opts);
  E[name] = { down, up, left: flipH(down), right: down, dead: false };
  return E[name];
}
function detectBody(rows) {
  const count = {};
  rows.forEach(r => { for (const ch of r) if (ch !== '.' && ch !== '0' && ch !== '2') count[ch] = (count[ch] || 0) + 1; });
  let best = 'd', n = 0;
  for (const k in count) if (count[k] > n) { n = count[k]; best = k; }
  return best;
}

const OCTOROK = [
  "................", "................",
  "....dddddddd....",
  "..dddddddddddd..",
  "..dd2dddddd2dd..",
  "..dd0dddddd0dd..",
  "..dddddddddddd..",
  "...dd000000dd...",
  "..dddddddddddd..",
  ".dd.dddddddd.dd.",
  ".d..dddddddd..d.",
  "....dd....dd....",
  "...dd......dd...",
];
const OCTOROK_B = OCTOROK.slice(0, 11).concat(["...dd......dd...", "....dd....dd...."]);
E.octorok  = { down: spr(OCTOROK), up: spr(noEyes(OCTOROK, 'd')) };
E.octorok.left = flipH(E.octorok.down); E.octorok.right = E.octorok.down;
E.octorokB = { down: spr(OCTOROK_B), up: spr(noEyes(OCTOROK_B, 'd')) };
E.octorokB.left = flipH(E.octorokB.down); E.octorokB.right = E.octorokB.down;

const MOBLIN = [
  "................",
  "....dd....dd....",
  "...dddddddddd...",
  "..dddddddddddd..",
  "..dd0dddd0dddd..",
  "..dddddddddddd..",
  "...dd222222dd...",
  "...dddddddddd...",
  "..dddddddddddd..",
  "..dddddddddddd..",
  "...dd......dd...",
  "...dd......dd...",
  "..ddd......ddd..",
];
const MOBLIN_B = MOBLIN.slice(0, 10).concat(["..dd........dd..", "..dd........dd..", ".ddd........ddd."]);
enemy('moblin', MOBLIN); E.moblinB = { down: spr(MOBLIN_B), up: spr(noEyes(MOBLIN_B, 'd')) };
E.moblinB.left = flipH(E.moblinB.down); E.moblinB.right = E.moblinB.down;

const TEKTITE = [
  "................", "................", "................",
  ".dd..........dd.",
  "..dd........dd..",
  "...dddddddddd...",
  "..dddddddddddd..",
  "..dd0dddddd0dd..",
  "..dddddddddddd..",
  "...dddddddddd...",
  "..dd........dd..",
  ".dd..........dd.",
];
const TEKTITE_B = [
  "................", "................",
  "..d..........d..",
  ".dd..........dd.",
  "...dd......dd...",
  "...dddddddddd...",
  "..dddddddddddd..",
  "..dd0dddddd0dd..",
  "..dddddddddddd..",
  "...dddddddddd...",
  "...dd......dd...",
  ".dd..........dd.",
];
E.tektite  = { down: spr(TEKTITE) };  E.tektite.up = E.tektite.left = E.tektite.right = E.tektite.down;
E.tektiteB = { down: spr(TEKTITE_B) }; E.tektiteB.up = E.tektiteB.left = E.tektiteB.right = E.tektiteB.down;

const LEEVER = [
  "................", "................", "................", "................", "................",
  "......dddd......",
  "....dddddddd....",
  "..dddd2222dddd..",
  "..dddddddddddd..",
  "....dddddddd....",
  "......dddd......",
];
const LEEVER_B = [
  "................", "................", "................", "................", "................", "................",
  ".......dd.......",
  ".....dd22dd.....",
  ".....dddddd.....",
  ".......dd.......",
];
E.leever  = { down: spr(LEEVER) };   E.leever.up = E.leever.left = E.leever.right = E.leever.down;
E.leeverB = { down: spr(LEEVER_B) }; E.leeverB.up = E.leeverB.left = E.leeverB.right = E.leeverB.down;

const PEAHAT = [
  "................", "................", "................", "................", "................",
  "...aa.aaaa.aa...",
  "..aaaaddddaaaa..",
  "..aaadd00ddaaa..",
  "..aaaaddddaaaa..",
  "...aa.aaaa.aa...",
];
const PEAHAT_B = [
  "................", "................", "................", "................",
  "....aaa..aaa....",
  "...aaaaaaaaaa...",
  "..aaaaddddaaaa..",
  "..aaadd00ddaaa..",
  "..aaaaddddaaaa..",
  "...aaaaaaaaaa...",
  "....aaa..aaa....",
];
E.peahat  = { down: spr(PEAHAT) };   E.peahat.up = E.peahat.left = E.peahat.right = E.peahat.down;
E.peahatB = { down: spr(PEAHAT_B) }; E.peahatB.up = E.peahatB.left = E.peahatB.right = E.peahatB.down;

const ZOLA = [
  "................", "................", "................", "................", "................",
  "......gggg......",
  ".....gg00gg.....",
  "....gggggggg....",
  "....gggggggg....",
  "...gg.gggg.gg...",
  "..zzzzzzzzzzzz..",
];
E.zola = { down: spr(ZOLA) }; E.zola.up = E.zola.left = E.zola.right = E.zola.down;

const LYNEL = [
  "................",
  "...aaaa.........",
  "..aaaaaa........",
  "..aa00aa........",
  "..aaaaaa...3....",
  "..aaaaaaaaa3....",
  ".aaaaaaaaaaa3...",
  ".aaaaaaaaaaaa...",
  ".aaaaaaaaaaaa...",
  ".aa.aa..aa.aa...",
  ".aa.aa..aa.aa...",
  ".aa.aa..aa.aa...",
];
E.lynel = { right: spr(LYNEL) };
E.lynel.left = flipH(E.lynel.right); E.lynel.down = E.lynel.right; E.lynel.up = E.lynel.right;

const ARMOS = [
  "................",
  "....vvvvvvvv....",
  "...vvvvvvvvvv...",
  "...vv0vvvv0vv...",
  "...vvvvvvvvvv...",
  "...vv000000vv...",
  "..vvvvvvvvvvvv..",
  "..vvvvvvvvvvvv..",
  "..vvvvvvvvvvvv..",
  "..vvvvvvvvvvvv..",
  "...vvv....vvv...",
  "...vvv....vvv...",
  "..vvvv....vvvv..",
];
enemy('armos', ARMOS);

const GHINI = [
  "................", "................",
  "....33333333....",
  "...3333333333...",
  "...3300330033...",
  "...3333333333...",
  "..333333333333..",
  "..333333333333..",
  "..333333333333..",
  "..3.33.33.33.3..",
  "...3..3..3..3...",
];
E.ghini = { down: spr(GHINI, { shade: 0.5 }) };
E.ghini.up = E.ghini.left = E.ghini.right = E.ghini.down;

const BOULDER = [
  "................", "................", "................", "................",
  "....vvvvvvvv....",
  "...vvvvvvvvvv...",
  "..vvvvvvvvvvvv..",
  "..vvvvvvvvvvvv..",
  "..vvvvvvvvvvvv..",
  "...vvvvvvvvvv...",
  "....vvvvvvvv....",
];
E.boulder = { down: spr(BOULDER) };
E.boulder.up = E.boulder.left = E.boulder.right = E.boulder.down;

const KEESE = [
  "................", "................", "................", "................",
  "..pp........pp..",
  "..ppp......ppp..",
  "...pppp..pppp...",
  "....pppppppp....",
  ".....pp00pp.....",
  "......pppp......",
];
const KEESE_B = [
  "................", "................",
  "..pp........pp..",
  "...ppp....ppp...",
  "....pppppppp....",
  ".....pp00pp.....",
  "......pppp......",
];
E.keese  = { down: spr(KEESE) };   E.keese.up = E.keese.left = E.keese.right = E.keese.down;
E.keeseB = { down: spr(KEESE_B) }; E.keeseB.up = E.keeseB.left = E.keeseB.right = E.keeseB.down;

const STALFOS = [
  "................", "................",
  "....22222222....",
  "...2222222222...",
  "...2200220022...",
  "...2222222222...",
  "....22022022....",
  "....22222222....",
  "..2.22222222.2..",
  "..2.22222222.2..",
  "....22222222....",
  "....22..22......",
  "....22..22......",
];
enemy('stalfos', STALFOS);

const GEL = [
  "................", "................", "................", "................", "................", "................",
  "......ssss......",
  ".....ssssss.....",
  ".....ssssss.....",
  "......ssss......",
];
E.gel = { down: spr(GEL) }; E.gel.up = E.gel.left = E.gel.right = E.gel.down;

const ZOL = [
  "................", "................", "................", "................",
  ".....ssssss.....",
  "...ssssssssss...",
  "..ssssssssssss..",
  "..ss0ssssss0ss..",
  "..ssssssssssss..",
  "...ssssssssss...",
  ".....ssssss.....",
];
enemy('zol', ZOL);

const ROPE = [
  "................", "................", "................", "................", "................",
  "..dddddd........",
  "..dd0ddd........",
  "..dddddddd......",
  "....dddddddd....",
  "......dddddddd..",
  "........dddddd..",
];
E.rope = { right: spr(ROPE) };
E.rope.left = flipH(E.rope.right); E.rope.down = E.rope.right; E.rope.up = E.rope.right;

const GORIYA = [
  "................", "................",
  "...dd....dd.....",
  "..dddddddddd....",
  "..dd0dddd0dd....",
  "..dddddddddd....",
  "...dd2222dd.....",
  "...dddddddd.....",
  "..dddddddddd....",
  "..dddddddddd....",
  "...dd....dd.....",
  "..ddd....ddd....",
];
enemy('goriya', GORIYA);

const WALLMASTER = [
  "................", "................", "................", "................",
  "...m..m..m..m...",
  "...m..m..m..m...",
  "...mmmmmmmmmm...",
  "...mmmmmmmmmm...",
  "...mmmmmmmmmm...",
  "....mmmmmmmm....",
  ".....mmmmmm.....",
];
E.wallmaster = { down: spr(WALLMASTER) };
E.wallmaster.up = E.wallmaster.left = E.wallmaster.right = E.wallmaster.down;

const DARKNUT = [
  "................",
  "....vvvvvvvv....",
  "...vvvvvvvvvv...",
  "...vv0vvvv0vv...",
  "...vvvvvvvvvv...",
  "..vvvvvvvvvvvv..",
  "..vv4vvvvvv4vv..",
  "..vvvvvvvvvvvv..",
  "..vvvvvvvvvvvv..",
  "...vvvvvvvvvv...",
  "...vvv....vvv...",
  "...vvv....vvv...",
  "..vvvv....vvvv..",
];
enemy('darknut', DARKNUT);

const WIZZROBE = [
  "................",
  "......pppp......",
  ".....pppppp.....",
  "....pppppppp....",
  "....pp0pp0pp....",
  "....pppppppp....",
  "...pppppppppp...",
  "..pppppppppppp..",
  "..pppppppppppp..",
  "..pppppppppppp..",
  "..pppppppppppp..",
  "...pppppppppp...",
  "..p.p.p.p.p.p...",
];
enemy('wizzrobe', WIZZROBE);

const LIKELIKE = [
  "................", "................", "................",
  "....dddddddd....",
  "...dddddddddd...",
  "...dd0dddd0dd...",
  "...dddddddddd...",
  "...dddddddddd...",
  "...dddddddddd...",
  "...dddddddddd...",
  "...dd0dddd0dd...",
  "...dddddddddd...",
  "....dddddddd....",
];
enemy('likelike', LIKELIKE);

const VIRE = [
  "................", "................",
  ".pp..........pp.",
  ".ppp........ppp.",
  "..pppppppppppp..",
  "...pp0pppp0pp...",
  "...pppppppppp...",
  "....pppppppp....",
  "....pp0000pp....",
  "....pppppppp....",
  ".....pppppp.....",
  "......pppp......",
];
enemy('vire', VIRE);

const BUBBLE = [
  "................", "................", "................", "................",
  "......3333......",
  ".....332233.....",
  "....33222233....",
  "....33222233....",
  ".....332233.....",
  "......3333......",
];
E.bubble = { down: spr(BUBBLE, { shade: 0.4 }) };
E.bubble.up = E.bubble.left = E.bubble.right = E.bubble.down;

const GIBDO = [
  "................", "................",
  "....uuuuuuuu....",
  "...uuuuuuuuuu...",
  "...uu0uuuu0uu...",
  "...uuuuuuuuuu...",
  "..uuuuuuuuuuuu..",
  "..uu.uuuuuu.uu..",
  "..uuuuuuuuuuuu..",
  "..uu.uuuuuu.uu..",
  "..uuuuuuuuuuuu..",
  "...uuu....uuu...",
  "...uuu....uuu...",
];
enemy('gibdo', GIBDO);

const POLSVOICE = [
  "....mm....mm....",
  "....mm....mm....",
  "....mm....mm....",
  "....mmmmmmmm....",
  "...mmmmmmmmmm...",
  "..mm0mmmmmm0mm..",
  "..mmmmmmmmmmmm..",
  "..mmmmmmmmmmmm..",
  "..mmmmmmmmmmmm..",
  "...mmmmmmmmmm...",
  "....mmmmmmmm....",
];
enemy('polsvoice', POLSVOICE);

const WORM = [
  "................", "................", "................", "................",
  "....aaaaaaaa....",
  "...aaaaaaaaaa...",
  "..aaaaaaaaaaaa..",
  "..aaaaaaaaaaaa..",
  "..aaaaaaaaaaaa..",
  "...aaaaaaaaaa...",
  "....aaaaaaaa....",
];
const WORM_HEAD = [
  "................", "................", "................", "................",
  "....aaaaaaaa....",
  "...aaaaaaaaaa...",
  "..aa0aaaaaa0aa..",
  "..aaaaaaaaaaaa..",
  "..aaa000000aaa..",
  "...aaaaaaaaaa...",
  "....aaaaaaaa....",
];
E.moldorm     = { down: spr(WORM_HEAD) };
E.moldormSeg  = { down: spr(WORM) };
E.lanmola     = { down: spr(WORM_HEAD, { swap: { a: 'd', '9': 'c' } }) };
E.lanmolaSeg  = { down: spr(WORM,      { swap: { a: 'd', '9': 'c' } }) };
['moldorm', 'moldormSeg', 'lanmola', 'lanmolaSeg'].forEach(k => {
  E[k].up = E[k].left = E[k].right = E[k].down;
});

const PATRA = [
  "................", "................", "................",
  "....oooooooo....",
  "...oooooooooo...",
  "..oooo2222oooo..",
  "..ooo222222ooo..",
  "..ooo220022ooo..",
  "..ooo222222ooo..",
  "..oooo2222oooo..",
  "...oooooooooo...",
  "....oooooooo....",
];
const PATRA_MINI = [
  "................", "................", "................", "................", "................", "................",
  "......oooo......",
  ".....oo22oo.....",
  ".....oo22oo.....",
  "......oooo......",
];
E.patra = { down: spr(PATRA) };     E.patra.up = E.patra.left = E.patra.right = E.patra.down;
E.patraMini = { down: spr(PATRA_MINI) }; E.patraMini.up = E.patraMini.left = E.patraMini.right = E.patraMini.down;

const TRAP = [
  "................", "................",
  "..vvvvvvvvvvvv..",
  "..v4444444444v..",
  "..v4vvvvvvvv4v..",
  "..v4v444444v4v..",
  "..v4v4vvvv4v4v..",
  "..v4v4vvvv4v4v..",
  "..v4v444444v4v..",
  "..v4vvvvvvvv4v..",
  "..v4444444444v..",
  "..vvvvvvvvvvvv..",
];
E.trap = { down: spr(TRAP) }; E.trap.up = E.trap.left = E.trap.right = E.trap.down;

/* Palette-swapped hard variants (the "blue" tier enemies). */
function variant(base, swapName, rowsMap) { return null; }
E.octorokBlue  = { down: spr(OCTOROK,  { swap: 'blue' }), up: spr(noEyes(OCTOROK, 'd'), { swap: 'blue' }) };
E.octorokBlueB = { down: spr(OCTOROK_B,{ swap: 'blue' }), up: spr(noEyes(OCTOROK_B,'d'),{ swap: 'blue' }) };
E.moblinBlue   = { down: spr(MOBLIN,   { swap: 'blue' }), up: spr(noEyes(MOBLIN,  'd'), { swap: 'blue' }) };
E.moblinBlueB  = { down: spr(MOBLIN_B, { swap: 'blue' }), up: spr(noEyes(MOBLIN_B,'d'), { swap: 'blue' }) };
E.tektiteBlue  = { down: spr(TEKTITE,  { swap: 'blue' }) };
E.tektiteBlueB = { down: spr(TEKTITE_B,{ swap: 'blue' }) };
E.leeverBlue   = { down: spr(LEEVER,   { swap: 'blue' }) };
E.leeverBlueB  = { down: spr(LEEVER_B, { swap: 'blue' }) };
E.lynelBlue    = { right: spr(LYNEL,   { swap: { a:'g', '9':'f' } }) };
E.goriyaBlue   = { down: spr(GORIYA,   { swap: 'blue' }), up: spr(noEyes(GORIYA, 'd'), { swap: 'blue' }) };
E.darknutBlue  = { down: spr(DARKNUT,  { swap: { v:'g', '4':'f' } }), up: spr(noEyes(DARKNUT,'v'), { swap: { v:'g', '4':'f' } }) };
E.wizzrobeBlue = { down: spr(WIZZROBE, { swap: { p:'g', o:'f' } }), up: spr(noEyes(WIZZROBE,'p'), { swap: { p:'g', o:'f' } }) };
E.zolBlue      = { down: spr(ZOL,      { swap: { s:'g' } }), up: spr(noEyes(ZOL,'s'), { swap: { s:'g' } }) };
E.gelBlue      = { down: spr(GEL,      { swap: { s:'g' } }) };
E.keeseRed     = { down: spr(KEESE,    { swap: { p:'d', o:'c' } }) };
E.keeseRedB    = { down: spr(KEESE_B,  { swap: { p:'d', o:'c' } }) };
E.keeseBlue    = { down: spr(KEESE,    { swap: { p:'g', o:'f' } }) };
E.keeseBlueB   = { down: spr(KEESE_B,  { swap: { p:'g', o:'f' } }) };
E.ropeBlue     = { right: spr(ROPE,    { swap: 'blue' }) };
E.stalfosBlue  = { down: spr(STALFOS,  { swap: { '2':'f' } }) };

/* fill in missing facings so draw code can index freely */
Object.keys(E).forEach(k => {
  const s = E[k]; if (!s || typeof s !== 'object') return;
  const any = s.down || s.right || s.up || s.left;
  if (!any) return;
  s.down = s.down || any; s.up = s.up || s.down;
  s.right = s.right || s.down; s.left = s.left || flipH(s.right);
});
EQ.ENEMY_SPR = E;

/* -------------------------------------------------------------- NPC sprites */
put('oldman', [
  "................",
  "....wwwwwwww....",
  "...wwwwwwwwww...",
  "...ww777777ww...",
  "...ww707707ww...",
  "...ww777777ww...",
  "....22222222....",
  "....22222222....",
  "...wwwwwwwwww...",
  "..wwwwwwwwwwww..",
  "..wwwwwwwwwwww..",
  "..wwwwwwwwwwww..",
  "...wwwwwwwwww...",
]);
S.oldwoman = spr([
  "................",
  "....pppppppp....",
  "...pppppppppp...",
  "...pp777777pp...",
  "...pp707707pp...",
  "...pp777777pp...",
  "....33333333....",
  "...pppppppppp...",
  "..pppppppppppp..",
  "..pppppppppppp..",
  "..pppppppppppp..",
  "..pppppppppppp..",
  "...pppppppppp...",
]);
S.merchant = spr([
  "................",
  "....jjjjjjjj....",
  "...jjjjjjjjjj...",
  "...jj777777jj...",
  "...jj707707jj...",
  "...jj777777jj...",
  "....mmmmmmmm....",
  "...dddddddddd...",
  "..dddddddddddd..",
  "..dddddddddddd..",
  "..dddddddddddd..",
  "..dddddddddddd..",
  "...dddddddddd...",
]);
put('princess', [
  "................",
  "....jjjjjjjj....",
  "...jjjjjjjjjj...",
  "...jj777777jj...",
  "...jj707707jj...",
  "...jj777777jj...",
  "....jj7777jj....",
  "....tttttttt....",
  "...tttttttttt...",
  "..tttttttttttt..",
  "..tttttttttttt..",
  ".tttttttttttttt.",
  ".tttttttttttttt.",
]);

/* ---------------------------------------------------------- projectiles etc */
put('flame', [
  "................", "................", "................", "................", "................",
  ".......rr.......",
  "......riir......",
  ".....riiiir.....",
  ".....riiiir.....",
  "......rrrr......",
]);
put('rock', [
  "................", "................", "................", "................", "................", "................",
  "......vvvv......",
  ".....vvvvvv.....",
  ".....vvvvvv.....",
  "......vvvv......",
]);
put('beam', [
  "................", "................", "................", "................",
  ".......ff.......",
  "......f22f......",
  ".....f2ff2f.....",
  "....f22ff22f....",
  "....f22ff22f....",
  ".....f2ff2f.....",
  "......f22f......",
  ".......ff.......",
]);
S.magicShot = spr([
  "................", "................", "................", "................",
  ".......oo.......",
  "......o22o......",
  ".....o2oo2o.....",
  "....o22oo22o....",
  "....o22oo22o....",
  ".....o2oo2o.....",
  "......o22o......",
  ".......oo.......",
]);
const ARROW_UP = [
  "................", "................",
  ".......33.......",
  "......3223......",
  "......3223......",
  ".......mm.......",
  ".......mm.......",
  ".......mm.......",
  ".......mm.......",
  ".......mm.......",
  "......immi......",
  ".....i.mm.i.....",
];
S.arrow = (() => { const up = spr(ARROW_UP); return { up, down: flipV(up), right: rot90(up), left: flipH(rot90(up)) }; })();
S.arrowSilverDir = (() => {
  const up = spr(ARROW_UP, { swap: { m: '3', i: '2' } });
  return { up, down: flipV(up), right: rot90(up), left: flipH(rot90(up)) };
})();

/* ================================================================== BOSSES
   Large sprites are painted with canvas primitives — cheaper than authoring
   thousand-pixel grids and it suits the modernised look.                     */
function bossCanvas(w, h, draw) {
  const c = makeCanvas(w, h), x = c.getContext('2d');
  draw(x, w, h);
  outlineInPlace(c, '#0d0b14');
  shadeInPlace(c, 0.8);
  return c;
}
function body(x, cx, cy, rx, ry, col) {
  x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); x.fill();
}
function eye(x, cx, cy, r, iris) {
  x.fillStyle = '#ffffff'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  x.fillStyle = iris || '#0d0b14'; x.beginPath(); x.arc(cx, cy, Math.max(1, r * 0.5), 0, Math.PI * 2); x.fill();
}

const B = EQ.BOSS_SPR = {};

/* Sarquin — horned serpent, guards Level 1 (and 4). Mouth-open frame fires. */
B.sarquin = [0, 1].map(f => bossCanvas(32, 32, (x) => {
  body(x, 17, 20, 13, 11, '#43ad4a');                    // trunk
  body(x, 13, 12, 9, 8, '#57c25c');                      // head
  x.fillStyle = '#1e6b33';                               // horn
  x.beginPath(); x.moveTo(9, 6); x.lineTo(6, 0); x.lineTo(13, 5); x.closePath(); x.fill();
  x.fillStyle = '#8ceb72';                               // belly
  body(x, 19, 25, 9, 5, '#8ceb72');
  x.fillStyle = '#1e6b33';                               // legs
  x.fillRect(11, 28, 4, 4); x.fillRect(21, 28, 4, 4);
  eye(x, 11, 10, 2.4, '#e33a30');
  x.fillStyle = '#0d0b14';                               // mouth
  if (f) { x.fillRect(4, 13, 8, 5); x.fillStyle = '#ff8f22'; x.fillRect(4, 14, 5, 3); }
  else x.fillRect(5, 14, 7, 2);
}));

/* Grovak — armoured lizard, weak only to a bomb swallowed whole. */
B.grovak = [0, 1].map(f => bossCanvas(32, 24, (x) => {
  body(x, 17, 13, 14, 9, '#8b5b2f');
  body(x, 7, 12, 7, 6, '#a56b38');
  x.fillStyle = '#4e3018';
  for (let i = 0; i < 5; i++) x.fillRect(8 + i * 5, 4, 4, 3);   // back plates
  x.fillStyle = '#4e3018'; x.fillRect(10, 20, 4, 4); x.fillRect(22, 20, 4, 4);
  eye(x, 5, 10, 2, '#f6c32e');
  x.fillStyle = f ? '#ff8f22' : '#0d0b14';
  x.fillRect(0, 13, 7, f ? 5 : 2);
}));

/* Vellthorn — four snapping heads on a central stalk. */
B.vellthornCore = bossCanvas(16, 16, (x) => {
  body(x, 8, 8, 7, 7, '#7d41c4'); body(x, 8, 8, 4, 4, '#d29bff');
});
B.vellthornHead = [0, 1].map(f => bossCanvas(16, 16, (x) => {
  body(x, 8, 8, 7, 7, '#43ad4a');
  x.fillStyle = '#0d0b14';
  if (f) { x.beginPath(); x.moveTo(8, 8); x.lineTo(16, 2); x.lineTo(16, 14); x.closePath(); x.fill(); }
  else x.fillRect(9, 7, 7, 2);
  eye(x, 6, 6, 2, '#e33a30');
}));

/* Skalgar — multi-headed drake; heads live on flailing necks. */
B.skalgarBody = bossCanvas(32, 32, (x) => {
  body(x, 16, 20, 14, 11, '#4a6f78');
  body(x, 16, 20, 9, 7, '#6f9ea8');
  x.fillStyle = '#28454c';
  x.fillRect(8, 29, 5, 3); x.fillRect(19, 29, 5, 3);
});
B.skalgarHead = [0, 1].map(f => bossCanvas(16, 16, (x) => {
  body(x, 8, 8, 7, 6, '#6f9ea8');
  x.fillStyle = '#28454c';
  x.beginPath(); x.moveTo(6, 3); x.lineTo(4, -1); x.lineTo(9, 2); x.closePath(); x.fill();
  eye(x, 6, 7, 2, '#f6c32e');
  x.fillStyle = f ? '#ff8f22' : '#0d0b14'; x.fillRect(9, 9, 6, f ? 4 : 2);
}));

/* Umbroth — a rolling drum that splits into children when the recorder sounds */
B.umbroth = [0, 1].map(f => bossCanvas(48, 48, (x) => {
  body(x, 24, 24, 23, 23, '#a03d3d');
  body(x, 24, 24, 16, 16, '#d16a63');
  body(x, 24, 24, 8, 8, '#3a2020');
  x.fillStyle = '#661f22';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + (f ? 0.4 : 0);
    x.fillRect(24 + Math.cos(a) * 19 - 2, 24 + Math.sin(a) * 19 - 2, 4, 4);
  }
}));
B.umbrothChild = bossCanvas(16, 16, (x) => {
  body(x, 8, 8, 7, 7, '#a03d3d'); body(x, 8, 8, 3, 3, '#3a2020');
});

/* Chelvane — armoured crawler with a single vulnerable eye. */
B.chelvane = [0, 1].map(f => bossCanvas(32, 32, (x) => {
  body(x, 16, 18, 15, 12, '#8a7a3a');
  x.fillStyle = '#584c1f';
  x.fillRect(1, 8, 7, 4); x.fillRect(24, 8, 7, 4);          // claws
  x.fillRect(2, 26, 6, 4); x.fillRect(24, 26, 6, 4);
  x.fillStyle = '#bda95c';
  for (let i = 0; i < 4; i++) x.fillRect(6 + i * 6, 8, 4, 3);
  // the eye: open frame is the only vulnerable window
  if (f) { eye(x, 16, 18, 6, '#e33a30'); }
  else { x.fillStyle = '#584c1f'; body(x, 16, 18, 6, 6, '#584c1f'); x.fillStyle = '#0d0b14'; x.fillRect(10, 17, 12, 2); }
}));

/* Ghyrn — the beast king. Phases between solid and half-real. */
B.ghyrn = [0, 1].map(f => bossCanvas(32, 32, (x) => {
  body(x, 16, 20, 13, 11, '#6e2f4f');
  body(x, 16, 11, 9, 8, '#8a3d61');
  x.fillStyle = '#2a0f1e';                                  // horns
  x.beginPath(); x.moveTo(8, 6); x.lineTo(3, -1); x.lineTo(12, 4); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(24, 6); x.lineTo(29, -1); x.lineTo(20, 4); x.closePath(); x.fill();
  eye(x, 12, 11, 2.4, '#ff8f22'); eye(x, 20, 11, 2.4, '#ff8f22');
  x.fillStyle = '#2a0f1e'; x.fillRect(11, 16, 10, 3);
  x.fillStyle = '#f6c32e';                                  // trident
  x.fillRect(f ? 27 : 3, 12, 2, 18);
  x.fillStyle = '#9c5478'; x.fillRect(9, 28, 5, 4); x.fillRect(18, 28, 5, 4);
}));
B.ghyrnGhost = B.ghyrn.map(c => {
  const g = makeCanvas(c.width, c.height), x = g.getContext('2d');
  x.globalAlpha = 0.45; x.drawImage(c, 0, 0); x.globalAlpha = 1;
  return g;
});

})(window);
