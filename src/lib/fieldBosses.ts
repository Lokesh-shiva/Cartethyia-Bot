// Field Bosses — always accessible from Lv5, no WL gate.
// Scale with the player via gearAwareScale.
// Each drops its own 4-cost echo on defeat.

export interface FieldBoss {
  id:       string;
  name:     string;    // must match BOSS_ECHO_DEFINITIONS name exactly
  title:    string;
  element:  string;
  weakness: string;
  artFile:  string;    // filename inside Bosses/
  baseHp:   number;
  baseAtk:  number;
  baseDef:  number;
  vibBar:   number;
  moves:    { name: string; damage: number; effect: string }[];
}

export const FIELD_BOSSES: FieldBoss[] = [
  {
    id:      "ignis_behemoth",
    name:    "Ignis Behemoth",
    title:   "Ember of the Deep Rift",
    element: "FUSION",
    weakness:"GLACIO",
    artFile: "Ignis Behemoth.png",
    baseHp:  1800, baseAtk: 110, baseDef: 55, vibBar: 80,
    moves: [
      { name: "Magma Fist",      damage: 1.0, effect: "slams you with a fist wreathed in molten rock"  },
      { name: "Cinder Burst",    damage: 1.4, effect: "detonates with a spray of superheated slag"     },
      { name: "Lava Surge",      damage: 1.7, effect: "channels the deep rift into a final eruption"   },
    ],
  },
  {
    id:      "permafrost_sovereign",
    name:    "Permafrost Sovereign",
    title:   "Ancient of the Frozen Deep",
    element: "GLACIO",
    weakness:"FUSION",
    artFile: "Permafrost Sovereign.png",
    baseHp:  2000, baseAtk: 95, baseDef: 80, vibBar: 85,
    moves: [
      { name: "Frost Grasp",     damage: 1.0, effect: "locks you in place with crystalline ice"        },
      { name: "Blizzard Rush",   damage: 1.3, effect: "charges through you on a wave of frozen wind"   },
      { name: "Absolute Zero",   damage: 1.8, effect: "entombs everything in a shell of absolute cold" },
    ],
  },
  {
    id:      "voltaic_aberrant",
    name:    "Voltaic Aberrant",
    title:   "Conduit of the Arc Tide",
    element: "ELECTRO",
    weakness:"AERO",
    artFile: "Voltaic Aberrant.png",
    baseHp:  1700, baseAtk: 125, baseDef: 45, vibBar: 75,
    moves: [
      { name: "Arc Strike",      damage: 1.0, effect: "discharges a raw bolt of plasma through you"    },
      { name: "Thunder Coil",    damage: 1.5, effect: "wraps you in a spiral of electro current"       },
      { name: "Overload",        damage: 1.9, effect: "reaches critical voltage — everything burns"    },
    ],
  },
  {
    id:      "tempest_ancient",
    name:    "Tempest Ancient",
    title:   "Born from the Void Between Winds",
    element: "AERO",
    weakness:"ELECTRO",
    artFile: "Tempest Ancient.png",
    baseHp:  1900, baseAtk: 115, baseDef: 50, vibBar: 78,
    moves: [
      { name: "Wind Slash",      damage: 1.0, effect: "cuts through your guard on an invisible current" },
      { name: "Gale Sweep",      damage: 1.4, effect: "hurls you with a concentrated burst of aero"    },
      { name: "Rift Collapse",   damage: 1.8, effect: "folds the local air — nothing can move through it" },
    ],
  },
  {
    id:      "null_ravager",
    name:    "Null Ravager",
    title:   "That Which Predates Memory",
    element: "HAVOC",
    weakness:"SPECTRO",
    artFile: "Null Ravager.png",
    baseHp:  2100, baseAtk: 105, baseDef: 65, vibBar: 82,
    moves: [
      { name: "Shade Claw",      damage: 1.0, effect: "tears at your resonance field from the inside"  },
      { name: "Void Pulse",      damage: 1.5, effect: "sends a shockwave of null-energy through you"   },
      { name: "Ancient Ruin",    damage: 2.0, effect: "something ancient and wrong unfolds around you" },
    ],
  },
  {
    id:      "luminal_specter",
    name:    "Luminal Specter",
    title:   "Warden of the Resonant Archive",
    element: "SPECTRO",
    weakness:"HAVOC",
    artFile: "Luminal Specter.png",
    baseHp:  1950, baseAtk: 100, baseDef: 70, vibBar: 80,
    moves: [
      { name: "Light Lance",     damage: 1.0, effect: "pierces you with a focused beam of spectro energy" },
      { name: "Radiant Burst",   damage: 1.4, effect: "detonates in blinding resonant light"            },
      { name: "Archive's End",   damage: 1.9, effect: "the records of your defeat are being written now" },
    ],
  },
];

export function getFieldBoss(id: string): FieldBoss | undefined {
  return FIELD_BOSSES.find(b => b.id === id);
}
