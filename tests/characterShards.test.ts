import assert from "node:assert/strict";
import test from "node:test";

import {
  CHARACTER_SHARD_DB_FIELDS,
  CHARACTER_SHARD_INVENTORY_KEYS,
  shardInfo,
} from "../src/lib/characterShardCurrency";

test("Rhoven and Bren use their own shard currencies for ascension", () => {
  assert.deepEqual(shardInfo("rhoven"), {
    field: "tempestShards",
    dbField: "tempestShards",
    label: "Tempest Shards",
  });
  assert.deepEqual(shardInfo("bren"), {
    field: "emberShards",
    dbField: "emberShards",
    label: "Ember Shards",
  });
});

test("all character shard currencies are available to reads and inventory", () => {
  assert.deepEqual(CHARACTER_SHARD_DB_FIELDS, [
    "starfallShards",
    "umbralShards",
    "voltaicShards",
    "glacialShards",
    "tempestShards",
    "emberShards",
  ]);
  assert.deepEqual(CHARACTER_SHARD_INVENTORY_KEYS, CHARACTER_SHARD_DB_FIELDS);
});
