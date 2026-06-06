import { ECHO_DEFINITIONS, EchoDefinition } from "./echoes";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DungeonType = "ECHO" | "MATERIAL";

export interface WaveDefinition {
  enemyName:  string;
  hpMult:     number;   // multiplier on base enemy HP
  atkMult:    number;
  defMult:    number;
}

export interface DungeonRewards {
  // Echo dungeons
  echoElement?:        string;
  echoWeights?:        [number, number, number]; // 3★/4★/5★ chances
  // Material dungeons
  credits?:            number;
  tuningModules?:      number;
  sealingTubes?:       number;
  forgingOres?:        number;
  paradoxCores?:       number;
  resonanceRecords?:   number;
  // Both
  resonanceExp:        number;
  resonanceExpMult:    number;  // 3× for echo dungeons
}

export interface DungeonDefinition {
  id:            string;
  name:          string;
  emoji:         string;
  type:          DungeonType;
  description:   string;
  flavor:        string;
  levelReq:      number;
  worldLevelReq: number;
  auraCost:      number;   // Resonance Aura charges needed (1 normal, 2 boss trial)
  waves:         WaveDefinition[];
  rewards:       DungeonRewards;
  color:         number;
}

// ── Enemy scaling helpers ─────────────────────────────────────────────────────

function getEnemy(name: string): EchoDefinition {
  return ECHO_DEFINITIONS.find(e => e.name === name)
    ?? ECHO_DEFINITIONS[0];
}

function wave(name: string, hpMult = 1, atkMult = 1, defMult = 1): WaveDefinition {
  return { enemyName: name, hpMult, atkMult, defMult };
}

// ── Dungeon catalogue ─────────────────────────────────────────────────────────

