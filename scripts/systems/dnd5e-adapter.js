/**
 * D&D 5e Loot System Adapter
 *
 * Supports dnd5e system versions 5.2.x (Foundry v13) and 5.3.x (Foundry v14).
 * Reads treasure tables from data/dnd5e-2014-tables.json and dnd5e-2024-tables.json.
 */

import { LootRoller } from "../api.js";
import { CompendiumHelper } from "../compendium-helper.js";

const MODULE_ID = "loot-roller";

/** True when running dnd5e 5.3.x or later. */
const IS_DND5E_53 = () => foundry.utils.isNewerVersion(game.system.version, "5.2.99");

/** Cache loaded table data. */
let _tableCache = {};

async function _loadTables(edition) {
  if (_tableCache[edition]) return _tableCache[edition];
  const resp = await fetch(`modules/${MODULE_ID}/data/dnd5e-${edition}-tables.json`);
  _tableCache[edition] = await resp.json();
  return _tableCache[edition];
}

/** Parse a dice formula string like "3d6", "4d6*100", "1d4-1" into a numeric result. */
function _rollFormula(formula) {
  // Handles: NdX | NdX*M | NdX+K | NdX-K, and plain integers
  const match = formula.match(/^(\d+)d(\d+)(?:\*(\d+)|([+-]\d+))?$/i);
  if (!match) {
    const fixed = parseInt(formula, 10);
    return isNaN(fixed) ? 0 : fixed;
  }
  const [, n, x, multiplier, modifier] = match;
  let total = 0;
  for (let i = 0; i < Number(n); i++) total += Math.floor(Math.random() * Number(x)) + 1;
  if (multiplier) total *= Number(multiplier);
  if (modifier) total += Number(modifier);
  return Math.max(0, total);
}

/** Roll d100 and find the matching table entry. */
function _rollOnTable(entries) {
  const roll = Math.floor(Math.random() * 100) + 1;
  return entries.find((e) => roll >= e.min && roll <= e.max) ?? null;
}

/** Convert coin formula strings in an entry to numeric coin amounts. */
function _resolveCoins(coinDefs) {
  if (!coinDefs) return {};
  const result = {};
  for (const [denom, formula] of Object.entries(coinDefs)) {
    result[denom] = typeof formula === "string" ? _rollFormula(formula) : formula;
  }
  return result;
}

/** Generate magic item refs from a magic sub-table roll. */
function _rollMagicItems(magicRefs, magicTables) {
  const items = [];
  for (const ref of (magicRefs ?? [])) {
    const count = ref.count === "1" ? 1 : _rollFormula(ref.count);
    const table = magicTables[`table${ref.table}`];
    if (!table) continue;
    for (let i = 0; i < count; i++) {
      const entry = _rollOnTable(table.entries);
      if (!entry) continue;
      if (entry.item?.startsWith("_PLACEHOLDER")) {
        // Fallback: return a random item of that rarity from the compendium
        items.push({ name: null, type: "equipment", rarity: table.rarity, _placeholder: true });
      } else {
        items.push({ name: entry.item, type: "equipment", rarity: table.rarity, count: 1 });
      }
    }
  }
  return items;
}

// ── Compendium packs to search ──────────────────────────────────────────────

const PACK_IDS = [
  "dnd5e.items",
  "dnd5e.tradegoods",
  "dnd5e.equipment24",  // 5.3.x
  "dnd5e.magicitems",
  "dnd5e.spells",
];

// ── Adapter ─────────────────────────────────────────────────────────────────

export class DnD5eAdapter {
  static systemId = "dnd5e";
  static systemName = "D&D 5th Edition";

  static getGeneratorFields() {
    const bracketChoices = [
      { value: "cr0_4",    label: game.i18n.localize("LOOTROLLER.dnd5e.cr.0_4") },
      { value: "cr5_10",   label: game.i18n.localize("LOOTROLLER.dnd5e.cr.5_10") },
      { value: "cr11_16",  label: game.i18n.localize("LOOTROLLER.dnd5e.cr.11_16") },
      { value: "cr17plus", label: game.i18n.localize("LOOTROLLER.dnd5e.cr.17plus") },
    ];

    return [
      {
        name: "treasureType",
        label: "LOOTROLLER.dnd5e.field.treasureType",
        type: "select",
        options: [
          { value: "individual", label: "LOOTROLLER.dnd5e.treasureType.individual" },
          { value: "hoard",      label: "LOOTROLLER.dnd5e.treasureType.hoard" },
        ],
        default: "hoard",
      },
      {
        name: "bracket",
        label: "LOOTROLLER.dnd5e.field.crRange",
        type: "select",
        options: bracketChoices,
        default: "cr0_4",
      },
      {
        name: "creatureCount",
        label: "LOOTROLLER.dnd5e.field.creatureCount",
        type: "number",
        default: 1,
        hint: "LOOTROLLER.dnd5e.field.creatureCountHint",
        showWhen: { field: "treasureType", value: "individual" },
      },
      {
        name: "tableEditionOverride",
        label: "LOOTROLLER.dnd5e.field.tableEdition",
        type: "select",
        options: [
          { value: "default", label: "LOOTROLLER.dnd5e.edition.default" },
          { value: "2014",    label: "LOOTROLLER.dnd5e.edition.2014" },
          { value: "2024",    label: "LOOTROLLER.dnd5e.edition.2024" },
        ],
        default: "default",
        hint: "LOOTROLLER.dnd5e.field.tableEditionHint",
      },
    ];
  }

