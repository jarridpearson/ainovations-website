# Where the data comes from

Nothing in `js/ow-data.js`, `js/ow-secrets.js`, `js/ow-enemies.js`,
`js/dungeon-data.js` or `js/room-data.js` was typed by hand. Each is generated
by a script here from published reference material.

## Overworld terrain — `js/ow-data.js`

From the ROM-accurate 256x88 tile dump and matching walkability map at
https://github.com/asweigart/nes_zelda_map_data
(`overworld_map/nes_zelda_overworld_tile_map.txt`,
`nes_zelda_overworld_blocking_map.txt`). Tile ids map to render categories;
the solid/passable flag is taken verbatim from the blocking map.

## Overworld entrances and cave contents — `extract-secrets.py`

From the labelled Quest-1 overworld map at
https://nesmaps.com/maps/Zelda/ZeldaOverworldQ1.html (`ZeldaOverworldMapQ1.png`).
That map rings every hidden entrance in a coloured box and prints each cave's
contents beside it:

    red / orange box   bomb or fire, decided by the terrain underneath
    green box          shove it
    blue box           play the pipe at it

Contents are recovered by template-matching the map's own legend icons and
attaching each icon to the nearest entrance. This is how the five overworld
heart containers, both special swords, the letter and the bracelet cave were
located. Caves whose label resolves to no icon fall back to an old man, a toll
or a gift, which is what most plain caves in the original hold.

## Overworld creatures — `extract-ow-enemies.py`

Every overworld tile's true graphic is known, so anything on the labelled map
that is *not* the expected tile is drawn on top. Compact clumps of the right
size are creatures; wide clumps are text and get dropped. Species is read back
from the clump's dominant colour, steered by the screen's region.

## Dungeon topology — `extract-dungeons.py`

From the Quest-1 level maps at https://nesmaps.com/maps/Zelda/
(`Level1Q1.png` .. `Level9Q1.png`). Room presence, per-side door type,
entrance, boss room, prize room, map / compass / key rooms and major item rooms
are all read out of the images. Door type comes from the count of pure-black
pixels in a 32x32 band at the centre of each wall — the counts are perfectly
quantised:

    0 wall | 60 shutter | 64 locked | 149,163 open | 197,203 bombable

Self-validating: every door pair comes out symmetric across all 236 rooms, and
the only unpaired door in each level is its entrance staircase.

## Dungeon interiors and creatures — `extract-rooms.py`

Each room's 12x7 floor is compared tile-by-tile against that level's own floor
tile: a close match is floor, a mostly-blue tile is water, anything else is a
block. Creatures are then the clumps of non-floor colour standing on floor
tiles; count and position are exact, species is inferred from dominant colour
against the level's real roster.

## Still inferred, not extracted

* Which two rooms each grey stair passage joins. The maps draw passages
  detached, so these are wired to whatever restores connectivity. Level 9 also
  needed two inferred wall openings, logged to the console at load.
* Exact shop prices and gift/toll amounts, which are drawn as text rather than
  icons. Standard values are used.

## Rerunning

Drop the source images in a directory and point `SCRATCH` at it:

    SCRATCH=/path/to/maps python3 extract-dungeons.py
    SCRATCH=/path/to/maps python3 extract-rooms.py
    SCRATCH=/path/to/maps python3 extract-secrets.py
    SCRATCH=/path/to/maps python3 extract-ow-enemies.py
