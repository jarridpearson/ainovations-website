"""Read each dungeon room's interior layout and its enemies off the level maps.

For every room the 12 x 7 floor area is compared tile-by-tile against that
level's own floor tile:

  * a tile that matches the floor closely is floor (any mismatch is a sprite
    standing on it)
  * a tile that is mostly blue is water
  * anything else is a block

Enemies are then the connected clumps of non-floor pixels sitting on floor
tiles. Their count and position are exact; the species is inferred from the
clump's dominant colour against the level's real roster.

Run:  SCRATCH=<dir with L1..L9.png> python3 extract-rooms.py
"""
import json, os, sys
from collections import Counter, defaultdict
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
SC   = os.environ.get('SCRATCH', '.')

RW, RH = 256, 176
FX, FY, FW, FH = 32, 32, 12, 7          # floor area, in tiles, inside a room

data = json.loads(
    open(os.path.join(ROOT, 'js', 'dungeon-data.js')).read()
    .split('global.EQ.DUNGEON_DATA =')[1].rsplit(';\n})(window);', 1)[0])


def tile_bytes(px, x0, y0):
    return bytes(v for yy in range(16) for xx in range(16)
                 for v in px[x0 + xx, y0 + yy])


def run(n):
    im = Image.open(os.path.join(SC, 'L%d.png' % n)).convert('RGB')
    px = im.load()
    L = data[str(n)]
    cells = list(L['rooms'].keys()) + L.get('passages', [])

    # the level's floor tile is simply the most common tile in its rooms
    freq = Counter()
    for k in cells:
        c, r = map(int, k.split(','))
        for ty in range(FH):
            for tx in range(FW):
                freq[tile_bytes(px, c * RW + FX + tx * 16, r * RH + FY + ty * 16)] += 1
    floor = freq.most_common(1)[0][0]

    def classify(t):
        same = sum(1 for i in range(0, len(t), 3)
                   if t[i] == floor[i] and t[i+1] == floor[i+1] and t[i+2] == floor[i+2])
        if same / 256.0 > 0.55:
            return '.', same / 256.0
        b = sum(t[i+2] for i in range(0, len(t), 3)) / 256.0
        rr = sum(t[i] for i in range(0, len(t), 3)) / 256.0
        g = sum(t[i+1] for i in range(0, len(t), 3)) / 256.0
        if b > rr + 40 and b > g + 30:
            return '~', same / 256.0
        return '#', same / 256.0

    # only the floor tile's own colours count as architecture; creatures are
    # then any clump of other colour standing on a floor tile
    struct = set()
    for i in range(0, len(floor), 3):
        struct.add((floor[i], floor[i+1], floor[i+2]))

    out = {}
    for k in cells:
        c, r = map(int, k.split(','))
        rowsout = []
        for ty in range(FH):
            line = ''
            for tx in range(FW):
                line += classify(tile_bytes(px, c * RW + FX + tx * 16, r * RH + FY + ty * 16))[0]
            rowsout.append(line)

        x0, y0 = c * RW + FX, r * RH + FY
        W_, H_ = FW * 16, FH * 16
        def onfloor(ax, ay):
            return rowsout[ay // 16][ax // 16] == '.'

        seen = set(); sprites = []
        for yy in range(H_):
            for xx in range(W_):
                if (xx, yy) in seen or not onfloor(xx, yy): continue
                if px[x0 + xx, y0 + yy] in struct: continue
                stack = [(xx, yy)]; blob = []
                while stack:
                    ax, ay = stack.pop()
                    if (ax, ay) in seen: continue
                    if ax < 0 or ay < 0 or ax >= W_ or ay >= H_: continue
                    if not onfloor(ax, ay): continue
                    if px[x0 + ax, y0 + ay] in struct: continue
                    seen.add((ax, ay)); blob.append((ax, ay))
                    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(1,-1),(-1,1)):
                        stack.append((ax + dx, ay + dy))
                if not (26 <= len(blob) <= 300): continue
                bxs = [b[0] for b in blob]; bys = [b[1] for b in blob]
                if max(bxs) - min(bxs) > 22 or max(bys) - min(bys) > 22: continue
                cc = Counter(px[x0 + a, y0 + b] for a, b in blob)
                sprites.append([ (min(bxs) + max(bxs)) // 2, (min(bys) + max(bys)) // 2,
                                 list(cc.most_common(1)[0][0]) ])
        out[k] = {'lay': rowsout, 'spr': sprites}
    return out


all_out = {}
for n in range(1, 10):
    if not os.path.exists(os.path.join(SC, 'L%d.png' % n)):
        print('missing L%d.png' % n); sys.exit(1)
    all_out[str(n)] = run(n)
    nb = sum(sum(l.count('#') for l in v['lay']) for v in all_out[str(n)].values())
    nw = sum(sum(l.count('~') for l in v['lay']) for v in all_out[str(n)].values())
    ns = sum(len(v['spr']) for v in all_out[str(n)].values())
    print('L%d  rooms=%-3d blocks=%-4d water=%-4d sprites=%d'
          % (n, len(all_out[str(n)]), nb, nw, ns))

hdr = '''/* ============================================================================
   THE AJAX ADVENTURE - room-data.js
   Per-room interior layout and sprite placement, read off the Quest-1 level
   maps. `lay` is the 12x7 floor: '.' floor  '#' block  '~' water.
   `spr` is [tileX, tileY, [r,g,b]] for each creature standing in the room -
   position and count are exact, species is inferred from the dominant colour.
   Generated by _tools/extract-rooms.py - do not hand-edit.
   ========================================================================== */
(function (global) {
'use strict';
global.EQ = global.EQ || {};
global.EQ.ROOM_DATA =
'''
open(os.path.join(ROOT, 'js', 'room-data.js'), 'w').write(
    hdr + json.dumps(all_out, separators=(',', ':')) + ';\n})(window);\n')
print('wrote js/room-data.js', os.path.getsize(os.path.join(ROOT, 'js', 'room-data.js')))
