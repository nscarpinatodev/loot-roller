/**
 * CurrencyHelper
 *
 * Handles currency math: equal distribution among players and
 * depositing totals into the party stash actor.
 *
 * All amounts are in the smallest denomination relevant to the system
 * (cp for 5e and PF2e). Conversion rates are system-specific and
 * passed in via the adapter.
 */

/**
 * Standard 5e/PF2e conversion: 1 pp = 10 gp = 100 sp = 1000 cp (5e adds ep = 5 sp)
 */
const DEFAULT_CONVERSION = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

/**
 * Reduce a coin object to a single cp value.
 * @param {{ cp?:number, sp?:number, ep?:number, gp?:number, pp?:number }} coins
 * @param {object} [rates]
 * @returns {number} total in cp
 */
export function toCP(coins, rates = DEFAULT_CONVERSION) {
  return Object.entries(coins).reduce((total, [denom, amount]) => {
    return total + (amount ?? 0) * (rates[denom] ?? 1);
  }, 0);
}

/**
 * Convert a raw cp total back to a coin object, using the largest denominations
 * first. Skips denominations that are not in the provided `denoms` list.
 *
 * @param {number}   totalCP
 * @param {string[]} denoms     Denominations to use, largest first (e.g. ["gp","sp","cp"])
 * @param {object}   [rates]
 * @returns {{ cp?:number, sp?:number, ep?:number, gp?:number, pp?:number }}
 */
export function fromCP(totalCP, denoms = ["pp", "gp", "sp", "cp"], rates = DEFAULT_CONVERSION) {
  let remainder = Math.floor(totalCP);
  const result = {};
  for (const denom of denoms) {
    const rate = rates[denom] ?? 1;
    result[denom] = Math.floor(remainder / rate);
    remainder = remainder % rate;
  }
  return result;
}

/**
 * Equally split a coin object among `count` players.
 * Any remainder (from integer division) stays as smaller denomination(s).
 *
 * @param {{ cp?:number, sp?:number, ep?:number, gp?:number, pp?:number }} coins
 * @param {number} count  Number of players
 * @param {string[]} [denoms]
 * @returns {{ perPlayer: object, remainder: object }}
 */
export function splitEqually(coins, count, denoms = ["gp", "sp", "cp"]) {
  if (count <= 0) return { perPlayer: {}, remainder: { ...coins } };

  const perPlayer = {};
  const remainder = {};

  for (const denom of Object.keys(coins)) {
    const amount = coins[denom] ?? 0;
    perPlayer[denom] = Math.floor(amount / count);
    remainder[denom] = amount % count;
  }

  return { perPlayer, remainder };
}

/**
 * Add coins to an actor's currency (system-agnostic wrapper).
 *
 * @param {Actor}  actor
 * @param {{ cp?:number, sp?:number, ep?:number, gp?:number, pp?:number }} coins
 */
export async function addCurrencyToActor(actor, coins) {
  if (!actor) return;

  const systemId = game.system.id;

  if (systemId === "dnd5e") {
    const current = actor.system.currency ?? {};
    const updated = {};
    for (const [denom, amount] of Object.entries(coins)) {
      updated[denom] = (current[denom] ?? 0) + (amount ?? 0);
    }
    await actor.update({ "system.currency": updated });
    return;
  }

  if (systemId === "pf2e") {
    // PF2e stores currency directly in system.currency (same key names as dnd5e).
    const current = actor.system?.currency ?? {};
    const updates = {};
    for (const [denom, amount] of Object.entries(coins)) {
      if (amount) updates[denom] = (current[denom] ?? 0) + amount;
    }
    if (Object.keys(updates).length) {
      await actor.update({ "system.currency": updates });
    }
    return;
  }

  if (systemId === "fallout") {
    // Fallout 2d20 uses caps stored in system.currency.caps.
    const current = actor.system?.currency ?? {};
    const caps    = (current.caps ?? 0) + (coins.caps ?? 0);
    await actor.update({ "system.currency": { ...current, caps } });
    return;
  }

  // Fallback: attempt the dnd5e-style path and warn if unsupported
  console.warn(`LootRoller | addCurrencyToActor: unrecognized system "${systemId}", attempting generic update`);
  const current = actor.system?.currency ?? {};
  const updated = {};
  for (const [denom, amount] of Object.entries(coins)) {
    updated[denom] = (current[denom] ?? 0) + (amount ?? 0);
  }
  await actor.update({ "system.currency": updated });
}

/**
 * Format a coin object as a human-readable string.
 * Only includes non-zero denominations.
 *
 * @param {{ cp?:number, sp?:number, ep?:number, gp?:number, pp?:number }} coins
 * @returns {string}  e.g. "12 gp, 4 sp"
 */
export function formatCoins(coins) {
  if (!coins) return "0";
  // Fallout: caps only
  if ("caps" in coins) {
    return coins.caps > 0 ? `${coins.caps} caps` : "0 caps";
  }
  const order = ["pp", "gp", "ep", "sp", "cp"];
  return order
    .filter((d) => coins[d] > 0)
    .map((d) => `${coins[d]} ${d}`)
    .join(", ") || "0 gp";
}
