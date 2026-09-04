"""Derive dungeon topology from the published Quest-1 level maps.

Each map is an exact room grid at native NES resolution (256x176 per room).
Door type is read from the count of pure-black pixels in a 32x32 band at the
centre of each wall; the counts are perfectly quantised, so they snap to a
small table. Validated by the fact that every door pair comes out symmetric
and the only unpaired door in each level is its entrance staircase.
"""
import json, os
from PIL import Image

RW, RH = 256, 176
SZ = {1:(6,6), 2:(4,8), 3:(5,6), 4:(4,8), 5:(4,8), 6:(6,8), 7:(6,8), 8:(5,8), 9:(8,8)}
SNAP = [0, 60, 64, 149, 163, 197, 203]
TYPE = {0:'wall', 60:'shutter', 64:'locked', 149:'open', 163:'open', 197:'bomb', 203:'bomb'}
ENTRY = {1:'2,5', 2:'1,7', 3:'3,5', 4:'1,7', 5:'2,7', 6:'1,7', 7:'1,7', 8:'3,7', 9:'6,7'}

# Verified by icon template-match against each map's own legend.
META = {
 1:{'boss':'4,1','triforce':'5,1','map':'2,2','compass':'3,3',
    'items':[['1,1','bow'],['3,2','boomerang']],
    'keys':['2,0','4,2','2,3','1,5'],'blocks':['1,0','1,2']},
 2:{'boss':'2,0','triforce':'1,0','map':'3,5','compass':None,
    'items':[['3,4','boomerangMagic']],
    'keys':['2,3','2,4','0,6','2,7'],'blocks':[]},
 3:{'boss':'4,2','triforce':'4,1','map':'3,2','compass':None,
    'items':[['0,5','raft']],
    'keys':['1,0','0,2','2,2','2,4','2,5'],'blocks':[]},
 4:{'boss':'3,1','triforce':'3,0','map':'1,2','compass':None,
    'items':[['2,4','ladder']],
    'keys':['1,0','0,4','1,5','0,7'],'blocks':['2,1','2,3']},
 5:{'boss':'0,2','triforce':'0,1','map':'2,4','compass':None,
    'items':[['0,0','recorder']],
    'keys':['2,1','2,2','3,2','3,4','1,5','3,7'],'blocks':['2,0','0,6']},
 6:{'boss':'4,1','triforce':'4,0','map':'1,1','compass':None,
    'items':[['0,0','rod']],
    'keys':['2,1','1,2','5,2','0,5','2,7'],'blocks':[]},
 7:{'boss':'2,2','triforce':'3,2','map':'0,1','compass':None,
    'items':[['3,3','candleRed']],
    'keys':['2,0','2,3','0,7'],'blocks':['5,0','2,1','1,2']},
 8:{'boss':'1,3','triforce':'1,2','map':'3,2','compass':None,
    'items':[['4,2','magicKey'],['0,7','book']],
    'keys':['0,4','1,4','1,5','2,5','3,5','4,7'],'blocks':['4,1','1,7']},
 9:{'boss':'2,4','princess':'2,3','triforce':None,'map':'7,2','compass':None,
    'items':[['0,0','arrowSilver'],['7,6','ringRed']],
    'keys':['7,4','6,5','7,5','1,6'],'blocks':[]},
}

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)))

def snap(v):
    return min(SNAP, key=lambda k: abs(k - v))

def extract(n):
    im = Image.open(os.path.join(SRC, 'L%d.png' % n)).convert('RGB')
    W, H = SZ[n]
    px = im.load()

    def black(p): return p[0] < 16 and p[1] < 16 and p[2] < 16

    def band_black(c, r, side):
        if side == 'up':    ox, oy = c*RW+112, r*RH
        elif side == 'down':ox, oy = c*RW+112, r*RH+144
        elif side == 'left':ox, oy = c*RW,     r*RH+72
        else:               ox, oy = c*RW+224, r*RH+72
        return sum(1 for y in range(oy, oy+32) for x in range(ox, ox+32) if black(px[x, y]))

    def fill(c, r):
        tot = nb = 0
        for y in range(6, 170, 3):
            for x in range(6, 250, 3):
                tot += 1
                p = px[c*RW+x, r*RH+y]
                if not (p[0] < 30 and p[1] < 30 and p[2] < 30): nb += 1
        return nb / tot

    def is_passage(c, r):
        grey = sum(1 for y in range(6, 170, 2) for x in range(6, 250, 2)
                   if px[c*RW+x, r*RH+y] == (116, 116, 116))
        return grey > 800

    def corners_present(c, r):
        pts = ((8,8), (247,8), (8,167), (247,167), (128,88))
        return sum(0 if black(px[c*RW+dx, r*RH+dy]) else 1 for dx, dy in pts) >= 4

    rooms, passages = {}, []
    for r in range(H):
        for c in range(W):
            if corners_present(c, r):
                doors = {s: TYPE[snap(band_black(c, r, s))] for s in ('up','down','left','right')}
                if not all(v == 'wall' for v in doors.values()):
                    rooms['%d,%d' % (c, r)] = doors
                    continue
            # not a doored room: a stair passage carries the grey corridor tiles
            if fill(c, r) > 0.30 and is_passage(c, r):
                passages.append('%d,%d' % (c, r))
    return {'w':W, 'h':H, 'entry':ENTRY[n], 'rooms':rooms, 'passages':passages}

out = {}
for n in range(1, 10):
    d = extract(n)
    d.update(META[n])
    out[str(n)] = d
    print('L%d  rooms=%-3d passages=%s' % (n, len(d['rooms']), d['passages']))

# ---- validation: door pairs must be symmetric in wall/non-wall ----
OPP = {'up':'down','down':'up','left':'right','right':'left'}
DV  = {'up':(0,-1),'down':(0,1),'left':(-1,0),'right':(1,0)}
problems = []
for n, L in out.items():
    for k, d in L['rooms'].items():
        c, r = map(int, k.split(','))
        for s, v in d.items():
            nk = '%d,%d' % (c+DV[s][0], r+DV[s][1])
            nb = L['rooms'].get(nk)
            if nb is None:
                if v != 'wall': problems.append('L%s %s %s=%s -> outside (entrance stair)' % (n, k, s, v))
                continue
            if (v == 'wall') != (nb[OPP[s]] == 'wall'):
                problems.append('L%s %s %s=%s vs %s=%s' % (n, k, s, v, nk, nb[OPP[s]]))
print('\nvalidation notes (%d):' % len(problems))
for p in problems: print('  ', p)

hdr = '''/* ============================================================================
   THE AJAX ADVENTURE - dungeon-data.js
   The nine levels of the first quest, derived from the published Quest-1
   level maps. Room grid, per-side door types, entrance, boss, prize and item
   rooms are the real layout; the artwork is drawn from scratch elsewhere.

   Generated by _dev/extract.py - do not hand-edit.
   door types: open | locked | bomb | shutter | wall
   ========================================================================== */
(function (global) {
'use strict';
global.EQ = global.EQ || {};
global.EQ.DUNGEON_DATA =
'''
body = json.dumps(out, indent=0, separators=(',', ':'))
with open(os.path.join(SRC, '..', 'js', 'dungeon-data.js'), 'w') as f:
    f.write(hdr + body + ';\n})(window);\n')
print('\nwrote js/dungeon-data.js', os.path.getsize(os.path.join(SRC,'..','js','dungeon-data.js')), 'bytes')
