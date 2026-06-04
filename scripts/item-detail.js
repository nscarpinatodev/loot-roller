/**
 * Item detail builder — produces a system-aware display context for an item
 * (image, name, type, key stats, enriched description). Shared by the inline
 * Quest detail, the ItemDetailApp popup, and the player Lottery window.
 *
 * Stat extraction is adapted from Scorpious187's Customizable Shop (minus the
 * shop/price/theming concerns). Respects mystification: when an item is
 * unidentified, the active adapter's display name/description are used and the
 * stat block is suppressed so players don't see through the disguise.
 */

import { LootRoller } from "./api.js";
import { isStarfinder2eSystem } from "./systems/starfinder2e-adapter.js";

const DEFAULT_ITEM_IMG = "icons/svg/item-bag.svg";

/**
 * Build the display context for an item.
 * @param {Item|object} item        A live Item document or a plain item-data object.
 * @param {{ mystified?: boolean }} [opts]
 * @returns {Promise<{name,img,typeLabel,stats,descriptionHTML,mystified}>}
 */
export async function buildItemDetail(item, { mystified } = {}) {
  const adapter = LootRoller.getAdapter?.();
  const isMyst  = mystified ?? adapter?.isMystified?.(item) ?? false;

  const name = isMyst && adapter?.getDisplayName ? adapter.getDisplayName(item) : item?.name;
  const img  = item?.img || DEFAULT_ITEM_IMG;

  const rawDesc = isMyst
    ? (adapter?.getDisplayDescription?.(item) ?? "")
    : _rawDescription(item);

  return {
    name:            name ?? "Unknown Item",
    img,
    typeLabel:       _typeLabel(item),
    stats:           isMyst ? [] : _extractStats(item),
    descriptionHTML: await _enrich(rawDesc, item),
    mystified:       !!isMyst,
  };
}

async function _enrich(html, item) {
  if (!html) return "";
  const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  try {
    return await TE.enrichHTML(html, { secrets: false, relativeTo: item?.toObject ? item : null });
  } catch {
    return html;
  }
}

function _rawDescription(item) {
  const d = item?.system?.description;
  if (typeof d === "string") return d;
  return d?.value ?? d?.full ?? d?.gm ?? "";
}

function _typeLabel(item) {
  const type = item?.type ?? "";
  const key = `TYPES.Item.${type}`;
  const loc = game.i18n.localize(key);
  return loc === key ? String(type).replace(/^\w/, (c) => c.toUpperCase()) : loc;
}

