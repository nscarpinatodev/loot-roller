/**
 * LootSystemAdapter — base interface for system-specific loot generation.
 *
 * Adapters are plain classes with static methods; they do not need to extend
 * this class. The shape here serves as documentation and a runtime validator.
 *
 * Registration:
 *   import { LootRoller } from '../api.js';
 *   LootRoller.registerSystem(MyAdapter);
 *
 * Call from your adapter's own Hooks.once('init') or Hooks.once('ready').
 */
export class LootSystemAdapter {
  /**
   * Foundry system ID, e.g. "dnd5e" or "pf2e".
   * @type {string}
   */
  static systemId = "";

  /**
   * Human-readable name shown in the UI when multiple adapters are registered.
   * @type {string}
   */
  static systemName = "";

  /**
   * Return form field descriptors for the loot generation dialog.
   * Each object matches the shape rendered by loot-roller.hbs.
   *
   * @returns {Array<{
   *   name: string,
   *   label: string,
   *   type: 'select'|'number'|'checkbox'|'range',
   *   options?: Array<{value:string, label:string}>,
   *   default: any,
   *   hint?: string
   * }>}
   */
  static getGeneratorFields() {
    return [];
  }

  /**
   * Core loot generation. Receives the submitted form values from the
   * generation dialog and returns a structured result.
   *
   * @param {Record<string, any>} params  Key/value pairs from form fields.
   * @returns {Promise<LootResult>}
   */
  static async generateLoot(params) {
    return { coins: {}, items: [] };
  }

  /**
   * Resolve item references (names, types, rarity) produced by generateLoot
   * into actual Foundry Item documents fetched from compendiums.
   *
   * Items that cannot be resolved may be returned as stub objects with at
   * minimum { name, type, rarity }.
   *
   * @param {ItemRef[]} itemRefs
   * @returns {Promise<Array<Item|ItemStub>>}
   */
  static async resolveItems(itemRefs) {
    return itemRefs;
  }

  /**
   * Compendium pack IDs this adapter reads from.
   * Used by CompendiumHelper to pre-build and cache indexes.
   *
   * @returns {string[]}
   */
  static getCompendiumPacks() {
    return [];
  }

  /**
   * Return an array of settings descriptor objects to be registered via
   * game.settings.register() during module init.
   *
   * Each descriptor extends the standard Foundry settings config with an
   * extra `key` field used as the setting name (prefixed by "loot-roller.").
   *
   * @returns {Array<{key: string} & SettingsRegisterOptions>}
   */
  static getSettings() {
    return [];
  }

  /**
   * Return item type choices available for the quest and shop generators.
   * These are the item types the adapter knows how to search for.
   *
   * @returns {Array<{value: string, label: string}>}
   */
  static getItemTypes() {
    return [];
  }

  /**
   * Return rarity choices available for this system, ordered from lowest to highest.
   *
   * @returns {Array<{value: string, label: string}>}
   */
  static getRarities() {
    return [];
  }

  /**
   * Find compendium items matching the given filter criteria.
   * Used by quest and shop generators to search for items interactively.
   *
   * @param {{
   *   rarities?:     string[],    rarity values to include (OR match)
   *   types?:        string[],    item type values to include (OR match); null = all types
   *   limit?:        number,      max items to return (default 1)
   *   excludeNames?: Set<string>  item names to skip (de-dupe across calls)
   * }} params
   * @returns {Promise<Array<Item|object>>}
   */
  static async findItems(params) {
    return [];
  }
}

/**
 * @typedef {object} LootResult
 * @property {{ cp?:number, sp?:number, ep?:number, gp?:number, pp?:number }} coins
 * @property {ItemRef[]} items
 */

/**
 * @typedef {object} ItemRef
 * @property {string}  name          Display name of the item.
 * @property {string}  type          System item type (e.g. "weapon", "consumable", "treasure").
 * @property {string}  [rarity]      Rarity label ("common", "uncommon", "rare", "veryRare", "legendary").
 * @property {number}  [count]       How many of this item were rolled (default 1).
 * @property {number}  [gpValue]     Gold piece value, used for gems/art when resolving by value.
 * @property {string}  [compendiumId] UUID hint for direct lookup if known.
 */

/**
 * @typedef {object} ItemStub
 * @property {string} name
 * @property {string} type
 * @property {string} [rarity]
 * @property {number} [gpValue]
 * @property {boolean} stub  Always true — indicates no compendium document was found.
 */

/**
 * Validate that an adapter object implements the required interface.
 * Called by LootRoller.registerSystem() as a soft check.
 *
 * @param {typeof LootSystemAdapter} adapter
 * @returns {boolean}
 */
export function validateAdapter(adapter) {
  const required = ["systemId", "systemName", "getGeneratorFields", "generateLoot", "resolveItems", "getCompendiumPacks"];
  const missing = required.filter((k) => !(k in adapter));
  if (missing.length) {
    console.warn(`LootRoller | Adapter missing: ${missing.join(", ")}`);
    return false;
  }
  return true;
}