  static async generateLoot(params) {
    let edition = params.tableEditionOverride === "default"
      ? game.settings.get(MODULE_ID, "dnd5e.tableEdition")
      : params.tableEditionOverride;
    edition = edition ?? "2014";

    const tables = await _loadTables(edition);
    const { treasureType, bracket, creatureCount = 1 } = params;

    const section = tables[treasureType]?.[bracket];
    if (!section) {
      ui.notifications.error(
        game.i18n.format("LOOTROLLER.error.noTable", { treasureType, bracket, edition })
      );
      return { coins: {}, items: [] };
    }

    const totalCoins = {};
    const itemRefs = [];
    const count = treasureType === "individual" ? Math.max(1, parseInt(creatureCount) || 1) : 1;

    if (treasureType === "individual") {
      // Both editions: single coin denomination per bracket (2024 has one all-range entry)
      for (let i = 0; i < count; i++) {
        const entry = _rollOnTable(section.entries);
        if (!entry) continue;
        const rolled = _resolveCoins(entry.coins);
        for (const [d, v] of Object.entries(rolled)) {
          totalCoins[d] = (totalCoins[d] ?? 0) + v;
        }
      }
    } else if (edition === "2024") {
      // 2024 Hoard: flat coins + random items from Arcana rarity pools
      const baseCoins = _resolveCoins(section.coins);
      for (const [d, v] of Object.entries(baseCoins)) {
        totalCoins[d] = (totalCoins[d] ?? 0) + v;
      }

      if (game.settings.get(MODULE_ID, "includeMagicItems")) {
        const itemCount = _rollFormula(section.magicItems.count);
        const rarities = section.magicItems.rarities;
        const allowDupes = game.settings.get(MODULE_ID, "allowDuplicateItems");

        // Build a shuffled pool keyed per rarity so we can sample without replacement
        const poolsByRarity = {};
        for (const rarity of rarities) {
          const arcanaKey = `arcana${rarity.charAt(0).toUpperCase()}${rarity.slice(1)}`;
          poolsByRarity[rarity] = [...(tables.magicItems[arcanaKey]?.items ?? [])].sort(() => Math.random() - 0.5);
        }

        const usedNames = new Set();
        for (let i = 0; i < itemCount; i++) {
          const rarity = rarities[Math.floor(Math.random() * rarities.length)];
          const pool = poolsByRarity[rarity];
          if (!pool.length) continue;
          // Pop from shuffled pool (no replacement) or pick randomly if duplicates allowed
          let name;
          if (allowDupes) {
            name = pool[Math.floor(Math.random() * pool.length)];
          } else {
            name = pool.find((n) => !usedNames.has(n));
            if (!name) continue; // pool exhausted
          }
          usedNames.add(name);
          itemRefs.push({ name, type: "equipment", rarity, count: 1 });
        }
      }
    } else {
      // 2014 Hoard: base coins + d100 extras sub-table (gems / art / named magic tables)
      const baseCoins = _resolveCoins(section.coins);
      for (const [d, v] of Object.entries(baseCoins)) {
        totalCoins[d] = (totalCoins[d] ?? 0) + v;
      }

      const extrasEntry = _rollOnTable(section.extras.entries);
      if (extrasEntry) {
        const includeGems = game.settings.get(MODULE_ID, "includeGems");
        const includeArt  = game.settings.get(MODULE_ID, "includeArtObjects");
        const includeMagic = game.settings.get(MODULE_ID, "includeMagicItems");
        const allowDupes  = game.settings.get(MODULE_ID, "allowDuplicateItems");

        // Gem/art name lists live in the 2024 tables JSON (same names across editions)
        const nameSrc = edition === "2024" ? tables : await _loadTables("2024").catch(() => ({}));
        const gemTables = nameSrc.gems ?? {};
        const artTables = nameSrc.artObjects ?? {};
        const usedNames = new Set();

        const _pickName = (namePool, allowDuplicates) => {
          if (!namePool?.length) return null;
          if (allowDuplicates) return namePool[Math.floor(Math.random() * namePool.length)];
          const available = namePool.filter((n) => !usedNames.has(n));
          if (!available.length) return namePool[Math.floor(Math.random() * namePool.length)]; // exhausted, allow repeat
          return available[Math.floor(Math.random() * available.length)];
        };

        if (extrasEntry.gems && includeGems) {
          const gemCount = _rollFormula(extrasEntry.gems.count);
          const pool = gemTables[String(extrasEntry.gems.gp)] ?? [];
          for (let i = 0; i < gemCount; i++) {
            const name = _pickName(pool, allowDupes);
            usedNames.add(name);
            itemRefs.push({ name, type: "treasure", rarity: "common", gpValue: extrasEntry.gems.gp, count: 1 });
          }
        }
        if (extrasEntry.art && includeArt) {
          const artCount = _rollFormula(extrasEntry.art.count);
          const pool = artTables[String(extrasEntry.art.gp)] ?? [];
          for (let i = 0; i < artCount; i++) {
            const name = _pickName(pool, allowDupes);
            usedNames.add(name);
            itemRefs.push({ name, type: "treasure", rarity: "common", gpValue: extrasEntry.art.gp, artObject: true, count: 1 });
          }
        }
        if (extrasEntry.magic?.length && includeMagic) {
          const magicItems = _rollMagicItems(extrasEntry.magic, tables.magicItems);
          if (!allowDupes) {
            magicItems.forEach((item) => {
              if (!item.name || !usedNames.has(item.name)) {
                if (item.name) usedNames.add(item.name);
                itemRefs.push(item);
              }
            });
          } else {
            itemRefs.push(...magicItems);
          }
        }
      }
    }

    return { coins: totalCoins, items: itemRefs };
  }

