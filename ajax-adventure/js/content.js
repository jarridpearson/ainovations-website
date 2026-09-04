/* ============================================================================
   EMBERQUEST — content.js
   Item registry and every cave / shop / old-man scene in the overworld.
   All dialogue is original writing.
   ========================================================================== */
(function (global) {
'use strict';
const EQ = global.EQ;

/* --------------------------------------------------------------- the items
   slot   : where it lives in the inventory grid ('b' = selectable B-item)
   passive: owning it is the whole effect                                     */
const ITEMS = EQ.ITEMS = {
  swordWood:      { name:'WOODEN SWORD',       spr:'swordIcon0', tier:1, kind:'sword' },
  swordWhite:     { name:'WHITE SWORD',    spr:'swordIcon1', tier:2, kind:'sword' },
  swordMagic:     { name:'MAGICAL SWORD',     spr:'swordIcon2', tier:3, kind:'sword' },
  shieldWood:     { name:'SHIELD',      spr:'shieldWood', kind:'shield', tier:1 },
  shieldMagic:    { name:'MAGICAL SHIELD',   spr:'shieldMagic', kind:'shield', tier:2 },
  bow:            { name:'BOW',             spr:'bow',        slot:'b' },
  arrow:          { name:'ARROW',           spr:'arrowItem',  passive:true },
  arrowSilver:    { name:'SILVER ARROW',    spr:'arrowSilver', passive:true },
  boomerang:      { name:'BOOMERANG',       spr:'boomerang',  slot:'b' },
  boomerangMagic: { name:'MAGICAL BOOMERANG',  spr:'boomerangMagic', slot:'b' },
  candleBlue:     { name:'BLUE CANDLE',    spr:'candleBlue', slot:'b' },
  candleRed:      { name:'RED CANDLE',     spr:'candle',     slot:'b' },
  recorder:       { name:'RECORDER',       spr:'recorder',   slot:'b' },
  bait:           { name:'FOOD',      spr:'bait',       slot:'b' },
  letter:         { name:'LETTER',   spr:'letter',     slot:'b' },
  potionRed:      { name:'2ND POTION',       spr:'potionRed',  slot:'b' },
  potionBlue:     { name:'LIFE POTION',      spr:'potionBlue', slot:'b' },
  rod:            { name:'MAGICAL ROD',       spr:'rod',        slot:'b' },
  book:           { name:'BOOK OF MAGIC',  spr:'book',       passive:true },
  ringBlue:       { name:'BLUE RING',       spr:'ringBlue',   passive:true },
  ringRed:        { name:'RED RING',        spr:'ringRed',    passive:true },
  ladder:         { name:'STEPLADDER',     spr:'ladder',     passive:true },
  raft:           { name:'RAFT',            spr:'raft',       passive:true },
  bracelet:       { name:'POWER BRACELET',      spr:'bracelet',   passive:true },
  magicKey:       { name:'MAGICAL KEY',     spr:'magicKey',   passive:true },
  map:            { name:'MAP',             spr:'map' },
  compass:        { name:'COMPASS',         spr:'compass' },
  shard:          { name:'TRIFORCE',        spr:'shard' },
};

/* Order the inventory grid is laid out in (top row = B-selectable). */
EQ.B_ITEMS = ['boomerang','boomerangMagic','bomb','bow','candleBlue','candleRed',
              'recorder','bait','potionBlue','potionRed','rod'];

/* ------------------------------------------------------------- cave scenes
   kind:
     give     one item, once, free (gate on hearts / an item you must hold)
     shop     up to three things for sale
     takeOne  three on offer, you may have exactly one
     gamble   pay 10, one of three chests pays out
     pay      an unavoidable toll
     gift     free rupees, once
     hint     talk only
     heart    a heart container sitting on a plinth
   ------------------------------------------------------------------------ */
const CAVES = EQ.CAVES = {
  /* --- the three swords ------------------------------------------------ */
  swordWood: { kind:'give', npc:'oldman', item:'swordWood',
    text:"IT IS DANGEROUS ALONE.\nTAKE THIS." },
  swordWhite: { kind:'give', npc:'oldman', item:'swordWhite', needHearts:5,
    text:"MASTER IT AND THIS IS\nYOURS.",
    deny:"COME BACK WITH FIVE\nHEARTS." },
  swordMagic: { kind:'give', npc:'oldman', item:'swordMagic', needHearts:12,
    text:"YOU HAVE OUTLASTED EVERY\nWARNING. TAKE IT.",
    deny:"TWELVE HEARTS. NOT ONE\nFEWER." },

  /* --- a heart container on a plinth ----------------------------------- */
  heart: { kind:'heart', text:"" },

  /* --- shops ------------------------------------------------------------ */
  shopFood: { kind:'shop', npc:'merchant', text:"BUY SOMETHING.",
    stock:[ ['bait', 100], ['shieldMagic', 90], ['candleBlue', 60] ] },
  shopRing: { kind:'shop', npc:'merchant', text:"BUY SOMETHING.",
    stock:[ ['ringBlue', 250], ['bait', 100], ['arrow', 80] ] },
  shopBomb: { kind:'shop', npc:'merchant', text:"BUY SOMETHING.",
    stock:[ ['bombUp', 20], ['shieldMagic', 90], ['arrow', 80] ] },
  potionShop: { kind:'shop', npc:'oldwoman', needItem:'letter',
    text:"THE SEAL IS GOOD.\nWHAT WILL IT BE.",
    deny:"SHOW ME A LETTER FIRST.",
    stock:[ ['potionBlue', 40], ['potionRed', 68] ] },

  /* --- the letter, and the one-of-three cave ---------------------------- */
  letter: { kind:'give', npc:'oldwoman', item:'letter',
    text:"SHOW THIS TO THE OLD\nWOMAN." },
  takeOne: { kind:'takeOne', npc:'oldman', text:"TAKE ANY ONE YOU WANT.",
    stock:['bracelet','bombUp','arrow'] },

  /* --- money ------------------------------------------------------------ */
  gamble:   { kind:'gamble', npc:'merchant', text:"LET US PLAY THE MONEY\nMAKING GAME." },
  payDoor:  { kind:'pay', npc:'oldman', amount:20,
    text:"PAY ME FOR THE DOOR\nREPAIR CHARGE." },
  gift30:   { kind:'gift', amount:30,  npc:'oldman', text:"IT IS A SECRET TO\nEVERYBODY." },
  gift100:  { kind:'gift', amount:100, npc:'oldman', text:"IT IS A SECRET TO\nEVERYBODY." },

  /* --- old men with advice; one is picked per cave --------------------- */
  hint: { kind:'hint', npc:'oldman', text:"" },

  /* --- dungeon old men -------------------------------------------------- */
  dHint:   { kind:'hint', npc:'oldman', text:"GO ON THEN." },
  dBombUp: { kind:'give', npc:'oldman', item:'bombUp',
    text:"YOUR SATCHEL LOOKS THIN.\nLET ME WIDEN IT." },
};

/* Hint lines. Same information the original's old men give, in my own words. */
EQ.OW_HINTS = [
  "WALLS THAT SOUND HOLLOW\nWILL OPEN FOR A BOMB.",
  "THE HILLS TURN YOU AROUND.\nNORTH. NORTH. NORTH. EAST.",
  "THE WOOD SENDS YOU BACK\nUNLESS YOU GO NORTH, WEST,\nSOUTH, WEST.",
  "A PIPE PLAYED BY STILL\nWATER MOVES THE WATER.",
  "FIRE FINDS THE DOOR THAT\nA TREE IS HIDING.",
  "THE EASTMOST PENINSULA\nHOLDS A SECRET.",
  "THE ONE WITH THE HORN\nFEARS ARROWS ALONE.",
  "FEED THE ONE THAT WILL\nNOT LET YOU PASS.",
  "A BOMB DOWN ITS THROAT.\nNOTHING ELSE WORKS.",
  "GRAVESTONES MOVE FOR\nSTRONG ARMS.",
  "THERE ARE SECRETS WHERE\nNO FAIRY LIVES.",
  "GO UP THE MOUNTAIN\nAHEAD.",
  "AIM FOR THE EYE.",
];

/* Rotating pool of dungeon old-man lines, picked per level. */
EQ.DUNGEON_HINTS = [
  "EASTMOST ROOM HOLDS\nWHAT YOU CAME FOR.",
  "STRIKE THE WALL THAT\nDOES NOT ECHO.",
  "THE DARK ROOMS ARE NOT\nEMPTY. BRING A FLAME.",
  "SOME FLOORS PUSH BACK.\nSOME DO NOT.",
  "THE ONE WITH THE HORN\nFEARS NOTHING BUT ARROWS.",
  "FEED THE ONE THAT WILL\nNOT LET YOU PASS.",
  "PLAY THE PIPE AT THE\nTHING THAT WILL NOT DIE.",
  "A BOMB DOWN ITS THROAT.\nNOTHING ELSE WORKS.",
  "TAKE THE STAIR YOU HAVE\nNOT TAKEN.",
];

/* Prices shown for the pseudo-items used only in shops. */
EQ.PSEUDO = {
  bombUp: { name:'BOMBS', spr:'bomb' },
  arrow:  { name:'ARROWS',       spr:'arrowItem' },
};

})(window);
