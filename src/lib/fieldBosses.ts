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
  unlockWorldLevel?: number; // undefined = no WL gate (original 6); set = gated (named-set bosses)
  mechanicId?: string;       // dispatch key for src/lib/fieldBossMechanics.ts; undefined = no special mechanic
}

export const FIELD_BOSSES: FieldBoss[] = [
  {
    id:      "ignis_behemoth",
    name:    "Ignis Behemoth",
    title:   "Ember of the Deep Rift",
    element: "FUSION",
    weakness:"GLACIO",
    artFile: "Ignis Behemoth.png",
    baseHp:  3200, baseAtk: 170, baseDef: 85, vibBar: 105,
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
    baseHp:  3600, baseAtk: 148, baseDef: 120, vibBar: 110,
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
    baseHp:  3000, baseAtk: 190, baseDef: 72, vibBar: 100,
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
    baseHp:  3400, baseAtk: 178, baseDef: 78, vibBar: 103,
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
    baseHp:  3800, baseAtk: 165, baseDef: 100, vibBar: 108,
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
    baseHp:  3500, baseAtk: 158, baseDef: 106, vibBar: 106,
    moves: [
      { name: "Light Lance",     damage: 1.0, effect: "pierces you with a focused beam of spectro energy" },
      { name: "Radiant Burst",   damage: 1.4, effect: "detonates in blinding resonant light"            },
      { name: "Archive's End",   damage: 1.9, effect: "the records of your defeat are being written now" },
    ],
  },
];

export const NAMED_SET_FIELD_BOSSES: FieldBoss[] = [
  {
    id:      "cinderbound_colossus",
    name:    "Cinderbound Colossus",
    title:   "Herald of the Molten Sovereign",
    element: "FUSION",
    weakness:"GLACIO",
    artFile: "Cinderbound Colossus.png",
    baseHp:  4400, baseAtk: 195, baseDef: 100, vibBar: 120,
    unlockWorldLevel: 2,
    mechanicId: "MOLTEN_BUILDUP",
    moves: [
      { name: "Magma Crush",       damage: 1.0, effect: "brings down a fist wreathed in molten rock" },
      { name: "Ember Cascade",     damage: 1.4, effect: "showers the field in superheated slag" },
      { name: "Core Overload",     damage: 1.8, effect: "vents raw heat from its molten core" },
    ],
  },
  {
    id:      "cryoveil_warden",
    name:    "Cryoveil Warden",
    title:   "Sentinel of the Frostveil",
    element: "GLACIO",
    weakness:"FUSION",
    artFile: "Cryoveil Warden.png",
    baseHp:  4800, baseAtk: 170, baseDef: 135, vibBar: 125,
    unlockWorldLevel: 2,
    mechanicId: "FROST_BARRIER",
    moves: [
      { name: "Glacial Slam",      damage: 1.0, effect: "slams a crystalline shield into you" },
      { name: "Ice Shard Barrage", damage: 1.3, effect: "unleashes a volley of frozen shards" },
      { name: "Absolute Chill",    damage: 1.7, effect: "drops the field to absolute zero" },
    ],
  },
  {
    id:      "thundercrown_herald",
    name:    "Thundercrown Herald",
    title:   "Voice of the Storm Court",
    element: "ELECTRO",
    weakness:"AERO",
    artFile: "Thundercrown Herald.png",
    baseHp:  4200, baseAtk: 215, baseDef: 90, vibBar: 115,
    unlockWorldLevel: 2,
    mechanicId: "ENERGY_SURGE",
    moves: [
      { name: "Static Lash",           damage: 1.0, effect: "lashes out with a crackling whip of current" },
      { name: "Chain Lightning",       damage: 1.4, effect: "arcs violet lightning across the field" },
      { name: "Thunderclap Judgment",  damage: 1.9, effect: "brings down its full stormcrown fury" },
    ],
  },
  {
    id:      "galebound_sovereign",
    name:    "Galebound Sovereign",
    title:   "Wind Titan of the Open Sky",
    element: "AERO",
    weakness:"ELECTRO",
    artFile: "Galebound Sovereign.png",
    baseHp:  4500, baseAtk: 200, baseDef: 95, vibBar: 118,
    unlockWorldLevel: 2,
    mechanicId: "MOMENTUM_GUST",
    moves: [
      { name: "Cyclone Strike",   damage: 1.0, effect: "spins a cutting vortex toward you" },
      { name: "Tempest Slash",    damage: 1.3, effect: "carves the air with a bladed gale" },
      { name: "Gale Reckoning",   damage: 1.7, effect: "collapses the wind into a single devastating blow" },
    ],
  },
  {
    id:      "voidmaw_devourer",
    name:    "Voidmaw Devourer",
    title:   "The Hunger Between Worlds",
    element: "HAVOC",
    weakness:"SPECTRO",
    artFile: "Voidmaw Devourer.png",
    baseHp:  4900, baseAtk: 185, baseDef: 115, vibBar: 122,
    unlockWorldLevel: 2,
    mechanicId: "LIFESTEAL_FRENZY",
    moves: [
      { name: "Shadow Bite",  damage: 1.0, effect: "lunges with jaws of living shadow" },
      { name: "Void Rend",    damage: 1.4, effect: "tears at your resonance field" },
      { name: "Devour",       damage: 1.8, effect: "drinks deep of the void within you" },
    ],
  },
  {
    id:      "lumenwrought_seraph",
    name:    "Lumenwrought Seraph",
    title:   "Warden of the Golden Convergence",
    element: "SPECTRO",
    weakness:"HAVOC",
    artFile: "Lumenwrought Seraph.png",
    baseHp:  4700, baseAtk: 178, baseDef: 120, vibBar: 120,
    unlockWorldLevel: 2,
    mechanicId: "STEADY_REGEN",
    moves: [
      { name: "Radiant Smite",     damage: 1.0, effect: "smites you with focused light" },
      { name: "Light Fracture",    damage: 1.3, effect: "splits its radiance into cutting shards" },
      { name: "Convergent Beam",   damage: 1.7, effect: "channels its full golden convergence" },
    ],
  },
];

export const ALL_FIELD_BOSSES: FieldBoss[] = [...FIELD_BOSSES, ...NAMED_SET_FIELD_BOSSES];

export function getFieldBoss(id: string): FieldBoss | undefined {
  return ALL_FIELD_BOSSES.find(b => b.id === id);
}
