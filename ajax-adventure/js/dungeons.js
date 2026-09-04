/* ============================================================================
   THE AJAX ADVENTURE — dungeons.js
   Compiles the extracted level data (dungeon-data.js) into playable rooms.

   Real, taken from the published Quest-1 maps:
     room grids, per-side door types, entrance room, boss room, prize room,
     map / compass / key rooms, movable-block rooms, major item rooms,
     and the stair passages that several major items sit in.

   Still mine, and marked as such below:
     the interior block layout of each room, and which creatures stand in it.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;

/* ------------------------------------------------------------ room layouts
   Floor is 12 x 7 tiles. '.' floor  '#' block  '~' water  'S' statue
   'P' pushable block  'F' fire  'B' sand                                    */
const LAYOUTS = EQ.LAYOUTS = {
  plain: [
    "............", "............", "............", "............",
    "............", "............", "............"],
  four: [
    "............", "..##....##..", "..##....##..", "............",
    "..##....##..", "..##....##..", "............"],
  aisle: [
    "............", ".##..##..##.", ".##..##..##.", "............",
    ".##..##..##.", ".##..##..##.", "............"],
  ring: [
    "............", ".####..####.", ".#........#.", ".#........#.",
    ".#........#.", ".####..####.", "............"],
  cross: [
    "............", ".....##.....", ".....##.....", ".###....###.",
    ".....##.....", ".....##.....", "............"],
  diamond: [
    "............", ".....##.....", "....#..#....", "...#....#...",
    "....#..#....", ".....##.....", "............"],
  water: [
    "............", "............", ".~~~~~~~~~~.", ".~~~~~~~~~~.",
    ".~~~~~~~~~~.", "............", "............"],
  moat: [
    "............", ".~~~~~~~~~~.", ".~........~.", ".~........~.",
    ".~........~.", ".~~~~~~~~~~.", "............"],
  maze: [
    "............", ".#.#####.##.", ".#.....#..#.", ".#.###.#.##.",
    ".#...#.#....", ".###.#.####.", "............"],
  pillars: [
    "............", "..#..#..#...", "............", "..#..#..#...",
    "............", "..#..#..#...", "............"],
  spiral: [
    "............", ".#########..", ".#........#.", ".#.#####..#.",
    ".#.....#..#.", ".#####.#..#.", "............"],
  braziers: [
    "............", ".F........F.", "............", "............",
    "............", ".F........F.", "............"],
  zigzag: [
    "............", ".####.......", ".......####.", ".####.......",
    ".......####.", ".####.......", "............"],
  gauntlet: [
    "............", ".#..#..#..#.", ".#..#..#..#.", "............",
    ".#..#..#..#.", ".#..#..#..#.", "............"],
  boss: [
    "............", ".S........S.", "............", "............",
    "............", ".S........S.", "............"],
  /* the grey stair corridor a few of the major items sit in */
  passage: [
    "############", "#..........#", "#.########.#", "#.#......#.#",
    "#.########.#", "#..........#", "############"],
};
const LAY_POOL = ['plain','four','aisle','ring','cross','diamond','pillars',
                  'zigzag','maze','spiral','gauntlet','braziers'];

/* ---------------------------------------------------------------- per level */
const NAMES = { 1:'EAGLE', 2:'MOON', 3:'MANJI', 4:'SNAKE', 5:'LIZARD',
                6:'DRAGON', 7:'DEMON', 8:'LION', 9:'DEATH MOUNTAIN' };

const BOSSES = {
  1:{ kind:'sarquin' },                 // Aquamentus
  2:{ kind:'grovak' },                  // Dodongo
  3:{ kind:'vellthorn' },               // Manhandla
  4:{ kind:'skalgar' },                 // Gleeok
  5:{ kind:'umbroth' },                 // Digdogger
  6:{ kind:'chelvane', tint:'red' },    // Gohma, red
  7:{ kind:'sarquinPair' },             // two Aquamentus
  8:{ kind:'chelvane', tint:'blue' },   // Gohma, blue
  9:{ kind:'ghyrn' },                   // the beast king
};

/* Sprite colour on the level maps -> which creature it is. Position and count
   are extracted; this table is how the colour is read back as a species,
   using each level's real roster. */
