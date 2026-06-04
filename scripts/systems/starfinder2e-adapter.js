/**
 * Starfinder 2e Loot System Adapter
 *
 * Starfinder 2e is rules-compatible with Pathfinder 2e and shares its item data
 * model, so this adapter mirrors the PF2e adapter's level-based generation,
 * filtering, and mystification.  The differences are currency and packs:
 *
 *   - Currency is **Credits** (the standard currency).  A configurable share of
 *     the treasure budget is paid out as **UPBs** (Universal Polymer Base), a
 *     building resource that doubles as currency (1 UPB ≈ 1 credit in value).
 *   - Compendium packs are auto-resolved from whatever Item compendiums the
 *     active Starfinder 2e system ships (the exact pack IDs vary), overridable
 *     via Module Settings → Compendium Sources.
 *
 * Shared PF2e-compatible field paths:
 *   rarity:            system.traits.rarity
 *   item level:        system.level.value
 *   identification:    system.identification.status
 *   unidentified name: system.identification.unidentified.name
 *   consumable subtype: system.consumableType.value
 */

import { LootRoller } from "../api.js";

const MODULE_ID = "scorpious187s-loot-roller";

// ── System detection ───────────────────────────────────────────────────────────
// SF2e is "its own system", but the exact id slug varies by distribution.  Match
// the known candidates plus a Starfinder-2e title check, while explicitly
// excluding Starfinder 1e ("sfrpg"), which has a completely different data model.
const SF2E_SYSTEM_IDS = new Set([
  "sf2e", "starfinder2e", "starfinder-2e", "starfinder2", "starfinderv2",
]);

/** True when the active world is running a Starfinder 2e system (not SF1e). */
export function isStarfinder2eSystem() {
  if (typeof game === "undefined" || !game.system) return false;
  const id = game.system.id ?? "";
  if (id === "sfrpg") return false;               // Starfinder 1e — different model
  if (SF2E_SYSTEM_IDS.has(id)) return true;
  const title = game.system.title ?? "";
  return /starfinder/i.test(title) && /(2e|second|v2|two)/i.test(title);
}

// ── Item type sets (PF2e-compatible) ────────────────────────────────────────────
const SF2E_LOOT_TYPES  = new Set(["weapon", "armor", "shield", "equipment", "consumable", "treasure"]);
const PERMANENT_TYPES  = ["weapon", "armor", "shield", "equipment"];
const CONSUMABLE_TYPES = ["consumable"];

// ── SF2e-specific index / pool cache ────────────────────────────────────────────
const _sf2eIndexCache = new Map(); // packId → Collection
const _sf2ePoolCache  = new Map(); // sorted-packIds key → array

/** Fetch (and cache) an SF2e index for one pack (PF2e-compatible fields). */
async function _getSf2eIndex(packId) {
  if (_sf2eIndexCache.has(packId)) return _sf2eIndexCache.get(packId);
  const pack = game.packs.get(packId);
  if (!pack) return null;
  const index = await pack.getIndex({
    fields: [
      "name", "type", "img",
      "system.level",
      "system.traits.rarity",
      "system.consumableType",
      "system.price",
    ],
  }).catch((err) => {
    console.warn(`LootRoller | SF2e getIndex failed for "${packId}":`, err);
    return null;
  });
  if (index) _sf2eIndexCache.set(packId, index);
  return index;
}

