export type ShardDbField =
  | "starfallShards"
  | "umbralShards"
  | "voltaicShards"
  | "glacialShards"
  | "tempestShards"
  | "emberShards";

export type CharacterShardInfo = {
  field: ShardDbField;
  dbField: ShardDbField;
  label: string;
};

export const ASCENSION_SHARD_CURRENCY: Record<string, CharacterShardInfo> = {
  solace:  { field: "starfallShards", dbField: "starfallShards", label: "Starfall Shards" },
  kaelith: { field: "umbralShards",   dbField: "umbralShards",   label: "Umbral Shards"   },
  vesper:  { field: "voltaicShards",  dbField: "voltaicShards",  label: "Voltaic Shards"  },
  rilo:    { field: "glacialShards",  dbField: "glacialShards",  label: "Glacial Shards"  },
  rhoven:  { field: "tempestShards",  dbField: "tempestShards",  label: "Tempest Shards"  },
  bren:    { field: "emberShards",    dbField: "emberShards",    label: "Ember Shards"    },
  feyra:   { field: "glacialShards",  dbField: "glacialShards",  label: "Glacial Shards"  },
};

export function shardInfo(characterId: string): CharacterShardInfo {
  return ASCENSION_SHARD_CURRENCY[characterId] ?? ASCENSION_SHARD_CURRENCY.solace;
}

export const CHARACTER_SHARD_DB_FIELDS: ShardDbField[] = [
  "starfallShards",
  "umbralShards",
  "voltaicShards",
  "glacialShards",
  "tempestShards",
  "emberShards",
];

export const CHARACTER_SHARD_SELECT = {
  starfallShards: true,
  umbralShards: true,
  voltaicShards: true,
  glacialShards: true,
  tempestShards: true,
  emberShards: true,
} as const;

export const CHARACTER_SHARD_INVENTORY_ENTRIES = [
  { key: "starfallShards", file: "Starfall Shard.png", label: "Starfall Shards", color: "#EAB308", desc: "Solace ascension" },
  { key: "umbralShards",   file: "Umbral Shard.png",   label: "Umbral Shards",   color: "#7C3AED", desc: "Kaelith ascension" },
  { key: "voltaicShards",  file: "Voltaic Shard.png",  label: "Voltaic Shards",  color: "#A855F7", desc: "Vesper ascension" },
  { key: "glacialShards",  file: "Glacial Shard.png",  label: "Glacial Shards",  color: "#38BDF8", desc: "Rilo/Feyra ascension" },
  { key: "tempestShards",  file: "Tempest Shard.png",  label: "Tempest Shards",  color: "#10B981", desc: "Rhoven ascension" },
  { key: "emberShards",    file: "Ember Shard.png",    label: "Ember Shards",    color: "#F97316", desc: "Bren ascension" },
] as const;

export const CHARACTER_SHARD_INVENTORY_KEYS = CHARACTER_SHARD_INVENTORY_ENTRIES.map(entry => entry.key);
