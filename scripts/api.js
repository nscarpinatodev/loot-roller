/**
 * LootRoller global API
 *
 * Exposed as window.LootRoller after module init.
 * System adapters call LootRoller.registerSystem(MyAdapter) from their own
 * init hooks to plug in generation logic and compendium mappings.
 */

export const LootRoller = {
  /** @type {Map<string, typeof import('./systems/base-adapter.js').LootSystemAdapter>} */
  _adapters: new Map(),

  /**
   * Register a system adapter.
   * @param {typeof import('./systems/base-adapter.js').LootSystemAdapter} adapter
   */
  registerSystem(adapter) {
    if (!adapter.systemId) {
      console.error("LootRoller | registerSystem: adapter missing static systemId");
      return;
    }
    this._adapters.set(adapter.systemId, adapter);
    console.log(`LootRoller | Registered adapter for system: ${adapter.systemId}`);
  },

  /**
   * Retrieve the adapter for the active (or specified) system.
   * @param {string} [systemId]
   * @returns {typeof import('./systems/base-adapter.js').LootSystemAdapter | null}
   */
  getAdapter(systemId = game.system.id) {
    return this._adapters.get(systemId) ?? null;
  },

  /** Open the loot hub (main launcher). */
  openRoller() {
    const { LootHubApp } = game.modules.get("loot-roller").apps;
    new LootHubApp().render(true);
  },
};