/** Build (and cache) a flat array of loot-eligible SF2e items from multiple packs. */
async function _buildSf2ePool(packIds) {
  const key = [...packIds].sort().join(",");
  if (_sf2ePoolCache.has(key)) return _sf2ePoolCache.get(key);

  const pool = [];
  for (const packId of packIds) {
    const index = await _getSf2eIndex(packId);
    if (!index) continue;
    for (const entry of index) {
      if (!SF2E_LOOT_TYPES.has(entry.type)) continue;

      const rarityRaw =
        entry.system?.traits?.rarity ??
        entry["system.traits.rarity"] ??
        entry.system?.rarity ??
        "common";
      const rarity = String(rarityRaw).toLowerCase();

      const levelObj = entry.system?.level ?? entry["system.level"];
      const level    = levelObj?.value ?? (typeof levelObj === "number" ? levelObj : 0);

      const ctObj          = entry.system?.consumableType ?? entry["system.consumableType"];
      const consumableType = (ctObj?.value ?? "").toLowerCase();

      pool.push({ packId, id: entry._id, name: entry.name, type: entry.type, rarity, level, consumableType, img: entry.img });
    }
  }

  _sf2ePoolCache.set(key, pool);
  console.log(`LootRoller | SF2e pool ready: ${pool.length} items across ${packIds.length} pack(s)`);
  return pool;
}

/** Clear all SF2e-specific caches (call when compendium selection changes). */
function _clearSf2eCache() {
  _sf2eIndexCache.clear();
  _sf2ePoolCache.clear();
}

/** Filter the pool by item type category, level tolerance, and rarity flags. */
function _filterPool(pool, { allowedTypes, targetLevel, tolerance, includeUncommon, includeRare }) {
  return pool.filter((e) => {
    if (!allowedTypes.includes(e.type))              return false;
    if (Math.abs(e.level - targetLevel) > tolerance) return false;
    if (e.rarity === "unique")                       return false;
    if (e.rarity === "rare"     && !includeRare)     return false;
    if (e.rarity === "uncommon" && !includeUncommon) return false;
    return true;
  });
}

/** Generic display label for a mystified SF2e item based on its type. */
function _sf2eUnidentifiedLabel(data) {
  const consumableType = data.system?.consumableType?.value ?? "";
  switch (data.type) {
    case "weapon":     return "Unidentified Weapon";
    case "armor":      return "Unidentified Armor";
    case "shield":     return "Unidentified Shield";
    case "consumable":
      if (consumableType === "scroll") return "Unidentified Scroll";
      if (consumableType === "potion") return "Unidentified Serum";
      if (consumableType === "elixir") return "Unidentified Elixir";
      return "Unidentified Consumable";
    default:
      return "Unidentified Item";
  }
}

/**
 * Resolve the default SF2e pack IDs: every Item compendium shipped by the active
 * Starfinder 2e system.  Pack IDs vary by distribution, so we match by package.
 */
function _resolveDefaultSf2ePacks() {
  if (typeof game === "undefined" || !game.packs) return [];
  const sysId = game.system?.id ?? "";
  return game.packs
    .filter((p) => p.documentName === "Item" &&
      (p.metadata?.packageName === sysId || (p.collection ?? "").startsWith(`${sysId}.`)))
    .map((p) => p.collection);
}

