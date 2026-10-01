// Item labels shared by the item pages (src/views/items.ts) and their link previews (server/meta.ts).

export const QUALITY_NAME = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact"];

export const SLOT_NAME: Record<number, string> = {
  1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist",
  10: "Hands", 11: "Finger", 12: "Trinket", 13: "One-Hand", 14: "Off Hand", 15: "Ranged", 16: "Back",
  17: "Two-Hand", 18: "Bag", 19: "Tabard", 20: "Chest", 21: "Main Hand", 22: "Off Hand", 23: "Held In Off-hand",
  24: "Projectile", 25: "Thrown", 26: "Ranged", 27: "Quiver", 28: "Relic",
};


/** Stats the tooltip shows as "+N Name" in white (the rest are green equip lines). */
export const PRIMARY_STATS = ["str", "agi", "sta", "int", "spi", "holyres", "fireres", "natureres", "frostres", "shadowres", "arcaneres", "allres"];

export const STAT_NAME: Record<string, string> = {
  str: "Strength", agi: "Agility", sta: "Stamina", int: "Intellect", spi: "Spirit",
  holyres: "Holy Resistance", fireres: "Fire Resistance", natureres: "Nature Resistance", frostres: "Frost Resistance",
  shadowres: "Shadow Resistance", arcaneres: "Arcane Resistance", allres: "All Resistances",
  mana: "Mana", health: "Health", armor: "Armor",
  hit: "Hit Rating", crit: "Critical Strike Rating", haste: "Haste Rating", defense: "Defense Rating",
  dodge: "Dodge Rating", parry: "Parry Rating", block: "Block Rating", blockvalue: "Block Value",
  ap: "Attack Power", rap: "Ranged Attack Power", sp: "Spell Power", spelldmg: "Spell Damage", healing: "Healing",
  mp5: "Mana per 5 sec.", hp5: "Health per 5 sec.", spellpen: "Spell Penetration",
  firesp: "Fire Spell Damage", frostsp: "Frost Spell Damage", shadowsp: "Shadow Spell Damage",
  naturesp: "Nature Spell Damage", arcanesp: "Arcane Spell Damage", fishing: "Fishing",
  // Classic Era percent chances (Forever uses ratings instead).
  hitpct: "% Hit Chance", critpct: "% Critical Strike Chance", spellhitpct: "% Spell Hit Chance",
  spellcritpct: "% Spell Critical Strike Chance", dodgepct: "% Dodge Chance", parrypct: "% Parry Chance", blockpct: "% Block Chance",
};

/** "+18 Strength", "−5 Agility" (some Classic items really have negative stats), "+2% Hit Chance". */
export const signed = (value: number) => (value < 0 ? `−${-value}` : `+${value}`);

export const statLine = (key: string, value: number) =>
  STAT_NAME[key]?.startsWith("%") ? `${signed(value)}${STAT_NAME[key]}` : `${signed(value)} ${STAT_NAME[key] ?? key}`;
