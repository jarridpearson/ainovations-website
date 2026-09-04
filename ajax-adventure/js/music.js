/* ============================================================================
   EMBERQUEST — music.js
   Original chiptune compositions. Nothing here is transcribed from any
   existing work; every melody was written for this project.
   Sequences are 16th-note grids. '.' = rest/hold. Noise channel: x = kick,
   o = snare/hat.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ = global.EQ || {};
const S = str => str.trim().split(/\s+/);

function track(tempo, channels, loop) {
  const ch = channels.map(c => ({ wave: c[0], vol: c[1], dur: c[2], seq: S(c[3]) }));
  const len = ch.reduce((m, c) => Math.max(m, c.seq.length), 0);
  return { tempo, ch, len, loop: loop !== false };
}

EQ.MUSIC = {

  /* ---- Title: slow, stately, hopeful --------------------------------- */
  title: track(96, [
    ['square', 0.15, 0.30, `
      D5 .  .  .  .  .  A4 .  .  .  .  .  D5 .  .  .
      F5 .  .  .  E5 .  .  .  D5 .  .  .  .  .  .  .
      C5 .  .  .  .  .  G4 .  .  .  .  .  C5 .  .  .
      E5 .  .  .  D5 .  .  .  A4 .  .  .  .  .  .  .
    `],
    ['triangle', 0.13, 0.42, `
      D3 .  .  .  .  .  .  .  D3 .  .  .  .  .  .  .
      Bb2 . .  .  .  .  .  .  A2 .  .  .  .  .  .  .
      C3 .  .  .  .  .  .  .  C3 .  .  .  .  .  .  .
      G2 .  .  .  .  .  .  .  A2 .  .  .  .  .  .  .
    `],
    ['triangle', 0.07, 0.28, `
      A4 .  .  .  .  .  .  .  F4 .  .  .  .  .  .  .
      D4 .  .  .  .  .  .  .  E4 .  .  .  .  .  .  .
      G4 .  .  .  .  .  .  .  E4 .  .  .  .  .  .  .
      C5 .  .  .  .  .  .  .  A4 .  .  .  .  .  .  .
    `],
  ]),

  /* ---- Overworld: heroic march, the main travelling theme ------------- */
  overworld: track(138, [
    ['square', 0.155, 0.13, `
      A4 .  E5 .  D5 .  C5 .  B4 .  C5 .  D5 .  E5 .
      F5 .  E5 .  D5 .  C5 .  B4 .  .  .  B4 .  C5 .
      G4 .  D5 .  C5 .  B4 .  A4 .  B4 .  C5 .  D5 .
      E5 .  .  .  D5 .  C5 .  A4 .  .  .  .  .  E5 .
      A5 .  G5 .  F5 .  E5 .  D5 .  E5 .  F5 .  G5 .
      A5 .  .  .  G5 .  F5 .  E5 .  .  .  D5 .  C5 .
      F5 .  E5 .  D5 .  C5 .  B4 .  C5 .  D5 .  B4 .
      A4 .  .  .  .  .  C5 .  B4 .  .  .  A4 .  .  .
    `],
    ['square', 0.075, 0.12, `
      C4 .  .  .  A4 .  .  .  E4 .  .  .  A4 .  .  .
      D4 .  .  .  A4 .  .  .  G4 .  .  .  B4 .  .  .
      B3 .  .  .  G4 .  .  .  C4 .  .  .  A4 .  .  .
      C4 .  .  .  A4 .  .  .  E4 .  .  .  A4 .  .  .
      F4 .  .  .  C5 .  .  .  D4 .  .  .  A4 .  .  .
      E4 .  .  .  C5 .  .  .  A3 .  .  .  E4 .  .  .
      D4 .  .  .  A4 .  .  .  G4 .  .  .  B4 .  .  .
      A3 .  .  .  E4 .  .  .  A3 .  .  .  C4 .  .  .
    `],
    ['triangle', 0.14, 0.16, `
      A2 .  A2 .  .  .  A2 .  E2 .  E2 .  .  .  E2 .
      D3 .  D3 .  .  .  D3 .  G2 .  G2 .  .  .  G2 .
      C3 .  C3 .  .  .  C3 .  A2 .  A2 .  .  .  A2 .
      A2 .  A2 .  .  .  A2 .  E2 .  E2 .  .  .  E2 .
      F2 .  F2 .  .  .  F2 .  D3 .  D3 .  .  .  D3 .
      A2 .  A2 .  .  .  A2 .  A2 .  A2 .  .  .  A2 .
      D3 .  D3 .  .  .  D3 .  G2 .  G2 .  .  .  G2 .
      A2 .  A2 .  .  .  E2 .  A2 .  .  .  A2 .  .  .
    `],
    ['noise', 0.10, 0.05, `
      x .  o .  .  .  o .  x .  o .  .  .  o .
      x .  o .  .  .  o .  x .  o .  o .  o .
    `],
  ]),

  /* ---- Dungeon: cramped, minor, uneasy -------------------------------- */
  dungeon: track(112, [
    ['square', 0.13, 0.16, `
      D4 .  .  .  Eb4 . .  .  D4 .  .  .  A3 .  .  .
      D4 .  .  .  F4 .  .  .  Eb4 . .  .  .  .  .  .
      C4 .  .  .  Db4 . .  .  C4 .  .  .  G3 .  .  .
      Bb3 . .  .  .  .  .  .  A3 .  .  .  .  .  .  .
      D4 .  Eb4 . F4 .  Gb4 . F4 .  Eb4 . D4 .  .  .
      A3 .  Bb3 . C4 .  D4 .  Eb4 . .  .  D4 .  .  .
      Gb4 . .  .  F4 .  .  .  Eb4 . .  .  D4 .  .  .
      A3 .  .  .  .  .  .  .  A3 .  .  .  .  .  .  .
    `],
    ['triangle', 0.16, 0.24, `
      D2 .  .  .  .  .  .  .  D2 .  .  .  .  .  .  .
      Bb1 . .  .  .  .  .  .  A1 .  .  .  .  .  .  .
      C2 .  .  .  .  .  .  .  C2 .  .  .  .  .  .  .
      G1 .  .  .  .  .  .  .  A1 .  .  .  .  .  .  .
      D2 .  .  .  D2 .  .  .  D2 .  .  .  D2 .  .  .
      A1 .  .  .  A1 .  .  .  Bb1 . .  .  .  .  .  .
      Eb2 . .  .  .  .  .  .  D2 .  .  .  .  .  .  .
      A1 .  .  .  .  .  .  .  D2 .  .  .  .  .  .  .
    `],
    ['noise', 0.07, 0.06, `
      x .  .  .  .  .  o .  .  .  .  .  x .  o .
    `],
  ]),

  /* ---- Boss: driving, chromatic, urgent -------------------------------- */
  boss: track(168, [
    ['square', 0.16, 0.09, `
      E4 E4 F4 F4 E4 E4 D4 D4 E4 E4 F4 F4 G4 .  .  .
      E4 E4 F4 F4 E4 E4 D4 D4 C4 .  B3 .  .  .  .  .
      A4 A4 Bb4 Bb4 A4 A4 G4 G4 A4 A4 Bb4 Bb4 C5 . . .
      A4 A4 G4 G4 F4 .  E4 .  D4 .  .  .  .  .  .  .
    `],
    ['sawtooth', 0.09, 0.08, `
      E3 .  .  .  E3 .  .  .  E3 .  .  .  E3 .  .  .
      C3 .  .  .  C3 .  .  .  B2 .  .  .  B2 .  .  .
      A3 .  .  .  A3 .  .  .  A3 .  .  .  A3 .  .  .
      F3 .  .  .  E3 .  .  .  D3 .  .  .  D3 .  .  .
    `],
    ['triangle', 0.17, 0.10, `
      E1 .  E1 .  E1 .  E1 .  E1 .  E1 .  E1 .  E1 .
      C2 .  C2 .  C2 .  C2 .  B1 .  B1 .  B1 .  B1 .
      A1 .  A1 .  A1 .  A1 .  A1 .  A1 .  A1 .  A1 .
      F1 .  F1 .  E1 .  E1 .  D2 .  D2 .  D2 .  D2 .
    `],
    ['noise', 0.12, 0.04, `
      x .  o .  x .  o .  x .  o .  x o  o o
    `],
  ]),

  /* ---- Ganon-analogue final battle: low, wrong, relentless ------------- */
  ghyrn: track(150, [
    ['sawtooth', 0.15, 0.11, `
      C4 .  B3 .  C4 .  Db4 . C4 .  B3 .  Bb3 . A3 .
      Ab3 . A3 .  Bb3 . B3 .  C4 .  .  .  .  .  .  .
      F4 .  E4 .  Eb4 . D4 .  Db4 . C4 .  B3 .  Bb3 .
      A3 .  .  .  .  .  .  .  C4 .  .  .  .  .  .  .
    `],
    ['square', 0.07, 0.09, `
      .  C3 .  C3 .  C3 .  C3 .  C3 .  C3 .  C3 .  C3
      .  Ab2 . Ab2 . Ab2 . Ab2 . G2 .  G2 .  G2 .  G2
      .  F3 .  F3 .  F3 .  F3 .  Db3 . Db3 . Db3 . Db3
      .  A2 .  A2 .  A2 .  A2 .  C3 .  C3 .  C3 .  C3
    `],
    ['triangle', 0.19, 0.12, `
      C1 C1 .  C1 .  C1 C1 .  C1 C1 .  C1 .  C1 C1 .
      Ab1 Ab1 . Ab1 . Ab1 Ab1 . G1 G1 . G1 . G1 G1 .
    `],
    ['noise', 0.13, 0.05, `
      x .  .  o x .  .  o x .  o o  x o  o o
    `],
  ]),

  /* ---- Cave / shop: sparse, warm, safe -------------------------------- */
  cave: track(88, [
    ['triangle', 0.13, 0.32, `
      G4 .  .  .  .  .  .  .  D5 .  .  .  .  .  .  .
      C5 .  .  .  .  .  .  .  B4 .  .  .  .  .  .  .
      A4 .  .  .  .  .  .  .  E5 .  .  .  .  .  .  .
      D5 .  .  .  .  .  .  .  G4 .  .  .  .  .  .  .
    `],
    ['triangle', 0.08, 0.40, `
      G2 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
      C3 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
      A2 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
      D3 .  .  .  .  .  .  .  G2 .  .  .  .  .  .  .
    `],
  ]),

  /* ---- Triforce room / after a level is cleared ------------------------ */
  cleared: track(120, [
    ['square', 0.17, 0.20, `
      C5 .  E5 .  G5 .  C6 .  .  .  G5 .  C6 .  .  .
      A5 .  F5 .  G5 .  C6 .  .  .  .  .  .  .  .  .
    `],
    ['triangle', 0.14, 0.22, `
      C3 .  C3 .  G2 .  G2 .  .  .  C3 .  C3 .  .  .
      F2 .  F2 .  G2 .  G2 .  .  .  C3 .  .  .  .  .
    `],
  ], false),

  /* ---- Ending: broad and triumphant ----------------------------------- */
  ending: track(104, [
    ['square', 0.16, 0.26, `
      G4 .  .  .  C5 .  .  .  E5 .  .  .  G5 .  .  .
      F5 .  .  .  E5 .  .  .  D5 .  .  .  C5 .  .  .
      A4 .  .  .  D5 .  .  .  F5 .  .  .  A5 .  .  .
      G5 .  .  .  F5 .  .  .  E5 .  .  .  .  .  .  .
      E5 .  .  .  F5 .  .  .  G5 .  .  .  C6 .  .  .
      B5 .  .  .  A5 .  .  .  G5 .  .  .  E5 .  .  .
      F5 .  .  .  E5 .  .  .  D5 .  .  .  G4 .  .  .
      C5 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
    `],
    ['triangle', 0.15, 0.30, `
      C3 .  .  .  .  .  .  .  C3 .  .  .  .  .  .  .
      F2 .  .  .  .  .  .  .  G2 .  .  .  .  .  .  .
      D3 .  .  .  .  .  .  .  D3 .  .  .  .  .  .  .
      G2 .  .  .  .  .  .  .  C3 .  .  .  .  .  .  .
      A2 .  .  .  .  .  .  .  F2 .  .  .  .  .  .  .
      G2 .  .  .  .  .  .  .  C3 .  .  .  .  .  .  .
      F2 .  .  .  .  .  .  .  G2 .  .  .  .  .  .  .
      C3 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
    `],
    ['noise', 0.08, 0.06, `
      x .  .  .  o .  .  .  x .  .  .  o .  o .
    `],
  ]),

  /* ---- Game over ------------------------------------------------------- */
  gameover: track(92, [
    ['square', 0.16, 0.30, `
      D5 .  .  .  C5 .  .  .  Bb4 . .  .  A4 .  .  .
      G4 .  .  .  .  .  F4 .  .  .  D4 .  .  .  .  .
    `],
    ['triangle', 0.14, 0.34, `
      D3 .  .  .  .  .  .  .  Bb2 . .  .  .  .  .  .
      G2 .  .  .  .  .  .  .  D2 .  .  .  .  .  .  .
    `],
  ], false),

};

})(window);