// ── Treasure by Level (4-player base; values mirror the PF2e GM Core table,
//    interpreted as credits since SF2e is rules-compatible). ───────────────────
const TREASURE_BY_LEVEL = {
  1:  { total: 175,    permanent: [[2,2],[2,1]],       consumables: [[2,2],[2,1],[3,1]],        currency: 40,    perPC: 10 },
  2:  { total: 300,    permanent: [[2,3],[2,2]],       consumables: [[2,3],[2,2],[2,1]],        currency: 70,    perPC: 18 },
  3:  { total: 500,    permanent: [[2,4],[2,3]],       consumables: [[2,4],[2,3],[2,2]],        currency: 120,   perPC: 30 },
  4:  { total: 850,    permanent: [[2,5],[2,4]],       consumables: [[2,5],[2,4],[2,3]],        currency: 200,   perPC: 50 },
  5:  { total: 1350,   permanent: [[2,6],[2,5]],       consumables: [[2,6],[2,5],[2,4]],        currency: 320,   perPC: 80 },
  6:  { total: 2000,   permanent: [[2,7],[2,6]],       consumables: [[2,7],[2,6],[2,5]],        currency: 500,   perPC: 125 },
  7:  { total: 2900,   permanent: [[2,8],[2,7]],       consumables: [[2,8],[2,7],[2,6]],        currency: 720,   perPC: 180 },
  8:  { total: 4000,   permanent: [[2,9],[2,8]],       consumables: [[2,9],[2,8],[2,7]],        currency: 1000,  perPC: 250 },
  9:  { total: 5700,   permanent: [[2,10],[2,9]],      consumables: [[2,10],[2,9],[2,8]],       currency: 1400,  perPC: 350 },
  10: { total: 8000,   permanent: [[2,11],[2,10]],     consumables: [[2,11],[2,10],[2,9]],      currency: 2000,  perPC: 500 },
  11: { total: 11500,  permanent: [[2,12],[2,11]],     consumables: [[2,12],[2,11],[2,10]],     currency: 2800,  perPC: 700 },
  12: { total: 16500,  permanent: [[2,13],[2,12]],     consumables: [[2,13],[2,12],[2,11]],     currency: 4000,  perPC: 1000 },
  13: { total: 23000,  permanent: [[2,14],[2,13]],     consumables: [[2,14],[2,13],[2,12]],     currency: 5600,  perPC: 1400 },
  14: { total: 33000,  permanent: [[2,15],[2,14]],     consumables: [[2,15],[2,14],[2,13]],     currency: 8000,  perPC: 2000 },
  15: { total: 46000,  permanent: [[2,16],[2,15]],     consumables: [[2,16],[2,15],[2,14]],     currency: 11200, perPC: 2800 },
  16: { total: 67000,  permanent: [[2,17],[2,16]],     consumables: [[2,17],[2,16],[2,15]],     currency: 16000, perPC: 4000 },
  17: { total: 95000,  permanent: [[2,18],[2,17]],     consumables: [[2,18],[2,17],[2,16]],     currency: 24000, perPC: 6000 },
  18: { total: 135000, permanent: [[2,19],[2,18]],     consumables: [[2,19],[2,18],[2,17]],     currency: 32000, perPC: 8000 },
  19: { total: 200000, permanent: [[2,20],[2,19]],     consumables: [[2,20],[2,19],[2,18]],     currency: 48000, perPC: 12000 },
  20: { total: 490000, permanent: [[4,20]],            consumables: [[4,20],[2,19]],            currency: 140000,perPC: 35000 },
};

// Share of the currency budget paid out as UPBs instead of credits.
const UPB_YIELD_FACTOR = { none: 0, low: 0.1, standard: 0.25, high: 0.5 };

// ── Adapter ───────────────────────────────────────────────────────────────────

export class Starfinder2eAdapter {
  static systemId   = "sf2e";
  static systemName = "Starfinder 2nd Edition";

  static getGeneratorFields() {
    const range = (from, to) => {
      const opts = [];
      for (let i = from; i <= to; i++) opts.push({ value: i, label: String(i) });
      return opts;
    };
    return [
      {
        name: "partyLevel",
        label: "LOOTROLLER.sf2e.field.partyLevel",
        type: "select",
        default: 1,
        options: range(1, 20),
      },
      {
        name: "partySize",
        label: "LOOTROLLER.sf2e.field.partySize",
        type: "select",
        default: 4,
        options: range(1, 8),
        hint: "LOOTROLLER.sf2e.field.partySizeHint",
      },
      {
        name: "lootScope",
        label: "LOOTROLLER.sf2e.field.lootScope",
        type: "select",
        options: [
          { value: "full",      label: "LOOTROLLER.sf2e.lootScope.full" },
          { value: "encounter", label: "LOOTROLLER.sf2e.lootScope.encounter" },
          { value: "custom",    label: "LOOTROLLER.sf2e.lootScope.custom" },
        ],
        default: "full",
      },
      {
        name: "customBudget",
        label: "LOOTROLLER.sf2e.field.customBudget",
        type: "number",
        default: 0,
        hint: "LOOTROLLER.sf2e.field.customBudgetHint",
        showWhen: { field: "lootScope", value: "custom" },
      },
      {
        name: "upbYield",
        label: "LOOTROLLER.sf2e.field.upbYield",
        type: "select",
        options: [
          { value: "none",     label: "LOOTROLLER.sf2e.upbYield.none" },
          { value: "low",      label: "LOOTROLLER.sf2e.upbYield.low" },
          { value: "standard", label: "LOOTROLLER.sf2e.upbYield.standard" },
          { value: "high",     label: "LOOTROLLER.sf2e.upbYield.high" },
        ],
        default: "standard",
        hint: "LOOTROLLER.sf2e.field.upbYieldHint",
      },
      {
        name: "includeUncommon",
        label: "LOOTROLLER.sf2e.field.includeUncommon",
        type: "checkbox",
        default: true,
      },
      {
        name: "includeRare",
        label: "LOOTROLLER.sf2e.field.includeRare",
        type: "checkbox",
        default: false,
      },
    ];
  }

