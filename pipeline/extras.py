"""Profession data from the Forever client: every recipe with its reagents, skill-up colors, tools,
stations, cooldowns and recipe items, compared with Classic Era. ItemMath (item stats and damage from
the client's item budget tables) is shared with pipeline/itemdb.py."""

from __future__ import annotations

import json
import re
from pathlib import Path

from build_data import (
    OUT, SpellDB, load_table, num, write_json,
)


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


# --------------------------------------------------------------------------- professions

PROFESSION_CATEGORIES = {"11": "primary", "9": "secondary"}
GATHERING = {"herbalism", "mining", "skinning", "fishing"}
# Items the game files file under a gathering profession's material type (ItemSubClass of Trade Goods).
GATHERED_TYPES = {"herbalism": ["9"], "mining": ["7"], "skinning": ["6"], "fishing": ["8"]}
RANK_NAMES = ["Apprentice", "Journeyman", "Expert", "Artisan", "Master", "Grand Master"]


def build_professions(db: SpellDB, era_build: str, icons: dict[str, str]):
    """Every profession with its recipes and everything the client says about crafting them: skill
    ranges, reagents, tools, crafting station, cooldown, the recipe items that teach them, recipe
    categories, ranks and specializations, and what changed from Classic Era."""
    from itemdb import ClientItems  # itemdb imports this module

    build = db.build
    lines = {r["ID"]: r for r in load_table(build, "SkillLine") if r["CategoryID"] in PROFESSION_CATEGORIES}
    sla = load_table(build, "SkillLineAbility")
    era_sla = {(r["SkillLine"], r["Spell"]): r for r in load_table(era_build, "SkillLineAbility")}
    reagents = {r["SpellID"]: r for r in load_table(build, "SpellReagents")}
    era_reagents = {r["SpellID"]: r for r in load_table(era_build, "SpellReagents")}
    spell = {r["ID"]: r for r in load_table(build, "Spell")}
    totems = {r["SpellID"]: r for r in load_table(build, "SpellTotems")}
    totem_names = {r["ID"]: r["Name_lang"] for r in load_table(build, "TotemCategory")}
    focus = {r["SpellID"]: r["RequiresSpellFocus"] for r in load_table(build, "SpellCastingRequirements")}
    focus_names = {r["ID"]: r["Name_lang"] for r in load_table(build, "SpellFocusObject")}
    categories = {r["ID"]: r for r in load_table(build, "TradeSkillCategory")}
    items = ClientItems(build, db)
    subclasses = {(r["ClassID"], r["SubClassID"]): r["DisplayName_lang"] or r["VerboseName_lang"] for r in load_table(build, "ItemSubClass")}

    def item_ref(item_id: str, count: int = 1):
        s = items.sparse.get(item_id)
        it = items.item.get(item_id, {})
        ref = {"id": int(item_id), "name": s["Display_lang"] if s else f"Item {item_id}",
               "q": int(num(s["OverallQualityID"])) if s else 1,
               "icon": icons.get(it.get("IconFileDataID", ""), "inv_misc_questionmark")}
        return {**ref, "count": count} if count else ref

    def reagent_list(rg) -> list[tuple[str, int]]:
        out = []
        if rg:
            for i in range(8):
                rid = rg.get(f"Reagent_{i}", "0")
                if rid not in ("0", ""):
                    out.append((rid, int(num(rg.get(f"ReagentCount_{i}")))))
        return out

    # Recipe items: an item whose "learn" effect is the recipe, or a spell that teaches it.
    taught_by: dict[str, list[str]] = {}
    for iid, effs in items.effects.items():
        for e in effs:
            if e["TriggerType"] != "6":
                continue
            taught_by.setdefault(e["SpellID"], []).append(iid)
            for eff in db.effects.get(e["SpellID"], {}).values():
                if eff.get("Effect") == "36" and eff.get("EffectTriggerSpell") not in ("", "0"):
                    taught_by.setdefault(eff["EffectTriggerSpell"], []).append(iid)

    def recipe_item(iid: str):
        s = items.sparse[iid]
        ref = item_ref(iid, 0)
        req = int(num(s.get("RequiredSkillRank")))
        if req:
            ref["skill"] = req
        return ref

    index = []
    for lid, line in sorted(lines.items(), key=lambda kv: kv[1]["DisplayName_lang"]):
        name = line["DisplayName_lang"]
        if "[DNT]" in name or line["ParentSkillLineID"] not in ("0", ""):
            continue
        slug = name.lower().replace(" ", "-")
        recipes, ranks, specs, used_cats = [], [], [], {}
        for r in sla:
            if r["SkillLine"] != lid or not db.names.get(r["Spell"]):
                continue
            sid = r["Spell"]
            effs = db.effects.get(sid, {}).values()
            creates = None
            for e in effs:
                if e.get("Effect") == "24" and e.get("EffectItemType") not in ("", "0"):
                    creates = item_ref(e["EffectItemType"], max(1, int(db.points(e))))
                    break
            mats = reagent_list(reagents.get(sid))
            if not creates and not mats:
                # Not a recipe: a rank of the profession ("Journeyman") or a specialization.
                sub = spell.get(sid, {}).get("NameSubtext_lang", "")
                desc = db.render(sid) if spell.get(sid, {}).get("Description_lang") else ""
                step = next((e for e in effs if e.get("Effect") == "118" and e.get("EffectMiscValue_0") == lid), None)
                if step and sub in RANK_NAMES and sub not in (x["name"] for x in ranks):
                    ranks.append({"name": sub, "spell": int(sid), "desc": desc})
                elif not step and db.names[sid] != name and desc and db.names[sid] not in (x["name"] for x in specs):
                    specs.append({"name": db.names[sid], "spell": int(sid), "desc": desc})
                continue
            rec = {
                "spell": int(sid), "name": db.names[sid],
                "yellow": int(num(r["TrivialSkillLineRankLow"])), "grey": int(num(r["TrivialSkillLineRankHigh"])),
                "creates": creates, "reagents": [item_ref(i, n) for i, n in mats],
            }
            cat = categories.get(r["TradeSkillCategoryID"])
            if cat:
                rec["cat"] = int(cat["ID"])
                used_cats[cat["ID"]] = cat
            if not creates:
                rec["desc"] = db.render(sid)
            t = totems.get(sid)
            if t:
                tools = [totem_names[c] for c in (t["RequiredTotemCategoryID_0"], t["RequiredTotemCategoryID_1"]) if c in totem_names]
                tools += [items.sparse[i]["Display_lang"] for i in (t["Totem_0"], t["Totem_1"]) if i in items.sparse]
                if tools:
                    rec["tools"] = tools
            if focus_names.get(focus.get(sid, "0")):
                rec["station"] = focus_names[focus[sid]]
            cd = db.cooldown_ms(sid)
            if cd:
                rec["cooldown"] = int(cd // 1000)
            ups = int(num(r["NumSkillUps"]))
            if ups != 1:
                rec["skillups"] = ups
            if r["AcquireMethod"] == "1":
                rec["auto"] = True
            learned = sorted({i for i in taught_by.get(sid, []) if i in items.sparse}, key=int)
            if learned:
                rec["learnedFrom"] = [recipe_item(i) for i in learned]
            # The skill needed to learn it. The client's MinSkillLineRank is 1 for nearly every recipe (in
            # Classic Era too; trainers hold the real value), so only a recipe item's requirement counts.
            from_items = [x["skill"] for x in rec.get("learnedFrom", []) if x.get("skill")]
            learn = max(min(from_items, default=0), int(num(r["MinSkillLineRank"])))
            if learn > 1:
                rec["learn"] = learn
            old = era_sla.get((lid, sid))
            if not old:
                rec["new"] = True
            else:
                was = {}
                old_mats = reagent_list(era_reagents.get(sid))
                if sorted(old_mats) != sorted(mats):
                    was["reagents"] = [item_ref(i, n) for i, n in old_mats]
                for key, col in (("yellow", "TrivialSkillLineRankLow"), ("grey", "TrivialSkillLineRankHigh")):
                    if int(num(old[col])) != rec[key]:
                        was[key] = int(num(old[col]))
                if was:
                    rec["classic"] = was
            recipes.append(rec)
        gathering = slug in GATHERING
        if len(recipes) < 3 and not gathering:
            continue  # test and one-off skill lines
        recipes.sort(key=lambda x: (x["yellow"] or x.get("learn", 0), x["name"]))
        ranks.sort(key=lambda x: RANK_NAMES.index(x["name"]))
        cats = sorted(used_cats.values(), key=lambda c: (int(num(c["OrderIndex"])), c["Name_lang"]))
        payload = {
            "id": int(lid), "slug": slug, "name": name, "kind": "gathering" if gathering else PROFESSION_CATEGORIES[line["CategoryID"]],
            "icon": icons.get(line["SpellIconFileID"], "inv_misc_questionmark"), "desc": line["Description_lang"],
            "ranks": ranks, "specs": specs,
            "categories": [{"id": int(c["ID"]), "name": c["Name_lang"]} for c in cats],
            "recipes": recipes,
        }
        if gathering:
            # What the game files class as this profession's material: herbs, metal & stone, leather, meat.
            mats = [iid for iid, it in items.item.items()
                    if it.get("ClassID") == "7" and it.get("SubclassID") in GATHERED_TYPES[slug] and iid in items.sparse
                    and not items.sparse[iid]["Display_lang"].startswith(("Test", "zz", "TEST"))]
            payload["materials"] = {"type": ", ".join(subclasses.get(("7", sc), sc) for sc in GATHERED_TYPES[slug]),
                                    "items": sorted((item_ref(i, 0) for i in mats), key=lambda x: x["name"])}
        write_json(OUT / "professions" / f"{slug}.json", payload)
        index.append({"id": int(lid), "slug": slug, "name": name, "kind": payload["kind"], "icon": payload["icon"],
                      "recipes": len(recipes), "new": sum(1 for x in recipes if x.get("new")),
                      "changed": sum(1 for x in recipes if x.get("classic"))})
    order = {"primary": 0, "gathering": 1, "secondary": 2}
    index.sort(key=lambda p: (order[p["kind"]], p["name"]))
    for old in (OUT / "professions").glob("*.json"):
        if old.stem != "index" and old.stem not in {p["slug"] for p in index}:
            old.unlink()
    write_json(OUT / "professions" / "index.json", index)
    return len(index)
