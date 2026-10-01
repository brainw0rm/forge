"""Extra datasets for the leveling planner, Legacy planner, professions and gear sandbox.

Everything is read from the Forever beta client, except dungeons Blizzard announced that
aren't in the client yet (pipeline/announced.json, labeled as such on the site).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from build_data import (
    CLASSES, OUT, SpellDB, extract_trait_talents, load_table, num, write_json,
)

HERE = Path(__file__).resolve().parent

# --------------------------------------------------------------------------- leveling

# ChrClasses id -> class-ability skill lines (SkillLine CategoryID 7), from the client.
CLASS_BIT = {cid: 1 << (cid - 1) for cid in CLASSES}


def build_leveling(db: SpellDB, icons: dict[str, str]):
    sla = load_table(db.build, "SkillLineAbility")
    levels = {r["SpellID"]: r for r in load_table(db.build, "SpellLevels") if r["DifficultyID"] == "0"}
    subtext = {r["ID"]: r["NameSubtext_lang"] for r in load_table(db.build, "Spell")}
    talents = extract_trait_talents(db)
    talent_node_by_spell = {str(t["spells"][0]): t["id"] for t in talents.values()}
    supersedes = {r["Spell"]: r["SupercedesSpell"] for r in sla if r["SupercedesSpell"] not in ("0", "")}

    def root(spell: str) -> str:
        seen = set()
        while spell in supersedes and spell not in seen:
            seen.add(spell)
            spell = supersedes[spell]
        return spell

    for cid, (slug, _name) in CLASSES.items():
        bit = CLASS_BIT[cid]
        abilities = []
        seen: set[tuple] = set()
        for r in sla:
            # Trainer abilities carry the class bit; talent ranks (mask 0) come from the talent itself.
            if not int(r["ClassMask"] or 0) & bit or r["AcquireMethod"] != "0":
                continue
            sid = r["Spell"]
            lv = int(num(levels.get(sid, {}).get("BaseLevel")))
            if lv < 1 or lv > 60 or not db.names.get(sid):
                continue
            key = (db.names[sid], subtext.get(sid, ""), lv)
            if key in seen:
                continue
            seen.add(key)
            misc = db.misc.get(sid, {})
            entry = {
                "level": lv,
                "name": db.names[sid],
                "rank": subtext.get(sid, ""),
                "icon": icons.get(misc.get("SpellIconFileDataID", ""), "inv_misc_questionmark"),
                "passive": bool(int(misc.get("Attributes_0", "0") or 0) & 0x40),
            }
            node = talent_node_by_spell.get(root(sid))
            if node:
                entry["talent"] = node  # only trainable if the build has this talent
            abilities.append(entry)
        abilities.sort(key=lambda a: (a["level"], a["name"]))
        write_json(OUT / "leveling" / f"{slug}.json", {"abilities": abilities})


def build_dungeons(build: str):
    lfg = load_table(build, "LFGDungeons")
    tuning = {r["ID"]: r for r in load_table(build, "ContentTuning")}
    maps = {r["ID"]: r for r in load_table(build, "Map")}
    announced = json.loads((HERE / "announced.json").read_text())
    by_name = {a["name"].lower(): a for a in announced["dungeons"]}
    out = []
    for r in lfg:
        if r["TypeID"] != "0":  # 0 = dungeon/raid entries; others are zones and battlegrounds
            continue
        ct = tuning.get(r["ContentTuningID"], {})
        min_level = int(num(ct.get("MinLevelSquish")))
        if not min_level:
            continue
        m = maps.get(r["MapID"], {})
        entry = {
            "name": r["Name_lang"],
            "minLevel": min_level,
            "kind": "raid" if m.get("InstanceType") == "2" or min_level >= 60 and "Blackrock Spire" not in r["Name_lang"] else "dungeon",
            "source": "client",
            "isNew": int(r["ID"]) > 3000,
        }
        a = by_name.pop(r["Name_lang"].lower(), None)
        if a:
            entry["announced"] = {"min": a["min"], "max": a["max"]}
        out.append(entry)
    for a in by_name.values():  # announced but not in the client yet
        out.append({"name": a["name"], "minLevel": a["min"], "maxLevel": a["max"], "kind": a["kind"],
                    "source": "announced", "isNew": True, **({"size": a["size"]} if "size" in a else {})})
    out.sort(key=lambda d: (d["minLevel"], d["name"]))
    write_json(OUT / "dungeons.json", {"source": announced["source"], "dungeons": out})


# --------------------------------------------------------------------------- legacy

LEGACY_CURRENCY_MAX = "16"
LEGACY_GRID = 750
# The client has no names for the three Legacy trees; these describe their contents.
LEGACY_LABELS = ["Craft & commerce", "Adventure", "Valor & renown"]


def build_legacy(db: SpellDB, icons: dict[str, str]):
    t = {name: load_table(db.build, name) for name in (
        "TraitNode", "TraitNodeEntry", "TraitDefinition", "TraitEdge", "TraitNodeXTraitNodeEntry",
        "TraitNodeGroupXTraitNode", "TraitCond", "TraitNodeGroupXTraitCond", "TraitTreeXTraitCurrency",
        "TraitCurrency", "TraitCurrencySource", "TraitDefinitionEffectPoints", "CurvePoint")}
    currency = next(c for c in t["TraitCurrency"] if c["SourcedMax"] == LEGACY_CURRENCY_MAX)
    trees = sorted(r["TraitTreeID"] for r in t["TraitTreeXTraitCurrency"] if r["TraitCurrencyID"] == currency["ID"])
    entries = {r["ID"]: r for r in t["TraitNodeEntry"]}
    defs = {r["ID"]: r for r in t["TraitDefinition"]}
    node_entries: dict[str, list[str]] = {}
    for r in sorted(t["TraitNodeXTraitNodeEntry"], key=lambda r: int(r.get("_Index") or 0)):
        node_entries.setdefault(r["TraitNodeID"], []).append(r["TraitNodeEntryID"])
    curves: dict[str, dict[int, float]] = {}
    for r in t["CurvePoint"]:
        curves.setdefault(r["CurveID"], {})[round(num(r["Pos_0"]))] = num(r["Pos_1"])
    effect_curves: dict[str, dict[int, str]] = {}
    for r in t["TraitDefinitionEffectPoints"]:
        effect_curves.setdefault(r["TraitDefinitionID"], {})[int(r["EffectIndex"]) + 1] = r["CurveID"]
    conds = {r["ID"]: r for r in t["TraitCond"]}
    group_conds: dict[str, list[dict]] = {}
    for r in t["TraitNodeGroupXTraitCond"]:
        if r["TraitCondID"] in conds:
            group_conds.setdefault(r["TraitNodeGroupID"], []).append(conds[r["TraitCondID"]])
    groups_of: dict[str, list[str]] = {}
    for r in t["TraitNodeGroupXTraitNode"]:
        groups_of.setdefault(r["TraitNodeID"], []).append(r["TraitNodeGroupID"])
    prereq = {r["RightTraitNodeID"]: r["LeftTraitNodeID"] for r in t["TraitEdge"]}

    def choice(entry_id: str) -> dict | None:
        e = entries[entry_id]
        d = defs.get(e["TraitDefinitionID"])
        if not d:
            return None
        sid = d["SpellID"]
        name = d["OverrideName_lang"] or db.names.get(sid)
        if not name or not db.desc.get(sid):
            return None
        max_ranks = max(1, int(e["MaxRanks"]))
        texts = []
        for rank in range(1, max_ranks + 1):
            ov = {i: curves.get(c, {}).get(rank) for i, c in effect_curves.get(d["ID"], {}).items()}
            texts.append(db.render(sid, overrides={k: v for k, v in ov.items() if v is not None}))
        icon_file = d["OverrideIcon"] if d["OverrideIcon"] not in ("", "0") else db.misc.get(sid, {}).get("SpellIconFileDataID", "")
        return {"entry": int(entry_id), "name": name, "ranks": texts,
                "icon": icons.get(icon_file, "inv_misc_questionmark")}

    out_trees = []
    for i, tree in enumerate(trees):
        nodes = [n for n in t["TraitNode"] if n["TraitTreeID"] == tree]
        built = []
        for n in nodes:
            options = [c for c in (choice(e) for e in node_entries.get(n["ID"], [])) if c]
            if not options:
                continue  # nodes without a spell
            placeholder = all(o["name"] == "Unknown" for o in options)
            if n["Type"] == "1" and len(options) > 1:
                # Tiered node: each entry is the next rank of the same bonus.
                options = [{**options[0], "ranks": [o["ranks"][0] for o in options]}]
            req = 0
            for g in groups_of.get(n["ID"], []):
                for c in group_conds.get(g, []):
                    req = max(req, int(num(c.get("SpentAmountRequired"))))
            built.append({"id": int(n["ID"]), "x": int(n["PosX"]), "y": int(n["PosY"]), "req": req,
                          "prereq": int(prereq[n["ID"]]) if n["ID"] in prereq else None,
                          "choice": len(options) > 1, "options": options,
                          **({"placeholder": True} if placeholder else {})})
        min_x = min(n["x"] for n in built)
        min_y = min(n["y"] for n in built)
        for n in built:
            n["col"] = round((n.pop("x") - min_x) / LEGACY_GRID)
            n["row"] = round((n.pop("y") - min_y) / LEGACY_GRID)
        built.sort(key=lambda n: (n["row"], n["col"]))
        out_trees.append({"id": int(tree), "label": LEGACY_LABELS[i] if i < len(LEGACY_LABELS) else f"Tree {i + 1}",
                          "nodes": built})

    sources = [
        {"requirement": r["Requirement_lang"], "amount": int(num(r["Amount"])), "achievement": int(num(r["AchievementID"]))}
        for r in sorted(t["TraitCurrencySource"], key=lambda r: (int(num(r["OrderIndex"])), r["Requirement_lang"]))
        if r["TraitCurrencyID"] == currency["ID"] and r["Requirement_lang"]
    ]
    write_json(OUT / "legacy.json", {"cap": int(currency["SourcedMax"]), "labelsAreOurs": True,
                                      "trees": out_trees, "sources": sources})


# --------------------------------------------------------------------------- items

# InventoryType -> stat budget column (RandPropPoints *_0.._4), as the game computes it.
BUDGET_SLOT = {1: 0, 4: 0, 5: 0, 7: 0, 15: 0, 17: 0, 20: 0,
               3: 1, 6: 1, 8: 1, 10: 1, 12: 1,
               2: 2, 9: 2, 11: 2, 14: 2, 16: 2, 23: 2,
               13: 3, 21: 3, 22: 3,
               24: 4, 25: 4, 26: 4, 28: 4}
# ItemModType -> short stat key used by the site.
STATS = {0: "mana", 1: "health", 3: "agi", 4: "str", 5: "int", 6: "spi", 7: "sta", 12: "defense", 13: "dodge",
         14: "parry", 15: "block", 31: "hit", 32: "crit", 36: "haste", 38: "ap", 39: "rap", 41: "healing",
         42: "spelldmg", 43: "mp5", 45: "sp", 46: "hp5", 47: "spellpen", 48: "blockvalue", 50: "armor",
         51: "fireres", 52: "frostres", 53: "holyres", 54: "shadowres", 55: "natureres", 56: "arcaneres"}
EQUIP_SLOTS = set(BUDGET_SLOT) | {18}
ARMOR_TYPE = {1: "Cloth", 2: "Leather", 3: "Mail", 4: "Plate"}
# Internal test/deprecated items that ship in the client but aren't real gear.
JUNK_ITEM = re.compile(r"^\d+ (Epic|Green|Blue|Rare|Purple|White)\b|\bTest\b|\bTEST\b|\[DNT\]|\bQA\b|Deprecated|DEPRECATED"
                       r"|\bOLD\b|^Monster -|\bUnused\b|\bUNUSED\b|Placeholder|^NPC |\[PH\]")
# InventoryType -> ArmorLocation row
ARMOR_LOCATION = {1: 1, 3: 3, 5: 5, 20: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 16: 16}


RESIST_STAT = {1: "holyres", 2: "fireres", 3: "natureres", 4: "frostres", 5: "shadowres", 6: "arcaneres"}
DAMAGE_SCHOOL = {1: "Holy", 2: "Fire", 3: "Nature", 4: "Frost", 5: "Shadow", 6: "Arcane"}


class ItemMath:
    """Stats, armor and weapon damage as the client gets them.

    Forever: ItemSparse stores stat shares (StatPercentEditor) of an item-level budget
    (RandPropPoints); armor and weapon DPS come from per-item-level tables.
    Classic Era: ItemSparse stores the final numbers (StatModifier_bonusAmount, Resistances,
    MinDamage/MaxDamage), which are used as they are."""

    def __init__(self, build: str):
        self.budget = {r["ID"]: r for r in load_table(build, "RandPropPoints")}
        self.dmg = {name: {r["ItemLevel"]: r for r in load_table(build, name)}
                    for name in ("ItemDamageOneHand", "ItemDamageTwoHand", "ItemDamageOneHandCaster", "ItemDamageTwoHandCaster")}
        self.armor_total = {r["ItemLevel"]: r for r in load_table(build, "ItemArmorTotal")}
        self.armor_quality = {r["ID"]: r for r in load_table(build, "ItemArmorQuality")}
        self.armor_shield = {r["ItemLevel"]: r for r in load_table(build, "ItemArmorShield")}
        self.location = {r["ID"]: r for r in load_table(build, "ArmorLocation")}

    def stats(self, r: dict, stat_names: dict[int, str] = STATS) -> dict[str, int]:
        if "StatModifier_bonusAmount_0" in r:
            flat: dict[str, int] = {}
            for i in range(10):
                stat, amount = int(num(r[f"StatModifier_bonusStat_{i}"])), int(num(r[f"StatModifier_bonusAmount_{i}"]))
                if stat in stat_names and amount:
                    flat[stat_names[stat]] = flat.get(stat_names[stat], 0) + amount
            for i, key in RESIST_STAT.items():
                if int(num(r.get(f"Resistances_{i}"))):
                    flat[key] = flat.get(key, 0) + int(num(r[f"Resistances_{i}"]))
            return flat
        inv, quality, ilvl = int(num(r["InventoryType"])), int(num(r["OverallQualityID"])), int(num(r["ItemLevel"]))
        col = BUDGET_SLOT.get(inv)
        tier = "Epic" if quality >= 4 else "Superior" if quality == 3 else "Good"
        points = num(self.budget.get(str(ilvl), {}).get(f"{tier}F_{col}")) if col is not None else 0
        stats: dict[str, int] = {}
        for i in range(10):
            stat = int(num(r[f"StatModifier_bonusStat_{i}"]))
            pct = num(r[f"StatPercentEditor_{i}"])
            if stat < 0 or not pct or stat not in stat_names:
                continue
            value = round(points * pct / 10000)
            if value:
                stats[stat_names[stat]] = stats.get(stat_names[stat], 0) + value
        return stats

    def armor(self, r: dict, it: dict) -> int | None:
        if "Resistances_0" in r:
            return int(num(r["Resistances_0"])) or None
        inv, quality, ilvl = int(num(r["InventoryType"])), int(num(r["OverallQualityID"])), str(int(num(r["ItemLevel"])))
        armor_type = int(it["SubclassID"]) if it["ClassID"] == "4" else 0
        if inv == 14 and ilvl in self.armor_shield:
            return round(num(self.armor_shield[ilvl][f"Quality_{quality}"])) or None
        if armor_type in ARMOR_TYPE and inv in ARMOR_LOCATION and ilvl in self.armor_total:
            mod_col = {1: "Clothmodifier", 2: "Leathermodifier", 3: "Chainmodifier", 4: "Platemodifier"}[armor_type]
            total = num(self.armor_total[ilvl][ARMOR_TYPE[armor_type]])
            loc = num(self.location.get(str(ARMOR_LOCATION[inv]), {}).get(mod_col))
            qmod = num(self.armor_quality.get(ilvl, {}).get(f"Qualitymod_{quality}"))
            if total and loc and qmod:
                return round(total * loc * qmod)
        return None

    def damage(self, r: dict, it: dict, stats: dict[str, int]):
        """{min, max, speed, dps}; None when the weapon's damage can't be derived; absent (False) for non-weapons."""
        delay = num(r["ItemDelay"]) / 1000
        if it["ClassID"] != "2" or not delay:
            return False
        if "MinDamage_0" in r:
            lo, hi = num(r["MinDamage_0"]), num(r["MaxDamage_0"])
            if not hi:
                return None
            out = {"min": round(lo), "max": round(hi), "speed": round(delay, 2), "dps": round((lo + hi) / 2 / delay, 1)}
            if num(r.get("MaxDamage_1")):
                out["bonus"] = {"min": round(num(r["MinDamage_1"])), "max": round(num(r["MaxDamage_1"])),
                                "school": DAMAGE_SCHOOL.get(int(num(r.get("DamageType_1", r.get("DamageType", "0")))), "")}
            return out
        inv, quality, ilvl = int(num(r["InventoryType"])), int(num(r["OverallQualityID"])), str(int(num(r["ItemLevel"])))
        caster = bool(stats.get("sp") or stats.get("spelldmg") or stats.get("healing"))
        table = self.dmg[f"ItemDamage{'TwoHand' if inv == 17 else 'OneHand'}{'Caster' if caster else ''}"]
        dps = num(table.get(ilvl, {}).get(f"Quality_{quality}"))
        if int(num(r["QualityModifier"])) or not dps:
            return None  # special weapons: damage isn't derivable from the tables
        avg = dps * delay
        var = num(r["DmgVariance"]) or 0
        return {"min": round(avg * (1 - var / 2)), "max": round(avg * (1 + var / 2)), "speed": round(delay, 2), "dps": round(dps, 1)}


def build_items(build: str, era_build: str, icons: dict[str, str]):
    """Equippable items by slot, for the gear sandbox."""
    sparse = load_table(build, "ItemSparse")
    item = {r["ID"]: r for r in load_table(build, "Item")}
    math = ItemMath(build)
    classic_ids = {r["ID"] for r in load_table(era_build, "ItemSparse")}

    out: dict[str, list] = {}
    for r in sparse:
        inv = int(num(r["InventoryType"]))
        quality = int(num(r["OverallQualityID"]))
        ilvl = int(num(r["ItemLevel"]))
        it = item.get(r["ID"])
        if inv not in EQUIP_SLOTS or not it or quality < 1 or not r["Display_lang"] or ilvl < 5:
            continue
        if JUNK_ITEM.search(r["Display_lang"]):
            continue
        stats = math.stats(r)
        entry = {"id": int(r["ID"]), "name": r["Display_lang"], "q": quality, "ilvl": ilvl,
                 "req": int(num(r["RequiredLevel"])), "slot": inv, "cls": int(it["ClassID"]),
                 "sub": int(it["SubclassID"]),
                 "icon": icons.get(it["IconFileDataID"], "inv_misc_questionmark"), "stats": stats}
        if r["ID"] not in classic_ids:
            entry["new"] = True
        if int(num(r["ItemSet"])):
            entry["set"] = int(num(r["ItemSet"]))
        armor = math.armor(r, it)
        if armor:
            entry["armor"] = armor
        dmg = math.damage(r, it, stats)
        if dmg is not False:
            entry["dmg"] = dmg
        out.setdefault(str(inv), []).append(entry)

    for inv, items in out.items():
        items.sort(key=lambda x: (-x["ilvl"], x["name"]))
        write_json(OUT / "items" / f"slot-{inv}.json", items)
    write_json(OUT / "items" / "index.json", {k: len(v) for k, v in sorted(out.items(), key=lambda kv: int(kv[0]))})
    return sum(len(v) for v in out.values())


# --------------------------------------------------------------------------- professions

PROFESSION_CATEGORIES = {"11": "primary", "9": "secondary"}


def build_professions(db: SpellDB, era_build: str, icons: dict[str, str]):
    lines = {r["ID"]: r for r in load_table(db.build, "SkillLine") if r["CategoryID"] in PROFESSION_CATEGORIES}
    sla = load_table(db.build, "SkillLineAbility")
    era_recipes = {(r["SkillLine"], r["Spell"]) for r in load_table(era_build, "SkillLineAbility")}
    reagents = {r["SpellID"]: r for r in load_table(db.build, "SpellReagents")}
    sparse = {r["ID"]: r for r in load_table(db.build, "ItemSparse")}
    item = {r["ID"]: r for r in load_table(db.build, "Item")}

    def item_ref(item_id: str, count: int = 1):
        s = sparse.get(item_id)
        it = item.get(item_id, {})
        return {"id": int(item_id), "name": s["Display_lang"] if s else f"Item {item_id}", "count": count,
                "q": int(num(s["OverallQualityID"])) if s else 1,
                "icon": icons.get(it.get("IconFileDataID", ""), "inv_misc_questionmark")}

    index = []
    for lid, line in sorted(lines.items(), key=lambda kv: kv[1]["DisplayName_lang"]):
        recipes = []
        for r in sla:
            if r["SkillLine"] != lid or not db.names.get(r["Spell"]):
                continue
            sid = r["Spell"]
            creates = None
            for e in db.effects.get(sid, {}).values():
                if e.get("Effect") == "24" and e.get("EffectItemType") not in ("", "0"):
                    creates = item_ref(e["EffectItemType"], max(1, int(db.points(e))))
                    break
            rg = reagents.get(sid)
            mats = []
            if rg:
                for i in range(8):
                    rid = rg.get(f"Reagent_{i}", "0")
                    if rid not in ("0", ""):
                        mats.append(item_ref(rid, int(num(rg.get(f"ReagentCount_{i}")))))
            if not creates and not mats:
                continue  # passive ranks/specializations, not recipes
            recipes.append({
                "spell": int(sid), "name": db.names[sid], "skill": int(num(r["MinSkillLineRank"])),
                "yellow": int(num(r["TrivialSkillLineRankLow"])), "grey": int(num(r["TrivialSkillLineRankHigh"])),
                "creates": creates, "reagents": mats,
                **({"new": True} if (lid, sid) not in era_recipes else {}),
            })
        # Skip test/one-off skill lines; real professions have many recipes.
        if len(recipes) < 10 or "[DNT]" in line["DisplayName_lang"]:
            continue
        recipes.sort(key=lambda x: (x["yellow"] or x["skill"], x["name"]))
        slug = line["DisplayName_lang"].lower().replace(" ", "-")
        write_json(OUT / "professions" / f"{slug}.json", {"id": int(lid), "name": line["DisplayName_lang"], "recipes": recipes})
        index.append({"id": int(lid), "slug": slug, "name": line["DisplayName_lang"],
                      "kind": PROFESSION_CATEGORIES[line["CategoryID"]],
                      "icon": icons.get(line["SpellIconFileID"], "inv_misc_questionmark"),
                      "recipes": len(recipes), "new": sum(1 for x in recipes if x.get("new"))})
    write_json(OUT / "professions" / "index.json", index)
    return len(index)