  static async generateLoot(params) {
    const partyLevel      = Math.min(20, Math.max(1, parseInt(params.partyLevel) || 1));
    const partySize       = Math.max(1, parseInt(params.partySize) || 4);
    const includeUncommon = !!params.includeUncommon;
    const includeRare     = !!params.includeRare;

    const row = TREASURE_BY_LEVEL[partyLevel];
    if (!row) return { coins: {}, items: [] };

    const sizeAdjust = (partySize - 4) * row.perPC;

    let budget;
    if (params.lootScope === "custom") {
      budget = Math.max(0, parseInt(params.customBudget) || 0);
    } else if (params.lootScope === "encounter") {
      budget = Math.round((row.total + sizeAdjust) / 10);
    } else {
      budget = row.total + sizeAdjust;
    }

    const itemRefs = [];

    for (const [count, level] of (row.permanent ?? [])) {
      for (let i = 0; i < count; i++) {
        itemRefs.push({ name: null, type: null, rarity: "common", level, _sf2eType: "permanent", includeUncommon, includeRare });
      }
    }

    for (const [count, level] of (row.consumables ?? [])) {
      for (let i = 0; i < count; i++) {
        itemRefs.push({ name: null, type: "consumable", rarity: "common", level, _sf2eType: "consumable", includeUncommon, includeRare });
      }
    }

    // Split the currency budget between credits and UPBs (1 UPB ≈ 1 credit).
    const currencyValue = Math.floor(Math.min(budget, row.currency + Math.max(0, sizeAdjust)));
    const upbFactor     = UPB_YIELD_FACTOR[params.upbYield] ?? UPB_YIELD_FACTOR.standard;
    const upb           = Math.floor(currencyValue * upbFactor);
    const credits       = Math.max(0, currencyValue - upb);

    // Keys match the SF2e inventory.coins schema ({ credits, upb }).
    const coins = {};
    if (credits) coins.credits = credits;
    if (upb)     coins.upb     = upb;

    return { coins, items: itemRefs };
  }

  static async resolveItems(itemRefs) {
    const resolved = [];
    const packs    = Starfinder2eAdapter.getActivePacks();
    const pool     = await _buildSf2ePool(packs);

    let includeUncommon = false;
    let includeRare     = false;
    try { includeUncommon = game.settings.get(MODULE_ID, "sf2e.includeUncommon"); } catch {}
    try { includeRare     = game.settings.get(MODULE_ID, "sf2e.includeRare");     } catch {}

    for (const ref of itemRefs) {
      const isPermanent  = ref._sf2eType === "permanent";
      const targetLevel  = ref.level ?? 1;
      const allowedTypes = isPermanent ? PERMANENT_TYPES : CONSUMABLE_TYPES;

      const wantUncommon = ref.includeUncommon ?? includeUncommon;
      const wantRare     = ref.includeRare     ?? includeRare;

      let candidates = _filterPool(pool, { allowedTypes, targetLevel, tolerance: 1, includeUncommon: wantUncommon, includeRare: wantRare });
      if (!candidates.length) {
        candidates = _filterPool(pool, { allowedTypes, targetLevel, tolerance: 2, includeUncommon: true, includeRare: wantRare });
      }

      if (!candidates.length) {
        resolved.push({
          name:  `${isPermanent ? "Item" : "Consumable"} (Level ${targetLevel})`,
          type:  isPermanent ? "equipment" : "consumable",
          level: targetLevel,
          stub:  true,
        });
        continue;
      }

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const doc  = await game.packs.get(pick.packId)?.getDocument(pick.id).catch(() => null);

      if (doc) {
        if (pick.rarity === "rare" || pick.rarity === "unique") {
          const data = doc.toObject();
          data._sourceUuid = doc.uuid;
          Starfinder2eAdapter.applyMystification(data);
          resolved.push(data);
        } else {
          resolved.push(doc);
        }
      } else {
        resolved.push({
          name:  `${isPermanent ? "Item" : "Consumable"} (Level ${targetLevel})`,
          type:  pick.type,
          level: targetLevel,
          stub:  true,
        });
      }
    }

    return resolved;
  }