const SPECIES = {
  1:{ '0,0,168':'keese',     '216,40,0':'goriya',    '252,152,56':'stalfos',
      '92,148,252':'gel',    '200,76,12':'gel',      '252,252,252':'stalfos' },
  2:{ '252,252,252':'rope',  '200,76,12':'gel',      '0,0,168':'keese',
      '92,148,252':'gel',    '216,40,0':'goriya',    '252,152,56':'rope' },
  3:{ '0,0,168':'darknut',   '252,252,252':'stalfos','200,76,12':'zol',
      '92,148,252':'gel',    '216,40,0':'goriya',    '252,152,56':'goriya' },
  4:{ '0,0,168':'keese',     '92,148,252':'zol',     '252,252,252':'wallmaster',
      '252,152,56':'goriya', '216,40,0':'vire',      '200,76,12':'wallmaster' },
  5:{ '252,252,252':'gibdo', '252,152,56':'polsvoice','92,148,252':'zol',
      '0,0,168':'darknut',   '200,76,12':'polsvoice','216,40,0':'keese' },
  6:{ '252,152,56':'likelike','252,252,252':'wizzrobe','92,148,252':'darknutBlue',
      '0,0,168':'keese',     '76,220,72':'zol',      '200,76,12':'likelike' },
  7:{ '252,252,252':'wizzrobe','0,0,168':'darknutBlue','92,148,252':'moldorm',
      '200,76,12':'polsvoice','252,152,56':'likelike','216,40,0':'vire' },
  8:{ '0,0,168':'darknutBlue','216,40,0':'lanmola',  '252,152,56':'likelike',
      '252,252,252':'wizzrobeBlue','92,148,252':'gibdo','200,76,12':'gibdo' },
  9:{ '252,152,56':'gibdo',  '0,0,168':'darknutBlue','92,148,252':'wizzrobeBlue',
      '0,232,216':'patra',   '128,208,16':'vire',    '252,252,252':'likelike',
      '216,40,0':'lanmola',  '200,76,12':'polsvoice' },
};

/* Fallback roster if a colour is not in the table. */
const POOLS = {
  1:['keese','stalfos','gel','goriya'],
  2:['keese','rope','gel','stalfos','goriya'],
  3:['zol','keese','goriya','stalfos','rope','darknut'],
  4:['zol','keese','goriya','stalfos','wallmaster','vire'],
  5:['gibdo','darknut','keese','zol','wallmaster','polsvoice'],
  6:['wizzrobe','darknut','likelike','keese','gibdo','vire'],
  7:['likelike','wizzrobe','darknut','polsvoice','wallmaster','moldorm'],
  8:['darknutBlue','wizzrobeBlue','likelike','gibdo','lanmola','vire'],
  9:['darknutBlue','wizzrobeBlue','likelike','gibdo','patra','lanmola','vire','polsvoice'],
};

/* ----------------------------------------------------------- compilation */
const cache = {};

