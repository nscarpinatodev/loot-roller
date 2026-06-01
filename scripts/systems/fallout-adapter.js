/**
 * Fallout 2d20 Loot System Adapter
 *
 * Generates location-based loot: caps (bottle-cap currency), weapons, apparel,
 * ammo, consumables (stimpaks, chems, food), and junk.
 *
 * The `fallout` system's item types and rarity values are *auto-detected* from
 * the loaded compendiums rather than hard-coded, so the adapter adapts to
 * whatever the system actually ships (e.g. numeric rarity, "miscellany" vs
 * "junk").  CompendiumHelper.buildPool reads dnd5e field paths and throws on
 * Fallout's numeric `system.rarity`, so we maintain our own pool reader.
 *
 * Filtering in the Quest/Shop generators is by item type only — Fallout has no
 * level axis and a flatter loot model, so getFilterFields() returns [].
 */

import { LootRoller } from "../api.js";

const MODULE_ID = "loot-roller";

/** Return a random integer between min and max inclusive. */
function _randInt(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Title-case an item-type key for display: "books_and_magz" → "Books And Magz". */
function _prettify(key) {
  return String(key)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ── Item-type taxonomy ─────────────────────────────────────────────────────────
// Types we never treat as physical loot (character-build / world types).
const FALLOUT_NON_LOOT = new Set([
  "skill", "perk", "trait", "addiction", "disease",
  "special_ability", "origin", "object_or_structure",
]);

// Friendly labels for known Fallout item types; anything else is prettified.
const FALLOUT_TYPE_LABELS = {
  weapon:         "Weapons",
  weapon_mod:     "Weapon Mods",
  apparel:        "Apparel",
  apparel_mod:    "Apparel Mods",
  ammo:           "Ammo",
  consumable:     "Consumables",
  miscellany:     "Junk",
  books_and_magz: "Books & Magazines",
  robot_mod:      "Robot Mods",
  robot_armor:    "Robot Armor",
};

// Preferred display order for discovered types; unknown types sort after, A–Z.
const FALLOUT_TYPE_ORDER = ["weapon", "apparel", "ammo", "consumable", "miscellany", "books_and_magz"];

// Sensible defaults shown before the pool has warmed.
const FALLOUT_DEFAULT_TYPES = ["weapon", "apparel", "ammo", "consumable", "miscellany"];

// Maps the location-table loot categories to the system's actual type keys.
// The first candidate type that exists in the pool is used.
const FALLOUT_CATEGORY_TYPES = {
  weapon:     ["weapon"],
  apparel:    ["apparel"],
  ammo:       ["ammo"],
  consumable: ["consumable"],
  junk:       ["miscellany", "junk"],
};

// Numeric rarity scale (0-based) → label, for systems that store rarity as a number.
const FALLOUT_RARITY_LABELS = ["common", "uncommon", "rare", "epic", "legendary"];

/** Normalize a raw rarity value (number or string) to a lowercase label. */
function _normalizeFalloutRarity(raw) {
  if (raw === null || raw === undefined || raw === "") return "common";
  if (typeof raw === "number") return FALLOUT_RARITY_LABELS[raw] ?? `rarity-${raw}`;
  return String(raw).toLowerCase().replace(/\s+/g, "");
}

// ── Loot tables by location type ──────────────────────────────────────────────
// Each entry: { caps: [min, max], items: { type: [min, max] } }
// Counts are scaled by threat multiplier (low=0.75, medium=1.0, high=1.5).

const LOCATION_TABLES = {
  wastes: {
    caps:  [5, 30],
    items: { consumable: [1, 4], weapon: [0, 2], ammo: [1, 3], junk: [2, 5], apparel: [0, 1] },
  },
  raiderCamp: {
    caps:  [10, 60],
    items: { consumable: [1, 3], weapon: [1, 3], ammo: [2, 4], junk: [1, 3], apparel: [0, 2] },
  },
  militaryBase: {
    caps:  [20, 80],
    items: { consumable: [2, 5], weapon: [2, 4], ammo: [3, 6], junk: [1, 4], apparel: [1, 2] },
  },
  preWarVault: {
    caps:  [50, 200],
    items: { consumable: [2, 6], weapon: [1, 3], ammo: [2, 5], junk: [3, 8], apparel: [1, 3] },
  },
  settlement: {
    caps:  [15, 50],
    items: { consumable: [2, 5], weapon: [1, 2], ammo: [1, 3], junk: [1, 4], apparel: [0, 2] },
  },
  ghoulNest: {
    caps:  [5, 25],
    items: { consumable: [1, 3], weapon: [0, 2], ammo: [1, 2], junk: [2, 6], apparel: [1, 3] },
  },
};

const THREAT_MULTIPLIER = { low: 0.75, medium: 1.0, high: 1.5 };

// Default compendiums for the Fallout 2d20 system, matched by title (the exact
// pack IDs vary by system version, so we resolve them at runtime).  The user can
// override the selection in Module Settings → Compendium Sources.
const FALLOUT_DEFAULT_PACK_LABELS = [
  "Ammunition",
  "Apparel",
  "Armor & Clothing Mods",
  "Books & Magazines",
  "Consumables",
  "Miscellany",
  "Weapon Mods",
  "Weapons",
];

/** Normalize a label/title for comparison ("&" → "and", collapse whitespace). */
function _normLabel(s) {
  return String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim();
}

/**
 * Resolve the default Fallout pack IDs by matching loaded Item compendiums
 * against FALLOUT_DEFAULT_PACK_LABELS.  Falls back to every Item compendium
 * shipped by the `fallout` system if no titles match.
 */
function _resolveDefaultFalloutPacks() {
  if (typeof game === "undefined" || !game.packs) return [];
  const wanted = new Set(FALLOUT_DEFAULT_PACK_LABELS.map(_normLabel));

  let ids = game.packs
    .filter((p) => p.documentName === "Item" && wanted.has(_normLabel(p.title)))
    .map((p) => p.collection);

  if (!ids.length) {
    ids = game.packs
      .filter((p) => p.documentName === "Item" &&
        (p.metadata?.packageName === "fallout" || p.collection?.startsWith("fallout.")))
      .map((p) => p.collection);
  }

  return ids;
}

// ── Fallout-specific index / pool cache ────────────────────────────────────────
// CompendiumHelper.buildPool reads system.rarity and lower-cases it, which throws
// on Fallout's numeric rarity.  We maintain our own cache that reads/normalizes
// the correct fields and records which types & rarities actually exist.

const _falloutIndexCache = new Map();  // packId → Collection
const _falloutPoolCache  = new Map();  // sorted-packIds key → array
let   _discoveredTypes    = [];        // distinct loot types present (ordered)
let   _discoveredRarities = [];        // distinct rarity labels present

/** Fetch (and cache) a Fallout index for one pack. */
async function _getFalloutIndex(packId) {
  if (_falloutIndexCache.has(packId)) return _falloutIndexCache.get(packId);
  const pack = game.packs.get(packId);
  if (!pack) return null;
  const index = await pack.getIndex({
    fields: ["name", "type", "img", "system.rarity"],
  }).catch((err) => {
    console.warn(`LootRoller | Fallout getIndex failed for "${packId}":`, err);
    return null;
  });
  if (index) _falloutIndexCache.set(packId, index);
  return index;
}

/**
 * Build (and cache) a flat array of loot-eligible Fallout items, recording the
 * distinct item types and rarity labels discovered along the way.
 */
async function _buildFalloutPool(packIds) {
  const key = [...packIds].sort().join(",");
  if (_falloutPoolCache.has(key)) return _falloutPoolCache.get(key);

  const pool      = [];
  const typeSet   = new Set();
  const raritySet = new Set();

  for (const packId of packIds) {
    const index = await _getFalloutIndex(packId);
    if (!index) continue;
    for (const entry of index) {
      const type = entry.type ?? "";
      if (FALLOUT_NON_LOOT.has(type)) continue;

      const rarity = _normalizeFalloutRarity(entry.system?.rarity ?? entry["system.rarity"]);
      pool.push({ packId, id: entry._id, name: entry.name, type, rarity, img: entry.img });
      typeSet.add(type);
      raritySet.add(rarity);
    }
  }

  // Order discovered types: preferred ones first, then the rest alphabetically.
  _discoveredTypes = [...typeSet].sort((a, b) => {
    const ia = FALLOUT_TYPE_ORDER.indexOf(a);
    const ib = FALLOUT_TYPE_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
  _discoveredRarities = [...raritySet];

  _falloutPoolCache.set(key, pool);
  console.log(`LootRoller | Fallout pool ready: ${pool.length} items, types [${_discoveredTypes.join(", ")}]`);
  return pool;
}

/** Clear all Fallout-specific caches (call when compendium selection changes). */
function _clearFalloutCache() {
  _falloutIndexCache.clear();
  _falloutPoolCache.clear();
  _discoveredTypes = [];
  _discoveredRarities = [];
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class FalloutAdapter {
  static systemId   = "fallout";
  static systemName = "Fallout 2d20";

  static getGeneratorFields() {
    return [
      {
        name: "location",
        label: "LOOTROLLER.fallout.field.location",
        type: "select",
        options: [
          { value: "wastes",       label: "LOOTROLLER.fallout.location.wastes" },
          { value: "raiderCamp",   label: "LOOTROLLER.fallout.location.raiderCamp" },
          { value: "militaryBase", label: "LOOTROLLER.fallout.location.militaryBase" },
          { value: "preWarVault",  label: "LOOTROLLER.fallout.location.preWarVault" },
          { value: "settlement",   label: "LOOTROLLER.fallout.location.settlement" },
          { value: "ghoulNest",    label: "LOOTROLLER.fallout.location.ghoulNest" },
        ],
        default: "wastes",
      },
      {
        name: "threatLevel",
        label: "LOOTROLLER.fallout.field.threatLevel",
        type: "select",
        options: [
          { value: "low",    label: "LOOTROLLER.fallout.threat.low" },
          { value: "medium", label: "LOOTROLLER.fallout.threat.medium" },
          { value: "high",   label: "LOOTROLLER.fallout.threat.high" },
        ],
        default: "medium",
      },
    ];
  }

  static async generateLoot(params) {
    const location = params.location ?? "wastes";
    const threat   = params.threatLevel ?? "medium";
    const mult     = THREAT_MULTIPLIER[threat] ?? 1.0;

    const table = LOCATION_TABLES[location] ?? LOCATION_TABLES.wastes;

    // Caps
    const rawCaps = _randInt(...table.caps);
    const caps    = Math.max(0, Math.round(rawCaps * mult));

    // Item refs
    const itemRefs = [];
    for (const [type, [min, max]] of Object.entries(table.items)) {
      const rawCount = _randInt(min, max);
      const count    = Math.max(0, Math.round(rawCount * mult));
      for (let i = 0; i < count; i++) {
        itemRefs.push({ _fallout: true, type });
      }
    }

    return { coins: { caps }, items: itemRefs };
  }

  static async resolveItems(itemRefs) {
    const resolved = [];
    const packs    = FalloutAdapter.getActivePacks();
    const pool     = await _buildFalloutPool(packs);

    for (const ref of itemRefs) {
      if (!ref._fallout) {
        resolved.push(ref);
        continue;
      }

      // Map the loot category (e.g. "junk") to the system's real type keys.
      const candidateTypes = FALLOUT_CATEGORY_TYPES[ref.type] ?? [ref.type];
      const candidates     = pool.filter((e) => candidateTypes.includes(e.type));

      if (!candidates.length) {
        resolved.push({ name: `${_prettify(ref.type)} Item`, type: ref.type, stub: true });
        continue;
      }

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const doc  = await game.packs.get(pick.packId)?.getDocument(pick.id).catch(() => null);
      resolved.push(doc ?? { name: `${_prettify(ref.type)} Item`, type: ref.type, stub: true });
    }

    return resolved;
  }

  static getCompendiumPacks() {
    return _resolveDefaultFalloutPacks();
  }

  static getSettings() {
    return [];
  }

  /**
   * Item types for the filter UI — discovered from the loaded compendiums.
   * Falls back to a default set until the pool has warmed.
   */
  static getItemTypes() {
    const types = _discoveredTypes.length ? _discoveredTypes : FALLOUT_DEFAULT_TYPES;
    return types.map((t) => ({ value: t, label: FALLOUT_TYPE_LABELS[t] ?? _prettify(t) }));
  }

  /**
   * Rarity values discovered from the compendiums.  Fallout filters by item
   * type, not rarity (see getFilterFields), so this is informational only.
   */
  static getRarities() {
    const rarities = _discoveredRarities.length
      ? _discoveredRarities
      : ["common", "uncommon", "rare"];
    return rarities.map((r) => ({ value: r, label: _prettify(r) }));
  }

  /**
   * Fallout's Quest/Shop generators filter by item type only — no rarity or
   * level axis.  Returning an empty array suppresses the rarity-button UI;
   * the item-type buttons are rendered separately by the apps.
   */
  static getFilterFields() {
    return [];
  }

  static getActivePacks() {
    try {
      const setting = game.settings.get("loot-roller", "compendiumPacks");
      if (setting && Object.keys(setting).length) {
        const enabled = Object.entries(setting)
          .filter(([, on]) => on)
          .map(([id]) => id)
          .filter((id) => game.packs.has(id));
        if (enabled.length) return enabled;
      }
    } catch {}
    return _resolveDefaultFalloutPacks();
  }

  /** Pre-warm the Fallout pool (clears old cache first). */
  static async warmPool() {
    _clearFalloutCache();
    return _buildFalloutPool(FalloutAdapter.getActivePacks());
  }

  /**
   * Find compendium items by item type (rarity is ignored — Fallout filters by
   * type only).  Uses the Fallout-specific pool so numeric rarity is handled.
   *
   * @param {{ types?: string[], limit?: number, excludeNames?: Set<string> }} params
   */
  static async findItems({ types, limit = 1, excludeNames } = {}) {
    const packs    = FalloutAdapter.getActivePacks();
    const pool     = await _buildFalloutPool(packs);
    const excluded = excludeNames instanceof Set ? excludeNames : new Set(excludeNames ?? []);

    let candidates = pool;
    if (excluded.size) candidates = candidates.filter((e) => !excluded.has(e.name));
    if (types?.length) candidates = candidates.filter((e) => types.includes(e.type));

    if (!candidates.length) return [];
    const picks = candidates.sort(() => Math.random() - 0.5).slice(0, limit);
    const docs  = await Promise.all(picks.map(({ packId, id }) => game.packs.get(packId).getDocument(id)));
    return docs.filter(Boolean);
  }

  /** Clear the Fallout pool cache — called by CompendiumSettingsApp when packs change. */
  static clearPool() {
    _clearFalloutCache();
  }

  // ── Identification helpers ──────────────────────────────────────────────────
  // Fallout 2d20 doesn't have a formal identification mechanic; these are no-ops.

  static applyMystification(_data) {}
  static clearMystification(_data) {}
  static isMystified(_data) { return false; }
  static getDisplayName(item) { return item.name; }
  static getDisplayDescription(item) { return item.system?.description?.value ?? ""; }
}

Hooks.once("init", () => {
  if (game.system.id === "fallout") {
    LootRoller.registerSystem(FalloutAdapter);
  }
});
