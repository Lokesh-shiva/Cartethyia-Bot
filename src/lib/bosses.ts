export interface BossMove {
  name:   string;
  damage: number; // multiplier on boss ATK
  effect: string; // flavor text
}

export interface Boss {
  id:          string;
  name:        string;
  title:       string;
  worldLevel:  number;
  element:     string;
  weakness:    string;   // element that deals 1.5x damage
  artFile:     string;   // assets/bosses/xxx.png
  baseHp:      number;
  baseAtk:     number;
  baseDef:     number;
  vibBar:      number;   // stagger bar max
  moves:       BossMove[];
  defeatLoot:  {
    credits:       number;
    tuningModules: number;
    sealingTubes:  number;
    forgingOres:   number;
    paradoxCores:  number;
    resonanceExp:  number;
  };
}

export const BOSSES: Record<number, Boss> = {
  // WL0 → WL1
  0: {
    id:         "resonant_wraith",
    name:       "Resonant Wraith",
    title:      "Echo of the Fallen Drifter",
    worldLevel: 0,
    element:    "HAVOC",
    weakness:   "SPECTRO",
    artFile:    "The Resonant Wraith.png",
    baseHp:     2400,
    baseAtk:    85,
    baseDef:    40,
    vibBar:     100,
    moves: [
      { name: "Void Claw",      damage: 1.0,  effect: "tears through your resonance field"   },
      { name: "Spectral Surge", damage: 1.4,  effect: "unleashes a wave of corrupted energy" },
      { name: "Phase Drift",    damage: 0.6,  effect: "clips you as it passes through reality"},
    ],
    defeatLoot: { credits: 800, tuningModules: 4, sealingTubes: 2, forgingOres: 2, paradoxCores: 0, resonanceExp: 200 },
  },

  // WL1 → WL2
  1: {
    id:         "tidecaller_sovereign",
    name:       "Tidecaller Sovereign",
    title:      "Ruler of Conflicting Tides",
    worldLevel: 1,
    element:    "GLACIO",
    weakness:   "FUSION",
    artFile:    "Tidecaller Sovereign.png",
    baseHp:     8500,
    baseAtk:    185,
    baseDef:    110,
    vibBar:     130,
    moves: [
      { name: "Tidal Crush",    damage: 1.1,  effect: "sends a crashing wave of frozen plasma"     },
      { name: "Sovereign's Edict", damage: 1.6, effect: "channels the full force of both tides"   },
      { name: "Frost Brand",    damage: 0.8,  effect: "marks you with a slowing ice sigil"        },
    ],
    defeatLoot: { credits: 1600, tuningModules: 6, sealingTubes: 4, forgingOres: 3, paradoxCores: 1, resonanceExp: 450 },
  },

  // WL2 → WL3
  2: {
    id:         "fractured_arbiter",
    name:       "Fractured Arbiter",
    title:      "Broken Judge of the Ancient World",
    worldLevel: 2,
    element:    "SPECTRO",
    weakness:   "HAVOC",
    artFile:    "The Fractured Arbiter.png",
    baseHp:     15000,
    baseAtk:    280,
    baseDef:    170,
    vibBar:     155,
    moves: [
      { name: "Divine Verdict",  damage: 1.2,  effect: "brands you with sacred judgment"           },
      { name: "Clockwork Ruin",  damage: 1.0,  effect: "sends shattered gears of gold through you" },
      { name: "Arbiter's Wrath", damage: 1.8,  effect: "channels both divine and Havoc energy"     },
    ],
    defeatLoot: { credits: 3000, tuningModules: 8, sealingTubes: 6, forgingOres: 5, paradoxCores: 2, resonanceExp: 800 },
  },

  // WL3 → WL4
  3: {
    id:         "nullfire_construct",
    name:       "Nullfire Construct",
    title:      "Forgotten Weapon of the Void Age",
    worldLevel: 3,
    element:    "ELECTRO",
    weakness:   "AERO",
    artFile:    "Nullfire Construct.png",
    baseHp:     24000,
    baseAtk:    380,
    baseDef:    230,
    vibBar:     185,
    moves: [
      { name: "Arc Discharge",      damage: 1.1, effect: "releases a chain of plasma arcs across you"       },
      { name: "Void Circuit",       damage: 1.5, effect: "overloads your resonance field with null-current" },
      { name: "Pulse Collapse",     damage: 0.9, effect: "compresses the local field into a detonation"     },
      { name: "Overload Protocol",  damage: 1.9, effect: "enters overload state — unleashes everything"     },
    ],
    defeatLoot: { credits: 5000, tuningModules: 10, sealingTubes: 8, forgingOres: 7, paradoxCores: 3, resonanceExp: 1300 },
  },

  // WL4 → WL5
  4: {
    id:         "sable_harbinger",
    name:       "Sable Harbinger",
    title:      "Herald of the Endless Dark",
    worldLevel: 4,
    element:    "HAVOC",
    weakness:   "SPECTRO",
    artFile:    "Sable Harbinger.png",
    baseHp:     38000,
    baseAtk:    490,
    baseDef:    295,
    vibBar:     205,
    moves: [
      { name: "Umbral Fang",        damage: 1.2, effect: "tears through your guard with darkened claws"       },
      { name: "Voidborne Surge",    damage: 1.6, effect: "erupts in cascading waves of Havoc energy"          },
      { name: "Shadow Step",        damage: 0.7, effect: "phases through your defenses and strikes from within"},
      { name: "Herald's Judgment",  damage: 2.0, effect: "calls down the full wrath of the endless dark"      },
    ],
    defeatLoot: { credits: 7500, tuningModules: 12, sealingTubes: 10, forgingOres: 9, paradoxCores: 4, resonanceExp: 2000 },
  },

  // WL5 → WL6
  5: {
    id:         "auric_colossus",
    name:       "Auric Colossus",
    title:      "Last Guardian of the Resonant Age",
    worldLevel: 5,
    element:    "SPECTRO",
    weakness:   "HAVOC",
    artFile:    "Auric Colossus.png",
    baseHp:     60000,
    baseAtk:    640,
    baseDef:    380,
    vibBar:     225,
    moves: [
      { name: "Radiant Crush",      damage: 1.3, effect: "brings its full weight down in blinding light"      },
      { name: "Lumen Barrage",      damage: 1.5, effect: "fires concentrated beams of ancient Spectro energy" },
      { name: "Resonant Rebuke",    damage: 1.0, effect: "repels your attack with a shockwave of pure light"  },
      { name: "Guardian's Wrath",   damage: 2.2, effect: "channels the age of resonance into a single strike" },
    ],
    defeatLoot: { credits: 12000, tuningModules: 15, sealingTubes: 12, forgingOres: 11, paradoxCores: 6, resonanceExp: 3000 },
  },

  // WL6 → WL7
  6: {
    id:         "embercrown_tyrant",
    name:       "Embercrown Tyrant",
    title:      "Sovereign of the Undying Flame",
    worldLevel: 6,
    element:    "FUSION",
    weakness:   "GLACIO",
    artFile:    "Embercrown Tyrant.png",
    baseHp:     90000,
    baseAtk:    840,
    baseDef:    500,
    vibBar:     230,
    moves: [
      { name: "Cinder Lance",       damage: 1.2, effect: "hurls a superheated spike of condensed flame"        },
      { name: "Pyroclasm Wave",     damage: 1.6, effect: "erupts in a spreading tide of molten resonance"      },
      { name: "Emberburst Step",    damage: 0.9, effect: "vanishes in flame and strikes from your blind side"  },
      { name: "Crown of Ruin",      damage: 2.3, effect: "ignites everything — the crown burns brightest last" },
    ],
    defeatLoot: { credits: 18000, tuningModules: 18, sealingTubes: 15, forgingOres: 14, paradoxCores: 8, resonanceExp: 4500 },
  },

  // WL7 → WL8
  7: {
    id:         "galeborne_phantom",
    name:       "Galeborne Phantom",
    title:      "Wanderer Between the Winds",
    worldLevel: 7,
    element:    "AERO",
    weakness:   "ELECTRO",
    artFile:    "Galeborne Phantom.png",
    baseHp:     130000,
    baseAtk:    1080,
    baseDef:    640,
    vibBar:     245,
    moves: [
      { name: "Rift Slash",         damage: 1.1, effect: "cuts through your guard with an invisible wind blade"  },
      { name: "Tempest Surge",      damage: 1.7, effect: "summons a column of compressed aero energy"            },
      { name: "Phase Step",         damage: 0.8, effect: "ghosts through your defenses entirely"                 },
      { name: "Gale Annihilation",  damage: 2.4, effect: "tears the air apart — the silence after is deafening" },
    ],
    defeatLoot: { credits: 25000, tuningModules: 22, sealingTubes: 18, forgingOres: 17, paradoxCores: 10, resonanceExp: 6000 },
  },

  // WL8 — final
  8: {
    id:         "resonant_absolute",
    name:       "The Resonant Absolute",
    title:      "That Which Cannot Be Silenced",
    worldLevel: 8,
    element:    "SPECTRO",
    weakness:   "HAVOC",
    artFile:    "The Resonant Absolute.png",
    baseHp:     200000,
    baseAtk:    1400,
    baseDef:    820,
    vibBar:     260,
    moves: [
      { name: "Resonance Collapse", damage: 1.4, effect: "compresses all local resonance into a point of ruin"  },
      { name: "Absolute Radiance",  damage: 1.8, effect: "blinds everything — you feel it before you see it"    },
      { name: "Null Convergence",   damage: 1.1, effect: "reverses your resonance field for a single terrible moment" },
      { name: "The Final Silence",  damage: 2.6, effect: "there are no words for what this is"                  },
    ],
    defeatLoot: { credits: 35000, tuningModules: 28, sealingTubes: 22, forgingOres: 20, paradoxCores: 14, resonanceExp: 8000 },
  },
};

export function getBoss(worldLevel: number): Boss | null {
  return BOSSES[worldLevel] ?? null;
}

// Scale boss stats based on player level — used by non-gear-aware contexts (encounter, dungeon mobs).
// Scales up to 3.5× at max level (90).
export function scaledBoss(boss: Boss, playerLevel: number): { hp: number; atk: number; def: number } {
  const scale = 1 + (playerLevel / 90) * 2.5;
  return {
    hp:  Math.floor(boss.baseHp  * scale),
    atk: Math.floor(boss.baseAtk * scale),
    def: Math.floor(boss.baseDef * scale),
  };
}

// Extra multiplier applied when a player is overleveled vs a boss's intended WL bracket.
// At the level cap of the NEXT world level, this returns ~1.4 — making repeat runs harder.
export function veteranScale(playerLevel: number, bossWorldLevel: number): number {
  const intendedMax = (bossWorldLevel + 1) * 10 + 20; // rough WL bracket ceiling
  const overshoot   = Math.max(0, playerLevel - intendedMax);
  return 1 + overshoot * 0.025; // +2.5% per level above the bracket
}