function compile(n) {
  if (cache[n]) return cache[n];
  const src = EQ.DUNGEON_DATA && EQ.DUNGEON_DATA[String(n)];
  if (!src) { console.warn('no data for level ' + n); return null; }

  const rng = EQ.util.mulberry(7000 + n * 313);
  const rooms = {};
  const itemAt = {};
  (src.items || []).forEach(it => { itemAt[it[0]] = it[1]; });
  const keySet = new Set(src.keys || []);
  const blockSet = new Set(src.blocks || []);

  const charFor = (k) => {
    if (k === src.entry)    return 'S';
    if (k === src.boss)     return 'B';
    if (k === src.triforce) return 'T';
    if (k === src.princess) return 'P';
    if (itemAt[k])          return 'I';
    if (k === src.map)      return 'm';
    if (k === src.compass)  return 'c';
    if (keySet.has(k))      return 'k';
    return '#';
  };

  Object.keys(src.rooms).forEach(k => {
    const [x, y] = k.split(',').map(Number);
    const ch = charFor(k);
    rooms[k] = {
      x, y, ch, key: k,
      doors: Object.assign({}, src.rooms[k]),
      item: itemAt[k] || null,
      lay: 'plain',
      enemies: null, dark: false, passage: false,
    };
  });

  /* stair passages: real rooms, entered by a staircase rather than a door */
  (src.passages || []).forEach(k => {
    const [x, y] = k.split(',').map(Number);
    rooms[k] = {
      x, y, key: k, passage: true,
      ch: itemAt[k] ? 'I' : '#',
      item: itemAt[k] || null,
      doors: { up:'wall', down:'wall', left:'wall', right:'wall' },
      lay: 'passage', enemies: null, dark: false,
    };
  });

  /* The map images draw the stair passages detached, so which two rooms each
     one joins is NOT recoverable from them. The original uses these as
     transport staircases, so they are wired here to whatever pair of rooms
     restores connectivity — inferred, not extracted. */
  const stairFrom = {};

  /* interiors and creature placement, read off the level maps */
  const RD = (EQ.ROOM_DATA && EQ.ROOM_DATA[String(n)]) || {};
  const spec = SPECIES[n] || {};
  Object.keys(rooms).forEach(k => {
    const r = rooms[k];
    const rd = RD[k];

    if (rd && rd.lay && rd.lay.length === 7) r.grid = rd.lay;
    else r.grid = EQ.LAYOUTS[r.passage ? 'passage' : 'plain'];

    const quiet = (r.ch === 'S' || r.ch === 'T' || r.ch === 'P');
    if (r.ch === 'B') { r.enemies = null; r.spawns = null; }
    else if (quiet)   { r.enemies = []; r.spawns = []; }
    else {
      r.spawns = [];
      (rd ? rd.spr : []).forEach(sp => {
        const [sx, sy, col] = sp;
        // an item sitting on the plinth in the middle of a prize room
        if ('mckITB'.indexOf(r.ch) >= 0 && Math.abs(sx - 96) < 26 && Math.abs(sy - 56) < 22) return;
        const name = spec[col.join(',')] || POOLS[n][(rng() * POOLS[n].length) | 0];
        r.spawns.push({ name, x: 32 + sx - 8, y: 32 + sy - 8 });
      });
      r.enemies = r.spawns.map(s => s.name);
    }
    r.shutOnEntry = (r.ch === 'B' || r.ch === 'I');
    r.dropsKey = !!(r.enemies && r.enemies.length && rng() < 0.30);
    r.dark = (n >= 5) && rng() < 0.16 && r.ch === '#';
  });

  const L = {
    n, name: NAMES[n], w: src.w, h: src.h,
    entry: src.entry.split(',').map(Number),
    boss: src.boss, bossKind: BOSSES[n].kind, bossTint: BOSSES[n].tint,
    triforce: src.triforce, princess: src.princess,
    mapRoom: src.map, compassRoom: src.compass,
    passages: src.passages || [], stairFrom,
    _rooms: rooms, _count: Object.keys(rooms).length,
  };

  /* ---------------- connectivity ---------------- */
  const NB = [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  const OPP = { up:'down', down:'up', left:'right', right:'left' };

  function reach() {
    const seen = {}, q = [src.entry];
    seen[src.entry] = true;
    while (q.length) {
      const r = rooms[q.shift()]; if (!r) continue;
      (r.stairTo || []).forEach(pk => { if (!seen[pk]) { seen[pk] = true; q.push(pk); } });
      if (r.passage) (r.ends || []).forEach(bk => { if (rooms[bk] && !seen[bk]) { seen[bk] = true; q.push(bk); } });
      NB.forEach(([dir, dx, dy]) => {
        if (r.doors[dir] === 'wall') return;
        const nk = (r.x + dx) + ',' + (r.y + dy);
        if (rooms[nk] && !seen[nk]) { seen[nk] = true; q.push(nk); }
      });
    }
    return seen;
  }
  const ordinary = k => rooms[k] && !rooms[k].passage;
  const linkStair = (a, b, pk) => {
    rooms[pk].ends = [a, b];
    (rooms[a].stairTo = rooms[a].stairTo || []).push(pk);
    (rooms[b].stairTo = rooms[b].stairTo || []).push(pk);
    stairFrom[pk] = [a, b];
  };

  /* hang each passage between the reached region and a cut-off one */
  (src.passages || []).forEach(pk => {
    const seen = reach();
    const inSet  = Object.keys(rooms).filter(k => ordinary(k) && seen[k]);
    const outSet = Object.keys(rooms).filter(k => ordinary(k) && !seen[k]);
    if (!inSet.length) return;
    const a = inSet[Math.floor(inSet.length / 2)];
    const b = outSet.length ? outSet[0] : inSet[inSet.length - 1];
    linkStair(a, b, pk);
  });

  /* last resort: if anything is still cut off, open the nearest shared wall
     so the level cannot be a dead end. Logged, because it is a guess. */
  for (let guard = 0; guard < 40; guard++) {
    const seen = reach();
    const out = Object.keys(rooms).filter(k => ordinary(k) && !seen[k]);
    if (!out.length) break;
    let done = false;
    for (const ok of out) {
      const r = rooms[ok];
      for (const [dir, dx, dy] of NB) {
        const nk = (r.x + dx) + ',' + (r.y + dy);
        if (!rooms[nk] || rooms[nk].passage || !seen[nk]) continue;
        r.doors[dir] = 'bomb';
        rooms[nk].doors[OPP[dir]] = 'bomb';
        console.info('L' + n + ': opened inferred passage ' + nk + ' <-> ' + ok);
        done = true; break;
      }
      if (done) break;
    }
    if (!done) break;
  }
  const orphans = Object.keys(rooms).filter(k => ordinary(k) && !reach()[k]);
  if (orphans.length) console.warn('L' + n + ' still unreachable:', orphans.join(' '));

  cache[n] = L;
  return L;
}

EQ.dungeon = compile;
EQ.compileAllDungeons = function () { for (let i = 1; i <= 9; i++) compile(i); };

})(window);
