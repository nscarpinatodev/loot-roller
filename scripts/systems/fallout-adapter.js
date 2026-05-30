/**
 * Fallout 2d20 Loot System Adapter
 *
 * Generates location-based loot: caps (bottle-cap currency), weapons, apparel,
 * ammo, consumables (stimpaks, chems, food), and junk.
 *
 * Items are drawn from the GM's configured compendiums.  The default pack list
 * covers the Fallout 2d20 system compendiums; adjust via Module Settings →
 * Compendium Sources.
 */

import { LootRoller } from "../api.js";
import { CompendiumHelper } from "../compendium-helper.js";

const MODULE_ID = "loot-roller";

/** Return a random integer between min and max inclusive. */
function _randInt(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
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

// Default compendium pack IDs for the Fallout 2d20 system.
// The user can override these in Module Settings → Compendium Sources.
const PACK_IDS = [
  "fallout.items",
  "fallout.weapons",
  "fallout.armor",
];

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
        itemRefs.push({ _fallout: true, type, rarity: "common" });
      }
    }

    return { coins: { caps }, items: itemRefs };
  }

  static async resolveItems(itemRefs) {
    const resolved   = [];
    const activePacks = FalloutAdapter.getActivePacks();

    for (const ref of itemRefs) {
      if (!ref._fallout) {
        resolved.push(ref);
        continue;
      }

      const [item] = await CompendiumHelper.findItems(activePacks, {
        types:  [ref.type],
        limit:  1,
      });

      if (item) {
        resolved.push(item);
      } else {
        resolved.push({
          name:  `${ref.type.charAt(0).toUpperCase() + ref.type.slice(1)} Item`,
          type:  ref.type,
          rarity: "common",
          stub:  true,
        });
      }
    }

    return resolved;
  }

  static getCompendiumPacks() {
    return PACK_IDS;
  }

  static getSettings() {
    return [];
  }

  static getItemTypes() {
    return [
      { value: "weapon",     label: "LOOTROLLER.itemType.weapon" },
      { value: "apparel",    label: "LOOTROLLER.itemType.apparel" },
      { value: "ammo",       label: "LOOTROLLER.itemType.ammo" },
      { value: "consumable", label: "LOOTROLLER.itemType.consumable" },
      { value: "junk",       label: "LOOTROLLER.itemType.junk" },
    ];
  }

  static getRarities() {
    return [
      { value: "common",    label: "LOOTROLLER.rarity.common" },
      { value: "uncommon",  label: "LOOTROLLER.rarity.uncommon" },
      { value: "rare",      label: "LOOTROLLER.rarity.rare" },
    ];
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
    return PACK_IDS.filter((id) => game.packs.has(id));
  }

  static async warmPool() {
    return CompendiumHelper.buildPool(FalloutAdapter.getActivePacks());
  }

  static async findItems({ rarities, types, limit = 1, excludeNames } = {}) {
    const rarityNorms = rarities?.map((r) => r.toLowerCase().replace(/\s+/g, ""));
    return CompendiumHelper.findItems(FalloutAdapter.getActivePacks(), {
      types:    types?.length ? types : null,
      rarities: rarityNorms?.length ? rarityNorms : null,
      limit,
      excludeNames,
    });
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
