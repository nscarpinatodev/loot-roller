/**
 * LootListManager
 *
 * Persists named loot lists as a world setting (JSON object keyed by ID).
 * Items are stored as serialized item data so they can be distributed later
 * without a compendium lookup.
 */

const SETTING_KEY = "savedLists";

export const LootListManager = {
  /** @returns {Record<string, LootList>} */
  getAll() {
    return game.settings.get("scorpious187s-loot-roller", SETTING_KEY) ?? {};
  },

  /** @returns {LootList|null} */
  get(id) {
    return this.getAll()[id] ?? null;
  },

  /**
   * Persist a loot list.
   * @param {string} name
   * @param {{ items: Array, coins: object, category: string }} data
   * @returns {string} The new list ID
   */
  async save(name, { items = [], coins = {}, category = "custom" } = {}) {
    const lists = this.getAll();
    const id = foundry.utils.randomID();
    const serializedItems = items.map((item) => {
      if (item?.toObject) {
        const obj = item.toObject();
        delete obj._id;
        return obj;
      }
      // Plain stub — store as-is (already a safe plain object)
      return { ...item };
    });
    lists[id] = { id, name, createdAt: Date.now(), category, items: serializedItems, coins };
    await game.settings.set("scorpious187s-loot-roller", SETTING_KEY, lists);
    return id;
  },

  async delete(id) {
    const lists = this.getAll();
    delete lists[id];
    await game.settings.set("scorpious187s-loot-roller", SETTING_KEY, lists);
  },

  async rename(id, newName) {
    const lists = this.getAll();
    if (!lists[id]) return;
    lists[id].name = newName;
    await game.settings.set("scorpious187s-loot-roller", SETTING_KEY, lists);
  },
};

/**
 * @typedef {{ id: string, name: string, createdAt: number, category: string,
 *             items: object[], coins: object }} LootList
 */
