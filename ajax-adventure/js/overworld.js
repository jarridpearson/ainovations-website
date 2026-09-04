/* ============================================================================
   EMBERQUEST — overworld.js
   The overworld is no longer generated: it is read straight out of ow-data.js,
   which is the real 16 x 8 screen, 256 x 88 tile layout with the original
   walkability. This file turns that into per-screen tile and collision grids
   and hangs the entrances off it.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;
const T = EQ.T;
const CW = 16, CH = 11;
const idx = (x, y) => y * CW + x;

/* ------------------------------------------------------- level entrances
   Everything here comes from ow-secrets.js, which is generated from the
   labelled Quest-1 overworld map. Nothing is hand-placed.                   */
const SEC = EQ.OW_SECRETS || { levels:{}, caves:{} };

const DUNGEONS = EQ.DUNGEON_ENTRANCES = {};
Object.keys(SEC.levels).forEach(n => {
  const d = SEC.levels[n];
  DUNGEONS[n] = { col:d.col, row:d.row, tx:d.tx, ty:d.ty,
                  gate: d.how === 'open' ? null : d.how };
});
EQ.LEVEL_OW = {};
Object.keys(DUNGEONS).forEach(n => { EQ.LEVEL_OW[n] = [DUNGEONS[n].col, DUNGEONS[n].row]; });

/* Every cave: where it is, how it opens, what is inside. */
const CAVES_BY_SCREEN = {};
Object.keys(SEC.caves).forEach(k => {
  const c = SEC.caves[k];
  const sk = c.sc + ',' + c.sr;
  (CAVES_BY_SCREEN[sk] = CAVES_BY_SCREEN[sk] || []).push(c);
});

/* Screens that loop until you walk the right sequence. */
const LOST = EQ.LOST = {
  woods: { screens: ['1,6','2,6','1,7','2,7'], entry: '2,7',
           path: ['up','left','down','left'] },
  hills: { screens: ['9,0','10,0','11,0','9,1','10,1'], entry: '10,1',
           path: ['up','up','up','right'] },
};

/* ---------------------------------------------------------------- decoding */
let DEFS = null, ROWS = null;
function ensure() {
  if (DEFS) return;
  const raw = EQ.OW_RAW;
  if (!raw) throw new Error('ow-data.js did not load');
  DEFS = {}; ROWS = raw.rows;
  Object.keys(raw.defs).forEach(ch => {
    const d = raw.defs[ch];
    DEFS[ch] = { tile: d[0], solid: d[1] };
  });
}

/* Work out a paint palette for a screen from what is actually in it. */
function biomeOf(counts, col, row) {
  if (counts.sand > 12) return 'desert';
  if (counts.water > 34) return 'coast';
  if (counts.path > 24) return (col <= 6 && row >= 4) ? 'grave' : 'mount';
  if (counts.tree > 48) return 'forest';
  if (counts.mtn > 70) return 'mount';
  return 'grass';
}

const OW = EQ.OVERWORLD = {
  W: 16, H: 8,
  cache: {},

  featsFor(col, row) {
    const out = [];
    for (const n in DUNGEONS) {
      const d = DUNGEONS[n];
      if (d.col === col && d.row === row)
        out.push({ t:'dungeon', n:+n, tx:d.tx, ty:d.ty, gate:d.gate });
    }
    (CAVES_BY_SCREEN[col + ',' + row] || []).forEach((c, i) => {
      out.push({ t:'cave', id:c.id, tx:c.tx, ty:c.ty,
                 gate: c.how === 'open' ? null : c.how,
                 hintIndex: (col * 7 + row * 3 + i) % 13 });
    });
    return out;
  },

  screen(col, row) {
    ensure();
    if (col < 0 || row < 0 || col > 15 || row > 7) return null;
    const key = col + ',' + row;
    if (this.cache[key]) return this.cache[key];

    const tiles = new Uint8Array(CW * CH);
    const solid = new Uint8Array(CW * CH);
    const counts = { sand:0, water:0, path:0, tree:0, mtn:0, ground:0, cave:0 };
    const caves = [];

    for (let ty = 0; ty < CH; ty++) {
      const line = ROWS[row * CH + ty];
      for (let tx = 0; tx < CW; tx++) {
        const d = DEFS[line[col * CW + tx]];
        const i = idx(tx, ty);
        tiles[i] = d.tile;
        solid[i] = d.solid;
        switch (d.tile) {
          case T.SAND:   counts.sand++;   break;
          case T.WATER:  counts.water++;  break;
          case T.PATH:   counts.path++;   break;
          case T.TREE:   counts.tree++;   break;
          case T.MTN:    counts.mtn++;    break;
          case T.CAVE:   counts.cave++; caves.push([tx, ty]); break;
          default:       counts.ground++;
        }
      }
    }

    const biome = biomeOf(counts, col, row);
    const feats = this.featsFor(col, row);

    /* The blocking map treats a cave mouth as wall, but you have to be able
       to walk into one. Open every ungated entrance. Gated ones stay solid
       until the bomb / flame / pipe / shove opens them. */
    feats.forEach(f => {
      if (f.gate) return;
      solid[idx(f.tx, f.ty)] = 0;
    });

    const sc = { col, row, key, tiles, solid, biome, feats, counts };
    this.cache[key] = sc;
    return sc;
  },

  inBounds(col, row) { return col >= 0 && row >= 0 && col < 16 && row < 8; },
};

/* -------------------------------------------------------- enemy population
   Positions and counts come from ow-enemies.js, extracted from the labelled
   map. The species is read back from each sprite's dominant colour, steered
   by what part of the world the screen is in.                               */
const OW_SPECIES = {
  '216,40,0':    { mount:'lynel',     grave:'ghini',  desert:'leever',     def:'octorok' },
  '0,0,168':     { mount:'lynelBlue', grave:'ghini',  desert:'leeverBlue', def:'octorokBlue' },
  '252,152,56':  { mount:'moblin',    desert:'leever',                     def:'moblin' },
  '200,76,12':   { mount:'moblinBlue',                                     def:'moblin' },
  '0,128,136':   { coast:'zola',                                           def:'tektite' },
  '92,148,252':  { coast:'zola',                                           def:'tektiteBlue' },
  '252,252,252': { grave:'ghini',                                          def:'peahat' },
  '252,216,168': { mount:'lynel',                                          def:'armos' },
  '0,0,0':       { grave:'ghini',                                          def:'ghini' },
  '0,126,0':     { def:'peahat' },
  '150,57,9':    { def:'moblin' },
};

EQ.OW_SPAWNS = function (sc) {
  const key = sc.col + ',' + sc.row;
  const list = (EQ.OW_ENEMIES && EQ.OW_ENEMIES[key]) || null;
  if (!list) return [];
  const biome = sc.biome;
  return list.map(e => {
    const rule = OW_SPECIES[e[2].join(',')];
    const name = rule ? (rule[biome] || rule.def) : 'octorok';
    return { name, x: e[0], y: e[1] };
  });
};

})(window);