  static getCompendiumPacks() {
    return _resolveDefaultSf2ePacks();
  }

  static getSettings() {
    return [
      {
        key: "sf2e.includeUncommon",
        name: "LOOTROLLER.settings.sf2e.includeUncommon.name",
        hint: "LOOTROLLER.settings.sf2e.includeUncommon.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
      },
      {
        key: "sf2e.includeRare",
        name: "LOOTROLLER.settings.sf2e.includeRare.name",
        hint: "LOOTROLLER.settings.sf2e.includeRare.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
      },
    ];
  }

  /**
   * Filter field descriptors for the Quest and Shop generators (PF2e-style):
   *   - quest: a Party Level dropdown (1–20).
   *   - shop:  a Low/High item-level range (0–30).
   */
  static getFilterFields({ mode = "quest", partyLevel = 5, levelRange } = {}) {
    if (mode === "shop") {
      const minL = 0, maxL = 30;
      let [low, high] = Array.isArray(levelRange)
        ? levelRange
        : Starfinder2eAdapter.partyLevelToItemRange(partyLevel);
      low  = Math.max(minL, Math.min(maxL, low));
      high = Math.max(low,  Math.min(maxL, high));
      return [{
        type:  "level-range",
        key:   "levelRange",
        label: "LOOTROLLER.shop.levelRange",
        min:   minL,
        max:   maxL,
        low,
        high,
      }];
    }

    const options = [];
    for (let i = 1; i <= 20; i++) {
      options.push({ value: i, label: String(i), selected: i === partyLevel });
    }
    return [{
      type:  "select",
      key:   "partyLevel",
      label: "LOOTROLLER.sf2e.field.partyLevel",
      options,
    }];
  }

  static getItemTypes() {
    return [
      { value: "weapon",     label: "LOOTROLLER.itemType.weapon" },
      { value: "armor",      label: "LOOTROLLER.itemType.armor" },
      { value: "shield",     label: "LOOTROLLER.itemType.shield" },
      { value: "equipment",  label: "LOOTROLLER.itemType.equipment" },
      { value: "consumable", label: "LOOTROLLER.itemType.consumable" },
      { value: "treasure",   label: "LOOTROLLER.itemType.treasure" },
    ];
  }

  static getRarities() {
    return [
      { value: "common",   label: "LOOTROLLER.rarity.common" },
      { value: "uncommon", label: "LOOTROLLER.rarity.uncommon" },
      { value: "rare",     label: "LOOTROLLER.rarity.rare" },
      { value: "unique",   label: "LOOTROLLER.rarity.unique" },
    ];
  }

  /** Return the pack IDs to search, respecting the user's compendium selection. */
  static getActivePacks() {
    try {
      const setting = game.settings.get("scorpious187s-loot-roller", "compendiumPacks");
      if (setting && Object.keys(setting).length) {
        const enabled = Object.entries(setting)
          .filter(([, on]) => on)
          .map(([id]) => id)
          .filter((id) => game.packs.has(id));
        if (enabled.length) return enabled;
      }
    } catch {}
    return _resolveDefaultSf2ePacks();
  }