/** Title-case a key: "smallGuns" / "speed_penalty" → "Small Guns" / "Speed Penalty". */
function _titleCase(s) {
  if (s === undefined || s === null || s === "") return undefined;
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * System-aware stat extraction. Dispatches to a per-system extractor; unknown
 * systems use a generic reader. Returns [{ label, value }]; empty fields skipped.
 */
function _extractStats(item) {
  const id = game.system?.id ?? "";
  let stats;
  if (id === "dnd5e") stats = _stats5e(item);
  else if (id === "pf2e" || isStarfinder2eSystem()) stats = _statsPf2e(item);
  else if (id === "fallout") stats = _statsFallout(item);
  else stats = _statsGeneric(item);
  return stats.filter((s) => s.value !== undefined && s.value !== null && s.value !== "");
}

// ── D&D 5e ────────────────────────────────────────────────────────────────────
function _stats5e(item) {
  const get = (p) => foundry.utils.getProperty(item, `system.${p}`);
  const out = [];
  const push = (label, value) => { if (value !== undefined && value !== null && value !== "") out.push({ label, value: String(value) }); };

  const base = get("damage.base");
  if (base && (base.number != null || base.denomination != null)) {
    const die = base.denomination ? `d${base.denomination}` : "";
    const bonus = base.bonus ? ` + ${base.bonus}` : "";
    const types = base.types instanceof Set ? [...base.types]
      : Array.isArray(base.types) ? base.types : (base.type ? [base.type] : []);
    const typeStr = types.length ? " " + types.map((t) => _titleCase(t)).join("/") : "";
    push("Damage", `${base.number ?? 1}${die}${bonus}${typeStr}`.trim());
  } else {
    const parts = get("damage.parts");
    if (Array.isArray(parts) && parts.length) {
      push("Damage", parts.map((p) => Array.isArray(p) ? `${p[0]}${p[1] ? " " + _titleCase(p[1]) : ""}` : p).join(", "));
    }
  }

  const range = get("range.value");
  if (range) push("Range", `${range}${get("range.long") ? "/" + get("range.long") : ""} ${get("range.units") || "ft"}`.trim());

  if (get("armor.value") != null) push("Armor Class", get("armor.value"));
  if (get("armor.dex") != null) push("Max Dex", `+${get("armor.dex")}`);

  push("Properties", _dnd5eProperties(item));
  const weight = typeof get("weight") === "object" ? get("weight.value") : get("weight");
  if (weight) push("Weight", `${weight} lb`);
  push("Rarity", _titleCase(get("rarity")));
  if (get("attunement")) push("Attunement", "Required");
  return out;
}

function _dnd5eProperties(item) {
  const p = foundry.utils.getProperty(item, "system.properties");
  let keys = [];
  if (p instanceof Set) keys = [...p];
  else if (Array.isArray(p)) keys = p;
  else if (p && typeof p === "object") keys = Object.entries(p).filter(([, v]) => v === true).map(([k]) => k);
  if (!keys.length) return undefined;
  const labels = CONFIG?.DND5E?.itemProperties ?? {};
  return keys.map((k) => labels[k]?.label ?? _titleCase(k)).join(", ");
}

// ── Pathfinder 2e / Starfinder 2e ─────────────────────────────────────────────
function _statsPf2e(item) {
  const get = (p) => foundry.utils.getProperty(item, `system.${p}`);
  const out = [];
  const push = (label, value) => { if (value !== undefined && value !== null && value !== "") out.push({ label, value: String(value) }); };

  const die = get("damage.die");
  if (die) {
    const dtype = get("damage.damageType");
    push("Damage", `${get("damage.dice") ?? 1}${die}${dtype ? " " + _titleCase(dtype) : ""}`);
  }
  if (get("range")) push("Range", `${get("range")} ft`);
  if (get("reload.value") !== undefined && get("reload.value") !== null && get("reload.value") !== "") push("Reload", get("reload.value"));

  if (get("acBonus") != null) push("AC Bonus", get("acBonus") >= 0 ? `+${get("acBonus")}` : get("acBonus"));
  if (get("dexCap") != null) push("Dex Cap", `+${get("dexCap")}`);
  if (get("checkPenalty")) push("Check Penalty", get("checkPenalty"));
  if (get("speedPenalty")) push("Speed Penalty", get("speedPenalty"));
  if (get("hardness")) push("Hardness", get("hardness"));
  if (get("hp.max")) push("HP", get("hp.max"));

  push("Category", _titleCase(get("category")));
  push("Group", _titleCase(get("group")?.value ?? get("group")));

  const bulk = get("bulk.value");
  if (bulk != null) push("Bulk", bulk === 0 ? "—" : (bulk === 0.1 ? "L" : bulk));
  if (get("level.value")) push("Level", get("level.value"));
  push("Rarity", _titleCase(get("traits.rarity")));
  const traits = get("traits.value");
  if (Array.isArray(traits) && traits.length) push("Traits", traits.map((t) => _titleCase(t)).join(", "));
  return out;
}

// ── Fallout 2d20 ──────────────────────────────────────────────────────────────
function _statsFallout(item) {
  const get = (p) => foundry.utils.getProperty(item, `system.${p}`);
  const out = [];
  const push = (label, value) => { if (value !== undefined && value !== null && value !== "") out.push({ label, value: String(value) }); };

  if (get("damage.rating") != null) push("Damage", `${get("damage.rating")} CD`);
  push("Damage Type", _falloutFlags(get("damage.damageType")));
  push("Effects", _falloutRanked(get("damage.damageEffect")));
  push("Qualities", _falloutRanked(get("damage.weaponQuality")));
  push("Weapon Type", _titleCase(get("weaponType")));
  if (get("fireRate")) push("Fire Rate", get("fireRate"));
  if (get("range")) push("Range", _titleCase(typeof get("range") === "object" ? get("range.value") : get("range")));
  if (get("ammo")) push("Ammo", typeof get("ammo") === "object" ? get("ammo.value") : get("ammo"));
  if (get("ammoPerShot") && !get("melee")) push("Ammo / Shot", get("ammoPerShot"));

  const res = (...paths) => {
    for (const p of paths) { const v = get(p); if (v != null) return (typeof v === "object" ? v.value : v); }
    return undefined;
  };
  const phys = res("resistance.physical", "physicalRes.value", "physical.value");
  const enrg = res("resistance.energy", "energyRes.value", "energy.value");
  const rad  = res("resistance.radiation", "radiationRes.value", "radiation.value");
  if (phys != null) push("Physical DR", phys);
  if (enrg != null) push("Energy DR", enrg);
  if (rad != null) push("Radiation DR", rad);
  push("Covers", _falloutFlags(get("location")));

  const weight = typeof get("weight") === "object" ? get("weight.value") : get("weight");
  if (weight) push("Weight", `${weight} lbs`);
  push("Rarity", _falloutRarity(get("rarity")));
  return out;
}

function _falloutFlags(obj) {
  if (!obj || typeof obj !== "object") return obj ? _titleCase(obj) : undefined;
  const on = Object.entries(obj).filter(([, v]) => v === true).map(([k]) => _titleCase(k));
  return on.length ? on.join(", ") : undefined;
}

function _falloutRanked(obj) {
  if (!obj || typeof obj !== "object") return undefined;
  const out = [];
  for (const [key, v] of Object.entries(obj)) {
    const val = (v && typeof v === "object") ? v.value : v;
    if (!val) continue;
    const name = _titleCase(key.replace(/_x$/, ""));
    out.push(val === 1 ? name : `${name} ${val}`);
  }
  return out.length ? out.join(", ") : undefined;
}

function _falloutRarity(r) {
  if (r == null || r === "") return undefined;
  const labels = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
  return typeof r === "number" ? (labels[r] ?? `Rarity ${r}`) : _titleCase(r);
}

// ── Generic fallback ──────────────────────────────────────────────────────────
function _statsGeneric(item) {
  const get = (p) => foundry.utils.getProperty(item, `system.${p}`);
  const out = [];
  const push = (label, value) => { if (value !== undefined && value !== null && value !== "") out.push({ label, value: String(value) }); };
  const parts = get("damage.parts");
  if (Array.isArray(parts) && parts.length) push("Damage", parts.map((p) => Array.isArray(p) ? p.filter(Boolean).join(" ") : p).join(", "));
  else if (get("damage.value")) push("Damage", `${get("damage.value")}${get("damage.type") ? " " + get("damage.type") : ""}`);
  else if (typeof get("damage") === "string") push("Damage", get("damage"));
  push("Range", get("range.value") ?? (typeof get("range") === "object" ? undefined : get("range")));
  push("Armor", get("armor.value") ?? get("ac.value") ?? get("acBonus"));
  const weight = typeof get("weight") === "object" ? get("weight.value") : get("weight");
  if (weight) push("Weight", weight);
  push("Rarity", _titleCase(get("rarity")));
  return out;
}