  static async resolveItems(itemRefs) {
    const resolved = [];
    for (const ref of itemRefs) {
      if (ref._placeholder) {
        const item = await CompendiumHelper.findRandomByRarity(ref.rarity, PACK_IDS);
        if (item) {
          resolved.push(item);
        } else {
          resolved.push({ name: `Magic Item (${ref.rarity})`, img: "icons/svg/item-bag.svg", type: "loot", rarity: ref.rarity, stub: true });
        }
        continue;
      }

      if (!ref.name) {
        // Gem or art object with no name — find by GP value in compendium
        const item = await CompendiumHelper.findTreasureByValue(ref.gpValue, PACK_IDS);
        if (item) {
          resolved.push(item);
        } else {
          const label = ref.artObject ? `Art Object (${ref.gpValue} gp)` : `Gem (${ref.gpValue} gp)`;
          resolved.push({ name: label, img: "icons/svg/item-bag.svg", type: "loot", rarity: "common", stub: true });
        }
        continue;
      }

      const item = await CompendiumHelper.findByName(ref.name, PACK_IDS);
      if (item) {
        resolved.push(item);
      } else {
        // Named gem/art stub — use "loot" type which dnd5e accepts
        resolved.push({
          name: ref.name,
          img: "icons/svg/item-bag.svg",
          type: "loot",
          rarity: ref.rarity ?? "common",
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
        key: "dnd5e.tableEdition",
        name: "LOOTROLLER.settings.dnd5e.tableEdition.name",
        hint: "LOOTROLLER.settings.dnd5e.tableEdition.hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
          "2014": game.i18n.localize("LOOTROLLER.dnd5e.edition.2014"),
          "2024": game.i18n.localize("LOOTROLLER.dnd5e.edition.2024"),
        },
        default: "2014",
      },
      {
        key: "includeMagicItems",
        name: "LOOTROLLER.settings.includeMagicItems.name",
        hint: "LOOTROLLER.settings.includeMagicItems.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
      },
      {
        key: "includeGems",
        name: "LOOTROLLER.settings.includeGems.name",
        hint: "LOOTROLLER.settings.includeGems.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
      },
      {
        key: "includeArtObjects",
        name: "LOOTROLLER.settings.includeArtObjects.name",
        hint: "LOOTROLLER.settings.includeArtObjects.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
      },
      {
        key: "allowDuplicateItems",
        name: "LOOTROLLER.settings.allowDuplicateItems.name",
        hint: "LOOTROLLER.settings.allowDuplicateItems.hint",
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
      { value: "equipment",  label: "LOOTROLLER.itemType.equipment" },
      { value: "consumable", label: "LOOTROLLER.itemType.consumable" },
      { value: "loot",       label: "LOOTROLLER.itemType.loot" },
      { value: "tool",       label: "LOOTROLLER.itemType.tool" },
    ];
  }

  static getRarities() {
    return [
      { value: "common",    label: "LOOTROLLER.rarity.common" },
      { value: "uncommon",  label: "LOOTROLLER.rarity.uncommon" },
      { value: "rare",      label: "LOOTROLLER.rarity.rare" },
      { value: "veryRare",  label: "LOOTROLLER.rarity.veryRare" },
      { value: "legendary", label: "LOOTROLLER.rarity.legendary" },
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

// Self-register when dnd5e is the active system
Hooks.once("init", () => {
  if (game.system.id === "dnd5e") {
    LootRoller.registerSystem(DnD5eAdapter);
  }
});