export const DUNGEONS: DungeonDefinition[] = [

  // ── Echo Dungeons (element-themed) ─────────────────────────────────────────

  {
    id: "echo_fusion", name: "Emberbrand Sanctum", emoji: "🔥",
    type: "ECHO", color: 0xFF6B35,
    description: "Fusion-element enemies. Drops Fusion echoes + 3× EXP.",
    flavor: "The air burns with residual resonance. Something stirs in the heat.",
    levelReq: 5, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Ember Wisp",     1.2, 1.1, 1.0),
      wave("Ember Wisp",     1.5, 1.3, 1.1),
      wave("Magma Sentinel", 1.0, 1.0, 1.0),
    ],
    rewards: {
      echoElement: "FUSION", echoWeights: [70, 25, 5],
      resonanceExp: 120, resonanceExpMult: 3,
    },
  },

  {
    id: "echo_glacio", name: "Frostholm Vault", emoji: "❄️",
    type: "ECHO", color: 0x4FC3F7,
    description: "Glacio-element enemies. Drops Glacio echoes + 3× EXP.",
    flavor: "The stillness here is absolute. Ice does not forgive hesitation.",
    levelReq: 5, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Frost Mote",     1.2, 1.1, 1.0),
      wave("Frost Mote",     1.5, 1.3, 1.1),
      wave("Glacial Warden", 1.0, 1.0, 1.0),
    ],
    rewards: {
      echoElement: "GLACIO", echoWeights: [70, 25, 5],
      resonanceExp: 120, resonanceExpMult: 3,
    },
  },

  {
    id: "echo_electro", name: "Stormwire Labyrinth", emoji: "⚡",
    type: "ECHO", color: 0xB39DDB,
    description: "Electro-element enemies. Drops Electro echoes + 3× EXP.",
    flavor: "Voltage arcs between the walls. The air tastes like static.",
    levelReq: 5, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Static Spark",   1.2, 1.1, 1.0),
      wave("Static Spark",   1.5, 1.3, 1.1),
      wave("Thunder Drake",  1.0, 1.0, 1.0),
    ],
    rewards: {
      echoElement: "ELECTRO", echoWeights: [70, 25, 5],
      resonanceExp: 120, resonanceExpMult: 3,
    },
  },

  {
    id: "echo_aero", name: "Galerift Chamber", emoji: "🌪️",
    type: "ECHO", color: 0x80CBC4,
    description: "Aero-element enemies. Drops Aero echoes + 3× EXP.",
    flavor: "The wind has no source. It simply exists, and it resents your presence.",
    levelReq: 5, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Zephyr Mite",     1.2, 1.1, 1.0),
      wave("Zephyr Mite",     1.5, 1.3, 1.1),
      wave("Storm Harbinger", 1.0, 1.0, 1.0),
    ],
    rewards: {
      echoElement: "AERO", echoWeights: [70, 25, 5],
      resonanceExp: 120, resonanceExpMult: 3,
    },
  },

  {
    id: "echo_havoc", name: "Voidshear Den", emoji: "🌑",
    type: "ECHO", color: 0x9C27B0,
    description: "Havoc-element enemies. Drops Havoc echoes + 3× EXP.",
    flavor: "Light does not reach here. You step in anyway.",
    levelReq: 5, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Shadow Flicker", 1.2, 1.1, 1.0),
      wave("Shadow Flicker", 1.5, 1.3, 1.1),
      wave("Void Stalker",   1.0, 1.0, 1.0),
    ],
    rewards: {
      echoElement: "HAVOC", echoWeights: [70, 25, 5],
      resonanceExp: 120, resonanceExpMult: 3,
    },
  },

  {
    id: "echo_spectro", name: "Radiant Athenaeum", emoji: "✨",
    type: "ECHO", color: 0xFFD54F,
    description: "Spectro-element enemies. Drops Spectro echoes + 3× EXP.",
    flavor: "It is too bright. Every shadow here is deliberate.",
    levelReq: 5, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Lumen Speck",     1.2, 1.1, 1.0),
      wave("Lumen Speck",     1.5, 1.3, 1.1),
      wave("Radiant Keeper",  1.0, 1.0, 1.0),
    ],
    rewards: {
      echoElement: "SPECTRO", echoWeights: [70, 25, 5],
      resonanceExp: 120, resonanceExpMult: 3,
    },
  },

  // ── Material Dungeons ───────────────────────────────────────────────────────

  {
    id: "mat_tuning", name: "Resonance Forge", emoji: "🔧",
    type: "MATERIAL", color: 0x78B0C8,
    description: "Defeat 3 waves → earn Tuning Modules for leveling Echoes.",
    flavor: "The forge still burns. The resonators that ran it are long gone.",
    levelReq: 3, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Ember Wisp",    1.0, 1.0, 1.0),
      wave("Static Spark",  1.2, 1.1, 1.0),
      wave("Magma Sentinel",0.8, 0.9, 1.0),
    ],
    rewards: {
      tuningModules: 14, credits: 300,
      resonanceExp: 80, resonanceExpMult: 1,
    },
  },

  {
    id: "mat_tubes", name: "Sealed Archive", emoji: "🧪",
    type: "MATERIAL", color: 0x4CAF50,
    description: "Defeat 3 waves → earn Sealing Tubes for revealing Echo substats.",
    flavor: "The knowledge stored here is sealed — like everything else.",
    levelReq: 5, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Frost Mote",    1.0, 1.0, 1.0),
      wave("Lumen Speck",   1.2, 1.1, 1.0),
      wave("Glacial Warden",0.8, 0.9, 1.0),
    ],
    rewards: {
      sealingTubes: 9, credits: 350,
      resonanceExp: 80, resonanceExpMult: 1,
    },
  },

  {
    id: "mat_ores", name: "Forging Grounds", emoji: "⚙️",
    type: "MATERIAL", color: 0xF5A623,
    description: "Defeat 3 waves → earn Forging Ores for crafting weapons.",
    flavor: "The ore veins run deep. So do the things that guard them.",
    levelReq: 5, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Zephyr Mite",    1.0, 1.0, 1.0),
      wave("Shadow Flicker", 1.2, 1.1, 1.0),
      wave("Storm Harbinger",0.8, 0.9, 1.0),
    ],
    rewards: {
      forgingOres: 12, credits: 350,
      resonanceExp: 80, resonanceExpMult: 1,
    },
  },

  {
    id: "mat_records", name: "Memory Vault", emoji: "📀",
    type: "MATERIAL", color: 0x6366F1,
    description: "Defeat 3 waves → earn Resonance Records + big EXP boost.",
    flavor: "Every memory stored here belongs to someone who no longer needs it.",
    levelReq: 3, worldLevelReq: 0, auraCost: 1,
    waves: [
      wave("Lumen Speck",  1.0, 1.0, 1.0),
      wave("Frost Mote",   1.2, 1.1, 1.0),
      wave("Radiant Keeper",0.8, 0.9, 1.0),
    ],
    rewards: {
      resonanceRecords: 6, credits: 200,
      resonanceExp: 200, resonanceExpMult: 1,
    },
  },

  {
    id: "mat_paradox", name: "Paradox Crucible", emoji: "🔮",
    type: "MATERIAL", color: 0xEC4899,
    description: "WL1+ · Hard. Defeat 3 waves → earn Paradox Cores for rerolling substats.",
    flavor: "Everything here has been unmade and remade. You may be next.",
    levelReq: 20, worldLevelReq: 1, auraCost: 1,
    waves: [
      wave("Void Stalker",   1.5, 1.3, 1.2),
      wave("Thunder Drake",  1.5, 1.3, 1.2),
      wave("Void Stalker",   2.0, 1.5, 1.3),
    ],
    rewards: {
      paradoxCores: 5, sealingTubes: 4, credits: 600,
      resonanceExp: 150, resonanceExpMult: 1,
    },
  },

  // ── 4-Cost Boss Echo Trials ─────────────────────────────────────────────────
  // Cost 2 Aura each. Each trial drops 1 guaranteed 4-cost boss echo.

  {
    id: "boss_wraith", name: "Wraith's Trial", emoji: "🌑",
    type: "ECHO", color: 0x9C27B0,
    description: "Face the Resonant Wraith. Win to claim its 4-cost Boss Echo. (2 ◈ Aura)",
    flavor: "It does not hunt. It waits. It has been waiting since before you were born.",
    levelReq: 15, worldLevelReq: 0, auraCost: 2,
    waves: [
      wave("Shadow Flicker", 1.5, 1.3, 1.2),
      wave("Void Stalker",   1.8, 1.5, 1.3),
      wave("Shadow Flicker", 2.5, 2.0, 1.8),
    ],
    rewards: {
      echoElement: "HAVOC", echoWeights: [0, 80, 20],
      credits: 500, paradoxCores: 1,
      resonanceExp: 300, resonanceExpMult: 1,
    },
  },

  {
    id: "boss_tidecaller", name: "Tidecaller's Trial", emoji: "❄️",
    type: "ECHO", color: 0x4FC3F7,
    description: "WL1+ · Face the Tidecaller Sovereign. Win to claim its 4-cost Boss Echo. (2 ◈ Aura)",
    flavor: "Two tides pull at once. You are caught between them.",
    levelReq: 25, worldLevelReq: 1, auraCost: 2,
    waves: [
      wave("Frost Mote",    1.8, 1.5, 1.3),
      wave("Glacial Warden",2.0, 1.6, 1.5),
      wave("Frost Mote",    2.8, 2.2, 2.0),
    ],
    rewards: {
      echoElement: "GLACIO", echoWeights: [0, 75, 25],
      credits: 800, paradoxCores: 1, sealingTubes: 2,
      resonanceExp: 500, resonanceExpMult: 1,
    },
  },

  {
    id: "boss_embercrown", name: "Embercrown's Trial", emoji: "🔥",
    type: "ECHO", color: 0xFF6B35,
    description: "WL5+ · Face the Embercrown Tyrant. Win to claim its 4-cost Fusion Echo. (2 ◈ Aura)",
    flavor: "It was not born from fire. It became fire, over a very long time.",
    levelReq: 60, worldLevelReq: 5, auraCost: 2,
    waves: [
      wave("Ember Wisp",     3.0, 2.5, 2.2),
      wave("Magma Sentinel", 3.5, 3.0, 2.8),
      wave("Ember Wisp",     5.0, 4.5, 4.0),
    ],
    rewards: {
      echoElement: "FUSION", echoWeights: [0, 60, 40],
      credits: 1800, paradoxCores: 3, sealingTubes: 4,
      resonanceExp: 1200, resonanceExpMult: 1,
    },
  },

  {
    id: "boss_arbiter", name: "Arbiter's Trial", emoji: "⚡",
    type: "ECHO", color: 0xB39DDB,
    description: "WL2+ · Face the Fractured Arbiter. Win to claim its 4-cost Boss Echo. (2 ◈ Aura)",
    flavor: "Judgment does not require understanding. It only requires power.",
    levelReq: 35, worldLevelReq: 2, auraCost: 2,
    waves: [
      wave("Static Spark",  2.0, 1.8, 1.5),
      wave("Thunder Drake", 2.2, 2.0, 1.8),
      wave("Static Spark",  3.0, 2.5, 2.2),
    ],
    rewards: {
      echoElement: "ELECTRO", echoWeights: [0, 65, 35],
      credits: 1200, paradoxCores: 2, sealingTubes: 3,
      resonanceExp: 800, resonanceExpMult: 1,
    },
  },

  {
    id: "boss_nullfire", name: "Nullfire's Trial", emoji: "⚡",
    type: "ECHO", color: 0x7C4DFF,
    description: "WL3+ · Face the Nullfire Construct. Win to claim its 4-cost Boss Echo. (2 ◈ Aura)",
    flavor: "It was built to end wars. The wars ended. It did not.",
    levelReq: 45, worldLevelReq: 3, auraCost: 2,
    waves: [
      wave("Static Spark",  2.5, 2.2, 2.0),
      wave("Thunder Drake", 2.8, 2.5, 2.2),
      wave("Static Spark",  4.0, 3.5, 3.0),
    ],
    rewards: {
      echoElement: "ELECTRO", echoWeights: [0, 55, 45],
      credits: 1600, paradoxCores: 3, sealingTubes: 4,
      resonanceExp: 1100, resonanceExpMult: 1,
    },
  },

  {
    id: "boss_galeborne", name: "Galeborne's Trial", emoji: "🌪️",
    type: "ECHO", color: 0x80CBC4,
    description: "WL6+ · Face the Galeborne Phantom. Win to claim its 4-cost Aero Echo. (2 ◈ Aura)",
    flavor: "You cannot outrun the wind. You cannot outthink it either.",
    levelReq: 70, worldLevelReq: 6, auraCost: 2,
    waves: [
      wave("Zephyr Mite",     4.0, 3.5, 3.2),
      wave("Storm Harbinger", 4.5, 4.0, 3.8),
      wave("Zephyr Mite",     6.5, 6.0, 5.5),
    ],
    rewards: {
      echoElement: "AERO", echoWeights: [0, 55, 45],
      credits: 2200, paradoxCores: 4, sealingTubes: 5,
      resonanceExp: 1600, resonanceExpMult: 1,
    },
  },

  {
    id: "boss_sable", name: "Sable Harbinger's Trial", emoji: "🌑",
    type: "ECHO", color: 0xEC4899,
    description: "WL4+ · Face the Sable Harbinger. Win to claim its 4-cost Boss Echo. (2 ◈ Aura)",
    flavor: "The dark it carries is not empty. Something lives in it.",
    levelReq: 55, worldLevelReq: 4, auraCost: 2,
    waves: [
      wave("Shadow Flicker", 3.0, 2.8, 2.5),
      wave("Void Stalker",   3.5, 3.2, 2.8),
      wave("Shadow Flicker", 5.0, 4.5, 4.0),
    ],
    rewards: {
      echoElement: "HAVOC", echoWeights: [0, 50, 50],
      credits: 2200, paradoxCores: 4, sealingTubes: 5,
      resonanceExp: 1600, resonanceExpMult: 1,
    },
  },

  {
    id: "boss_auric", name: "Auric Colossus' Trial", emoji: "✨",
    type: "ECHO", color: 0xFFD54F,
    description: "WL5+ · Face the Auric Colossus. Win to claim its 4-cost Boss Echo. (2 ◈ Aura)",
    flavor: "It has stood since the Resonant Age. It will stand after you.",
    levelReq: 65, worldLevelReq: 5, auraCost: 2,
    waves: [
      wave("Lumen Speck",    3.5, 3.2, 3.0),
      wave("Radiant Keeper", 4.0, 3.8, 3.5),
      wave("Lumen Speck",    6.0, 5.5, 5.0),
    ],
    rewards: {
      echoElement: "SPECTRO", echoWeights: [0, 40, 60],
      credits: 3000, paradoxCores: 5, sealingTubes: 6,
      resonanceExp: 2200, resonanceExpMult: 1,
    },
  },

  {
    id: "boss_absolute", name: "Trial of the Absolute", emoji: "✦",
    type: "ECHO", color: 0xEAB308,
    description: "WL7+ · Face the Resonant Absolute. Final trial. (2 ◈ Aura)",
    flavor: "There is nothing beyond this. You always knew there would be a last door.",
    levelReq: 80, worldLevelReq: 7, auraCost: 2,
    waves: [
      wave("Lumen Speck",    5.0, 4.5, 4.0),
      wave("Radiant Keeper", 6.0, 5.5, 5.0),
      wave("Lumen Speck",    9.0, 8.5, 8.0),
    ],
    rewards: {
      echoElement: "SPECTRO", echoWeights: [0, 30, 70],
      credits: 5000, paradoxCores: 8, sealingTubes: 8,
      resonanceExp: 3500, resonanceExpMult: 1,
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getDungeon(id: string): DungeonDefinition | null {
  return DUNGEONS.find(d => d.id === id) ?? null;
}

export function getScaledWaveEnemy(
  dungeon: DungeonDefinition,
  waveIdx: number,
  worldLevel: number,
): { def: EchoDefinition; hp: number; atk: number; def_: number } {
  const waveDef = dungeon.waves[waveIdx];
  const base    = getEnemy(waveDef.enemyName);
  const wlScale = 1 + worldLevel * 0.15;

  return {
    def:  base,
    hp:   Math.floor(base.hp  * waveDef.hpMult  * wlScale),
    atk:  Math.floor(base.atk * waveDef.atkMult * wlScale),
    def_: Math.floor(base.def * waveDef.defMult * wlScale),
  };
}

export const ELEMENT_COLORS: Record<string, number> = {
  NONE: 0x6366F1, FUSION: 0xFF6B35, GLACIO: 0x4FC3F7,
  ELECTRO: 0xB39DDB, AERO: 0x80CBC4, HAVOC: 0x9C27B0, SPECTRO: 0xFFD54F,
};
