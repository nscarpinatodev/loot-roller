/**
 * Pathfinder 2e Loot System Adapter
 *
 * Uses the Party Treasure by Level table (CRB/GM Core) for budget-based
 * loot generation. Items are drawn from the pf2e.equipment-srd compendium
 * filtered by item level and type.
 */

import { LootRoller } from "../api.js";
import { CompendiumHelper } from "../compendium-helper.js";

const MODULE_ID = "loot-roller";

// ── Party Treasure by Level (4-player base, GM Core p.XXX) ─────────────────
// Format: [totalGP, permanentItems [[count,level],[count,level]], consumables [[count,level],...], baseGP, perExtraPC]
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

const PACK_IDS = ["pf2e.equipment-srd", "pf2e.equipment"];
const CONSUMABLE_TYPES = ["consumable"];
const PERMANENT_TYPES  = ["weapon", "armor", "shield", "equipment"];

export class PF2eAdapter {
  static systemId = "pf2e";
  static systemName = "Pathfinder 2nd Edition";

  static getGeneratorFields() {
    return [
      {
        name: "partyLevel",
        label: "LOOTROLLER.pf2e.field.partyLevel",
        type: "number",
        default: 1,
        min: 1,
        max: 20,
      },
      {
        name: "partySize",
        label: "LOOTROLLER.pf2e.field.partySize",
        type: "number",
        default: 4,
        min: 1,
        max: 8,
        hint: "LOOTROLLER.pf2e.field.partySizeHint",
      },
      {
        name: "lootScope",
        label: "LOOTROLLER.pf2e.field.lootScope",
        type: "select",
        options: [
          { value: "full",      label: "LOOTROLLER.pf2e.lootScope.full" },
          { value: "encounter", label: "LOOTROLLER.pf2e.lootScope.encounter" },
          { value: "custom",    label: "LOOTROLLER.pf2e.lootScope.custom" },
        ],
        default: "full",
      },
      {
        name: "customBudget",
        label: "LOOTROLLER.pf2e.field.customBudget",
        type: "number",
        default: 0,
        hint: "LOOTROLLER.pf2e.field.customBudgetHint",
        showWhen: { field: "lootScope", value: "custom" },
      },
      {
        name: "includeUncommon",
        label: "LOOTROLLER.pf2e.field.includeUncommon",
        type: "checkbox",
        default: false,
      },
      {
        name: "includeRare",
        label: "LOOTROLLER.pf2e.field.includeRare",
        type: "checkbox",
        default: false,
      },
    ];
  }

  static async generateLoot(params) {
    const partyLevel = Math.min(20, Math.max(1, parseInt(params.partyLevel) || 1));
    const partySize  = Math.max(1, parseInt(params.partySize) || 4);
    const includeUncommon = !!params.includeUncommon;
    const includeRare     = !!params.includeRare;

    const row = TREASURE_BY_LEVEL[partyLevel];
    if (!row) return { coins: {}, items: [] };

    // Adjust for party size relative to base of 4
    const sizeAdjust = (partySize - 4) * row.perPC;

    let budgetGP;
    if (params.lootScope === "custom") {
      budgetGP = Math.max(0, parseInt(params.customBudget) || 0);
    } else if (params.lootScope === "encounter") {
      // Rough encounter share: divide full level budget by ~10 encounters per level
      budgetGP = Math.round((row.total + sizeAdjust) / 10);
    } else {
      budgetGP = row.total + sizeAdjust;
    }

    // Gather permanent and consumable item refs from the level table
    const itemRefs = [];
    const baseRarityOpts = { includeUncommon, includeRare };

    for (const [count, level] of (row.permanent ?? [])) {
      for (let i = 0; i < count; i++) {
        itemRefs.push({
          name: null,
          type: PERMANENT_TYPES[Math.floor(Math.random() * PERMANENT_TYPES.length)],
          rarity: "common",
          level,
          _pf2eType: "permanent",
          ...baseRarityOpts,
        });
      }
    }

    for (const [count, level] of (row.consumables ?? [])) {
      for (let i = 0; i < count; i++) {
        itemRefs.push({
          name: null,
          type: "consumable",
          rarity: "common",
          level,
          _pf2eType: "consumable",
          ...baseRarityOpts,
        });
      }
    }

    // Currency is the remainder after items (use base currency from table)
    const currencyGP = Math.min(budgetGP, row.currency + (sizeAdjust > 0 ? sizeAdjust : 0));
    const coins = { gp: Math.floor(currencyGP), sp: 0, cp: 0 };

    return { coins, items: itemRefs };
  }

  static async resolveItems(itemRefs) {
    const resolved = [];
    for (const ref of itemRefs) {
      const types = ref._pf2eType === "consumable" ? CONSUMABLE_TYPES : PERMANENT_TYPES;
      let item = null;

      for (const type of types) {
        const results = await CompendiumHelper.findByLevelAndType(PACK_IDS, {
          level: ref.level,
          type,
          includeUncommon: ref.includeUncommon,
          includeRare: ref.includeRare,
          limit: 1,
        });
        if (results.length) { item = results[0]; break; }
      }

      if (item) {
        resolved.push(item);
      } else {
        resolved.push({
          name: `${ref._pf2eType === "consumable" ? "Consumable" : "Item"} (Level ${ref.level})`,
          type: ref.type,
          level: ref.level,
          stub: true,
        });
      }
    }
    return resolved;
  }

  static getCompendiumPacks() {
    return PACK_IDS;
  }

  static getSettings() {
    return [
      {
        key: "pf2e.includeUncommon",
        name: "LOOTROLLER.settings.pf2e.includeUncommon.name",
        hint: "LOOTROLLER.settings.pf2e.includeUncommon.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
      },
      {
        key: "pf2e.includeRare",
        name: "LOOTROLLER.settings.pf2e.includeRare.name",
        hint: "LOOTROLLER.settings.pf2e.includeRare.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
      },
    ];
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
      { value: "common",    label: "LOOTROLLER.rarity.common" },
      { value: "uncommon",  label: "LOOTROLLER.rarity.uncommon" },
      { value: "rare",      label: "LOOTROLLER.rarity.rare" },
      { value: "unique",    label: "LOOTROLLER.rarity.unique" },
    ];
  }

  static async findItems({ rarities, types, limit = 1, excludeNames } = {}) {
    const rarityNorms = rarities?.map((r) => r.toLowerCase().replace(/\s+/g, ""));
    return CompendiumHelper.findItems(PACK_IDS, {
      types: types?.length ? types : null,
      rarities: rarityNorms?.length ? rarityNorms : null,
      limit,
      excludeNames,
    });
  }
}

Hooks.once("init", () => {
  if (game.system.id === "pf2e") {
    LootRoller.registerSystem(PF2eAdapter);
  }
});