  /** Pre-warm the SF2e pool (clears old cache first). */
  static async warmPool() {
    _clearSf2eCache();
    return _buildSf2ePool(Starfinder2eAdapter.getActivePacks());
  }

  static getItemLevelRange() {
    return { mode: "partyLevel", min: 1, max: 20, default: 5 };
  }

  /** Convert a party level to the item-level window (partyLevel-1 .. partyLevel+2). */
  static partyLevelToItemRange(partyLevel) {
    return [Math.max(1, partyLevel - 1), Math.min(25, partyLevel + 2)];
  }

  /**
   * Find compendium items matching the given filters (PF2e-compatible pool).
   *
   * @param {{
   *   rarities?:     string[],
   *   types?:        string[],
   *   limit?:        number,
   *   excludeNames?: Set<string>,
   *   partyLevel?:   number,
   *   levelRange?:   [number, number]
   * }} params
   */
  static async findItems({ rarities, types, limit = 1, excludeNames, partyLevel, levelRange } = {}) {
    const packs = Starfinder2eAdapter.getActivePacks();
    const pool  = await _buildSf2ePool(packs);

    const rarityNorms = rarities?.map((r) => r.toLowerCase().replace(/\s+/g, ""));
    const excluded    = excludeNames instanceof Set ? excludeNames : new Set(excludeNames ?? []);

    let candidates = pool;
    if (excluded.size) candidates = candidates.filter((e) => !excluded.has(e.name));
    if (types?.length) candidates = candidates.filter((e) => types.includes(e.type));

    if (Array.isArray(levelRange)) {
      const [minL, maxL] = levelRange;
      candidates = candidates.filter((e) => e.level >= minL && e.level <= maxL);
    } else if (partyLevel !== undefined) {
      const [minL, maxL] = Starfinder2eAdapter.partyLevelToItemRange(partyLevel);
      candidates = candidates.filter((e) => e.level >= minL && e.level <= maxL);
    } else if (rarityNorms?.length) {
      candidates = candidates.filter((e) => rarityNorms.includes(e.rarity));
    }

    if (!candidates.length) return [];
    const picks = candidates.sort(() => Math.random() - 0.5).slice(0, limit);
    const docs  = await Promise.all(picks.map(({ packId, id }) => game.packs.get(packId).getDocument(id)));
    return docs.filter(Boolean);
  }

  /** Clear the SF2e pool cache — called by CompendiumSettingsApp when packs change. */
  static clearPool() {
    _clearSf2eCache();
  }

  // ── Identification helpers (PF2e-compatible: system.identification.status) ────

  static applyMystification(data) {
    if (!data.system?.identification) return;
    data.system.identification.status = "unidentified";
    data.system.identification.unidentified ??= {};
    if (!data.system.identification.unidentified.name) {
      data.system.identification.unidentified.name = _sf2eUnidentifiedLabel(data);
    }
  }

  static clearMystification(data) {
    if (!data.system?.identification) return;
    data.system.identification.status = "identified";
  }

  static isMystified(data) {
    return data.system?.identification?.status === "unidentified";
  }

  static getDisplayName(item) {
    if (item.system?.identification?.status === "unidentified") {
      return item.system.identification.unidentified?.name
        || game.i18n.localize("LOOTROLLER.lottery.unidentifiedItem");
    }
    return item.name;
  }

  static getDisplayDescription(item) {
    if (item.system?.identification?.status === "unidentified") {
      return item.system.identification.unidentified?.description ?? "";
    }
    return item.system?.description?.value ?? "";
  }
}

Hooks.once("init", () => {
  if (isStarfinder2eSystem()) {
    // Register under the world's actual system id (the SF2e slug varies by
    // distribution) so LootRoller.getAdapter() — which keys off game.system.id —
    // resolves this adapter regardless of the exact id.
    Starfinder2eAdapter.systemId = game.system.id;
    LootRoller.registerSystem(Starfinder2eAdapter);
  }
});
