"""Item database: every real item in the Forever beta client, with its tooltip data and a
comparison against the same item in Classic Era.

Output (public/data/items/db/):
  index.json        compact rows for search and filters (one array per item)
  d/<id % 128>.json item details, sharded so an item page loads ~100 KB, not the whole database
  meta.json         item class/subclass names and counts

Nothing is guessed: values the client doesn't ship (drop sources, vendor locations, weapon damage
of special weapons) are simply absent, and tooltip values the beta hides stay "?".
"""

from __future__ import annotations

import re

from build_data import OUT, SpellDB, load_table, num, write_json
from extras import DAMAGE_SCHOOL, JUNK_ITEM, STATS, ItemMath

SHARDS = 128
LEVEL_CAP = 60

# ItemEffect.TriggerType -> tooltip prefix
TRIGGER = {0: "use", 1: "equip", 2: "hit", 4: "use", 5: "use", 6: "use"}
STANDING = ["Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"]
CLASS_SLUGS = {1: "warrior", 2: "paladin", 3: "hunter", 4: "rogue", 5: "priest", 7: "shaman", 8: "mage", 9: "warlock", 11: "druid"}
# Items the Forever client ships with no player-facing use (e.g. WoW Token, internal currencies).
SKIP_CLASSES = {"18"}
NUMBER = re.compile(r"\?|\d+(?:\.\d+)?")

# Stat types that exist only in the Forever client. Meanings are inferred from the Classic Era
# version of the same items (their equip effects), and a value is shown only where the budget
# formula reproduces Classic's number exactly (checked across all matching items).
FOREVER_STATS = {**STATS, 85: "firesp", 86: "naturesp", 87: "frostsp", 88: "shadowsp", 89: "arcanesp",
                 117: "fishing", 124: "allres"}
# Meaning is clear, but these use a different budget weight (our formula gives half of Classic's
# value), so the number is left unknown instead of shown wrong.
NAMED_NO_VALUE = {127: "Attack Power when fighting Demons", 128: "Attack Power when fighting Undead",
                  131: "Attack Power when fighting Beasts", 136: "Spell damage against Undead"}

# Classic Era equip effects that Forever turned into item stats; folded into stats so the
# comparison sees "Restores 2 mana per 5 sec." and "+2 mana per 5 sec" as the same thing.
# Percent chances stay separate keys ("hitpct") because Forever uses ratings instead.
STAT_EFFECTS = [
    (re.compile(r"^Increases damage and healing done by magical spells and effects by up to (\d+)\.$"), "sp"),
    (re.compile(r"^Increases healing done by spells and effects by up to (\d+)\.$"), "healing"),
    (re.compile(r"^Restores (\d+) mana per 5 sec\.$"), "mp5"),
    (re.compile(r"^Restores (\d+) health per 5 sec\.$"), "hp5"),
    (re.compile(r"^\+(\d+) Attack Power\.$"), "ap"),
    (re.compile(r"^\+(\d+) ranged Attack Power\.$"), "rap"),
    (re.compile(r"^Increases damage done by Fire spells and effects by up to (\d+)\.$"), "firesp"),
    (re.compile(r"^Increases damage done by Frost spells and effects by up to (\d+)\.$"), "frostsp"),
    (re.compile(r"^Increases damage done by Shadow spells and effects by up to (\d+)\.$"), "shadowsp"),
    (re.compile(r"^Increases damage done by Nature spells and effects by up to (\d+)\.$"), "naturesp"),
    (re.compile(r"^Increases damage done by Arcane spells and effects by up to (\d+)\.$"), "arcanesp"),
    (re.compile(r"^Increased Defense \+(\d+)\.$"), "defense"),
    (re.compile(r"^Increases the block value of your shield by (\d+)\.$"), "blockvalue"),
    (re.compile(r"^Decreases the magical resistances of your spell targets by (\d+)\.$"), "spellpen"),
    (re.compile(r"^Increased Fishing \+(\d+)\.$"), "fishing"),
    (re.compile(r"^\+(\d+) All Resistances\.$"), "allres"),
    (re.compile(r"^Improves your chance to hit by (\d+)%\.$"), "hitpct"),
    (re.compile(r"^Improves your chance to get a critical strike by (\d+)%\.$"), "critpct"),
    (re.compile(r"^Improves your chance to hit with spells by (\d+)%\.$"), "spellhitpct"),
    (re.compile(r"^Improves your chance to get a critical strike with spells by (\d+)%\.$"), "spellcritpct"),
    (re.compile(r"^Increases your chance to dodge an attack by (\d+)%\.$"), "dodgepct"),
    (re.compile(r"^Increases your chance to parry an attack by (\d+)%\.$"), "parrypct"),
    (re.compile(r"^Increases your chance to block attacks with a shield by (\d+)%\.$"), "blockpct"),
]
TEACHES = re.compile(r"^Teaches you how to ")


def fold_stats(stats: dict[str, int], spells: list[dict]) -> tuple[dict[str, int], list[dict]]:
    """Stat-like equip effects moved into stats; recipe "Teaches you how to..." lines dropped
    (recipes are compared by the item they teach)."""
    stats, rest = dict(stats), []
    for sp in spells:
        if TEACHES.match(sp["text"]):
            continue
        for pattern, key in STAT_EFFECTS:
            m = pattern.match(sp["text"]) if sp["on"] == "equip" else None
            if m:
                stats[key] = stats.get(key, 0) + int(m.group(1))
                break
        else:
            rest.append(sp)
    return stats, rest


class ClientItems:
    """One client's item tables, indexed."""

    def __init__(self, build: str, db: SpellDB):
        self.build, self.db = build, db
        self.sparse = {r["ID"]: r for r in load_table(build, "ItemSparse")}
        self.item = {r["ID"]: r for r in load_table(build, "Item")}
        self.math = ItemMath(build)
        effects = {r["ID"]: r for r in load_table(build, "ItemEffect")}
        self.effects: dict[str, list[dict]] = {}
        if "ParentItemID" in next(iter(effects.values()), {}):  # Classic Era layout
            for e in effects.values():
                self.effects.setdefault(e["ParentItemID"], []).append(e)
        else:  # Forever layout: a link table
            for link in load_table(build, "ItemXItemEffect"):
                if link["ItemEffectID"] in effects:
                    self.effects.setdefault(link["ItemID"], []).append(effects[link["ItemEffectID"]])
        for lst in self.effects.values():
            lst.sort(key=lambda e: int(num(e["LegacySlotIndex"])))
        self.by_name: dict[str, list[str]] = {}
        for iid, r in self.sparse.items():
            self.by_name.setdefault(r["Display_lang"], []).append(iid)

    def spell_lines(self, iid: str) -> list[dict]:
        out = []
        for e in self.effects.get(iid, []):
            sid = e["SpellID"]
            text = self.db.render(sid) if sid in self.db.desc else ""
            trigger = TRIGGER.get(int(num(e["TriggerType"])))
            if not text or not trigger:
                continue
            line = {"on": trigger, "text": text, "spell": int(sid)}
            if int(num(e["Charges"])):
                line["charges"] = abs(int(num(e["Charges"])))
            cd = int(num(e["CoolDownMSec"])) or int(num(e["CategoryCoolDownMSec"]))
            if cd > 0:
                line["cd"] = cd // 1000
            out.append(line)
        return out

    def numbers(self, iid: str) -> dict:
        r, it = self.sparse[iid], self.item.get(iid, {})
        stats = self.math.stats(r, FOREVER_STATS)
        out: dict = {"q": int(num(r["OverallQualityID"])), "ilvl": int(num(r["ItemLevel"])),
                     "req": int(num(r["RequiredLevel"])), "stats": stats}
        if it:
            armor = self.math.armor(r, it)
            if armor:
                out["armor"] = armor
            dmg = self.math.damage(r, it, stats)
            if dmg is not False:
                out["dmg"] = dmg
        return out


def _nums(text: str) -> list[str]:
    """The numbers in a text, normalized so "1.0" and "1" compare equal."""
    return [n if n == "?" else f"{float(n):g}" for n in NUMBER.findall(text)]


def _same_effect(a: str, b: str) -> bool:
    """Same numbers in the same order; a "?" (value hidden by the beta) matches anything.
    Wording alone doesn't count as a change (same rule as for talents)."""
    na, nb = _nums(a), _nums(b)
    return len(na) == len(nb) and all(x == y or "?" in (x, y) for x, y in zip(na, nb))


def compare(cur: dict, old: dict) -> list[str]:
    """What changed from Classic Era, as a list of kinds (empty = unchanged). Both sides must
    already be folded (see fold_stats)."""
    kinds = []
    if cur["name"].lower() != old["name"].lower():
        kinds.append("name")
    for key in ("q", "ilvl", "req"):
        if cur[key] != old[key]:
            kinds.append(key)
    # Armor is compared as a total: Forever sometimes splits Classic's armor into base + bonus armor.
    no_armor = lambda s: {k: v for k, v in s.items() if k != "armor"}  # noqa: E731
    if no_armor(cur["stats"]) != no_armor(old["stats"]) or cur.get("other") != old.get("other"):
        kinds.append("stats")
    if (cur.get("armor") or 0) + cur["stats"].get("armor", 0) != (old.get("armor") or 0) + old["stats"].get("armor", 0):
        kinds.append("armor")
    cd, od = cur.get("dmg"), old.get("dmg")
    if cd and od and any(cd[k] != od[k] for k in ("min", "max", "speed")):
        kinds.append("dmg")  # only when both sides are known; "unknown" is not a change
    ce, oe = cur.get("spells", []), old.get("spells", [])
    if len(ce) != len(oe) or any(x["on"] != y["on"] or not _same_effect(x["text"], y["text"]) for x, y in zip(ce, oe)):
        kinds.append("effects")
    return kinds


def build_itemdb(latest_db: SpellDB, era_db: SpellDB, icons: dict[str, str], professions: list[dict]) -> int:
    cur = ClientItems(latest_db.build, latest_db)
    era = ClientItems(era_db.build, era_db)
    build = latest_db.build

    classes = {r["ClassID"]: r["ClassName_lang"] for r in load_table(build, "ItemClass")}
    subclasses = {(r["ClassID"], r["SubClassID"]): r["DisplayName_lang"] or r["VerboseName_lang"] for r in load_table(build, "ItemSubClass")}
    factions = {r["ID"]: r["Name_lang"] for r in load_table(build, "Faction")}
    skills = {r["ID"]: r["DisplayName_lang"] for r in load_table(build, "SkillLine")}
    item_sets = {r["ID"]: r for r in load_table(build, "ItemSet")}
    set_spells: dict[str, list[dict]] = {}
    for r in load_table(build, "ItemSetSpell"):
        set_spells.setdefault(r["ItemSetID"], []).append(r)

    # Races the game has: which mask bits mean "Alliance only" / "Horde only".
    playable = {r["ID"]: r for r in load_table(build, "ChrRaces") if int(num(r["PlayableRaceBit"])) >= 0}
    from build_data import CLASSES  # noqa: E402  (class ids in the game)
    races_json = __import__("json").loads((OUT / "races.json").read_text())
    game_races = [playable[str(r["id"])] for r in races_json if str(r["id"]) in playable]
    alliance = {int(r["PlayableRaceBit"]) for r in game_races if r["Alliance"] == "0"}
    horde = {int(r["PlayableRaceBit"]) for r in game_races if r["Alliance"] == "1"}
    all_classes = {1 << (int(c) - 1) for c in CLASSES}

    # Profession recipes: what creates an item, what uses it as a reagent.
    prof_by_line = {str(p["id"]): p for p in professions}
    reagents = {r["SpellID"]: r for r in load_table(build, "SpellReagents")}
    created_by: dict[str, list] = {}
    reagent_for: dict[str, list] = {}
    for r in load_table(build, "SkillLineAbility"):
        prof = prof_by_line.get(r["SkillLine"])
        sid = r["Spell"]
        if not prof or sid not in latest_db.names:
            continue
        ref = {"spell": int(sid), "name": latest_db.names[sid], "prof": prof["slug"], "profName": prof["name"]}
        makes = None
        for e in latest_db.effects.get(sid, {}).values():
            if e.get("Effect") == "24" and e.get("EffectItemType") not in ("", "0"):
                makes = e["EffectItemType"]
                created_by.setdefault(makes, []).append(ref)
                break
        rg = reagents.get(sid)
        if rg:
            for i in range(8):
                rid = rg.get(f"Reagent_{i}", "0")
                if rid not in ("0", "") and makes:
                    reagent_for.setdefault(rid, []).append({**ref, "makes": int(makes)})

    # Recipe items: "Use: Teaches you how to..." -> the item the taught recipe makes.
    def teaches(iid: str) -> int | None:
        for e in cur.effects.get(iid, []):
            if e["TriggerType"] == "6":  # learn: the effect's spell is the recipe itself
                for made in latest_db.effects.get(e["SpellID"], {}).values():
                    if made.get("Effect") == "24" and made.get("EffectItemType") not in ("", "0"):
                        return int(made["EffectItemType"])
            for eff in latest_db.effects.get(e["SpellID"], {}).values():
                if eff.get("Effect") == "36":  # LEARN_SPELL
                    for made in latest_db.effects.get(eff.get("EffectTriggerSpell", ""), {}).values():
                        if made.get("Effect") == "24" and made.get("EffectItemType") not in ("", "0"):
                            return int(made["EffectItemType"])
        return None

    def classic_match(iid: str, name: str) -> str | None:
        if iid in era.sparse:
            return iid
        same = era.by_name.get(name, [])
        return same[0] if len(same) == 1 else None

    rows, details, class_counts = [], {}, {}
    icon_index: dict[str, int] = {}
    for iid, r in cur.sparse.items():
        name = r["Display_lang"]
        it = cur.item.get(iid)
        if not name or not it or JUNK_ITEM.search(name) or it["ClassID"] in SKIP_CLASSES:
            continue
        cls, sub = int(it["ClassID"]), int(it["SubclassID"])
        icon = icons.get(it["IconFileDataID"], "inv_misc_questionmark")
        d = {"id": int(iid), "name": name, "icon": icon, "cls": cls, "sub": sub,
             "slot": int(num(r["InventoryType"])), **cur.numbers(iid)}
        spells = cur.spell_lines(iid)
        if spells:
            d["spells"] = spells
        other = []
        for i in range(10):
            stat = int(num(r[f"StatModifier_bonusStat_{i}"]))
            if stat < 0 or stat in FOREVER_STATS or not num(r[f"StatPercentEditor_{i}"]):
                continue
            other.append({"label": NAMED_NO_VALUE[stat]} if stat in NAMED_NO_VALUE else {"type": stat})
        if other:
            d["other"] = other
        if int(num(r["Bonding"])):
            d["bind"] = int(num(r["Bonding"]))
        if int(num(r["MaxCount"])) == 1:
            d["unique"] = True
        if int(num(r["Stackable"])) > 1:
            d["stack"] = int(num(r["Stackable"]))
        if int(num(r["ContainerSlots"])):
            d["bag"] = int(num(r["ContainerSlots"]))
        if int(num(r["SellPrice"])):
            d["sell"] = int(num(r["SellPrice"]))
        if r["Description_lang"]:
            d["flavor"] = r["Description_lang"]
        if int(num(r["StartQuestID"])):
            d["quest"] = True
        school = int(num(r["DamageType"]))
        if d.get("dmg") and school in DAMAGE_SCHOOL:
            d["school"] = DAMAGE_SCHOOL[school]
        if r["RequiredSkill"] not in ("", "0") and r["RequiredSkill"] in skills:
            d["skill"] = {"name": skills[r["RequiredSkill"]], "rank": int(num(r["RequiredSkillRank"]))}
        if r["MinFactionID"] not in ("", "0") and r["MinFactionID"] in factions:
            standing = int(num(r["MinReputation"]))
            d["rep"] = {"faction": factions[r["MinFactionID"]], "standing": STANDING[standing] if 0 <= standing < len(STANDING) else str(standing)}
        if int(num(r["RequiredPVPRank"])):
            d["pvpRank"] = int(num(r["RequiredPVPRank"]))
        mask = int(num(r["AllowableClass"]))
        if mask not in (-1, 0) and not all(mask & b for b in all_classes):
            d["classes"] = [CLASS_SLUGS[c] for c in sorted(CLASS_SLUGS) if mask & (1 << (c - 1))]
        race_mask = (int(num(r["AllowableRace_1"])) & 0xFFFFFFFF) << 32 | (int(num(r["AllowableRace_0"])) & 0xFFFFFFFF)
        if race_mask not in (0, (1 << 64) - 1):
            allowed = {b for b in alliance | horde if race_mask >> b & 1}
            if allowed == alliance:
                d["faction"] = "Alliance"
            elif allowed == horde:
                d["faction"] = "Horde"
            elif allowed and allowed != alliance | horde:
                d["races"] = sorted(r2["Name_lang"] for r2 in game_races if int(r2["PlayableRaceBit"]) in allowed)
        set_id = r["ItemSet"]
        if set_id not in ("", "0") and set_id in item_sets:
            s = item_sets[set_id]
            members = [m for m in (s.get(f"ItemID_{i}", "0") for i in range(17)) if m not in ("", "0") and m in cur.sparse]
            bonuses = [{"n": int(num(b["Threshold"])), "text": latest_db.render(b["SpellID"])}
                       for b in sorted(set_spells.get(set_id, []), key=lambda b: int(num(b["Threshold"])))
                       if b["SpellID"] in latest_db.desc]
            d["set"] = {"id": int(set_id), "name": s["Name_lang"], "items": [int(m) for m in members],
                        "bonuses": [b for b in bonuses if b["text"]]}
        if iid in created_by:
            d["createdBy"] = created_by[iid]
        if iid in reagent_for:
            d["reagentFor"] = reagent_for[iid][:40]
        taught = teaches(iid) if cls == 9 else None
        if taught:
            d["teaches"] = taught

        # Classic Era comparison.
        match = classic_match(iid, name)
        flag = 0
        if match is None:
            d["status"], flag = "new", 1
        else:
            old = {"name": era.sparse[match]["Display_lang"], **era.numbers(match)}
            old["stats"], old_spells = fold_stats(old["stats"], era.spell_lines(match))
            if old_spells:
                old["spells"] = old_spells
            cur_stats, cur_spells = fold_stats(d["stats"], d.get("spells", []))
            if cur_stats != d["stats"]:
                d["cmpStats"] = cur_stats  # Forever equip effects that are stats in disguise
            kinds = compare({**d, "stats": cur_stats, "spells": cur_spells}, old)
            if match != iid:
                d["classicId"] = int(match)
            if kinds:
                d["status"], d["changes"], flag = "changed", kinds, 2
                d["classic"] = {k: old[k] for k in ("name", "q", "ilvl", "req", "stats", "armor", "dmg", "spells") if k in old}
            else:
                d["status"] = "same"
        details[iid] = d
        class_counts[cls] = class_counts.get(cls, 0) + 1
        icon_i = icon_index.setdefault(icon, len(icon_index))
        rows.append([int(iid), name, d["q"], d["ilvl"], d["req"], cls, sub, d["slot"], icon_i, flag])

    # Resolve names for cross-references so pages don't need extra lookups.
    def ref(i: int) -> dict | None:
        x = details.get(str(i))
        return {"id": i, "name": x["name"], "q": x["q"], "icon": x["icon"]} if x else None

    for d in details.values():
        if "set" in d:
            d["set"]["items"] = [x for x in (ref(i) for i in d["set"]["items"]) if x]
        if "teaches" in d:
            d["teaches"] = ref(d["teaches"])
            if not d["teaches"]:
                del d["teaches"]
        for key in ("reagentFor",):
            for entry in d.get(key, []):
                made = ref(entry["makes"])
                if made:
                    entry["makes"] = made
                else:
                    entry.pop("makes")

    build_sets(build, era_db, latest_db, item_sets, set_spells, details, skills)

    # Items above the level cap (leftovers in the client files) go last in the default order.
    rows.sort(key=lambda row: (row[4] > LEVEL_CAP, -row[3], row[1]))
    write_json(OUT / "items" / "db" / "index.json", {
        "build": build, "classicBuild": era_db.build,
        "fields": ["id", "name", "q", "ilvl", "req", "cls", "sub", "slot", "icon", "flag"],
        "icons": list(icon_index), "rows": rows,
    })
    shards: dict[int, dict] = {}
    for iid, d in details.items():
        shards.setdefault(int(iid) % SHARDS, {})[iid] = d
    for n in range(SHARDS):
        write_json(OUT / "items" / "db" / "d" / f"{n}.json", shards.get(n, {}))
    write_json(OUT / "items" / "db" / "meta.json", {
        "shards": SHARDS,
        "classes": [{"id": int(c), "name": classes.get(str(c), f"Class {c}"), "count": class_counts[c],
                     "subs": sorted(({"id": s2, "name": subclasses.get((str(c), str(s2)), f"Type {s2}")}
                                     for s2 in {row[6] for row in rows if row[5] == c}), key=lambda x: x["name"])}
                    for c in sorted(class_counts, key=lambda c: classes.get(str(c), ""))],
    })
    return len(details)


RANGE = re.compile(r"(\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)")


def _same_bonus(cur: str, old: str) -> bool:
    """Classic Era bonus text vs Forever, ignoring what only differs in how the clients store it:
    - Forever's spell data has no die rolls, so Classic's "90 to 110" shows there as its middle, "100".
    - Forever often spells out a proc chance or cooldown that Classic's text leaves out ("has a chance").
      Extra numbers count as the same bonus as long as every Classic number is still there, in order."""
    def mid(m: re.Match) -> str:
        v = (float(m.group(1)) + float(m.group(2))) / 2
        return str(int(v)) if v == int(v) else str(v)
    old = RANGE.sub(mid, old)
    if _same_effect(cur, old):
        return True
    nc, no = _nums(cur), _nums(old)
    if len(no) >= len(nc):
        return False
    it = iter(nc)
    return all(any(x == y or "?" in (x, y) for y in it) for x in no)


def build_sets(build: str, era_db: SpellDB, latest_db: SpellDB, item_sets: dict, set_spells: dict,
               details: dict, skills: dict) -> None:
    """public/data/sets.json: every item set players can use, with its pieces, bonuses and what
    changed from Classic Era (bonuses by piece count, pieces added or removed)."""
    era_sets = {r["ID"]: r for r in load_table(era_db.build, "ItemSet")}
    era_spells: dict[str, list[dict]] = {}
    for r in load_table(era_db.build, "ItemSetSpell"):
        era_spells.setdefault(r["ItemSetID"], []).append(r)

    def members(row: dict) -> list[str]:
        return [m for m in (row.get(f"ItemID_{i}", "0") for i in range(17)) if m not in ("", "0")]

    def bonuses(rows: list[dict], db: SpellDB) -> list[dict]:
        out = [{"n": int(num(b["Threshold"])), "text": db.render(b["SpellID"])}
               for b in sorted(rows, key=lambda b: (int(num(b["Threshold"])), int(num(b["ID"]))))
               if b["SpellID"] in db.desc]
        return [b for b in out if b["text"]]

    out = []
    for sid, row in item_sets.items():
        pieces = [details[m] for m in members(row) if m in details]
        # Only sets a player can wear: at least one piece at or below the level cap.
        if not pieces or min(p["req"] for p in pieces) > LEVEL_CAP:
            continue
        cur_b = bonuses(set_spells.get(sid, []), latest_db)
        entry = {
            "id": int(sid), "name": row["Name_lang"],
            "items": [{"id": p["id"], "name": p["name"], "q": p["q"], "icon": p["icon"], "slot": p["slot"],
                       "ilvl": p["ilvl"], "req": p["req"], "cls": p["cls"], "sub": p["sub"]} for p in pieces],
            "bonuses": cur_b,
        }
        classes = sorted({c for p in pieces for c in p.get("classes", [])})
        if classes:
            entry["classes"] = classes
        if row.get("RequiredSkill") not in (None, "", "0") and row["RequiredSkill"] in skills:
            entry["skill"] = {"name": skills[row["RequiredSkill"]], "rank": int(num(row["RequiredSkillRank"]))}
        totals: dict[str, int] = {}
        armor = 0
        for p in pieces:
            for k, v in p.get("stats", {}).items():
                totals[k] = totals.get(k, 0) + v
            armor += p.get("armor") or 0
        entry["stats"] = totals
        if armor:
            entry["armor"] = armor

        old = era_sets.get(sid)
        if old is None:
            entry["status"] = "new"
        else:
            old_b = bonuses(era_spells.get(sid, []), era_db)
            by_n = lambda bs: {n: [b["text"] for b in bs if b["n"] == n] for n in {b["n"] for b in bs}}  # noqa: E731
            cn, on = by_n(cur_b), by_n(old_b)
            for b in cur_b:
                before = on.get(b["n"], [])
                if not any(_same_bonus(b["text"], t) for t in before):
                    b["status"] = "changed" if before else "new"
                    if before:
                        b["classic"] = before[0] if len(before) == 1 else " / ".join(before)
            removed = [b for b in old_b if not any(_same_bonus(t, b["text"]) for t in cn.get(b["n"], []))
                       and b["n"] not in cn]
            if removed:
                entry["removedBonuses"] = removed
            cur_ids, old_ids = {str(p["id"]) for p in pieces}, set(members(old))
            added = sorted(int(i) for i in cur_ids - old_ids)
            gone = sorted(int(i) for i in old_ids - cur_ids)
            if added:
                entry["addedItems"] = added
            if gone:
                entry["removedItems"] = gone
            changed = removed or added or gone or any("status" in b for b in cur_b)
            if old["Name_lang"] != row["Name_lang"]:
                entry["classicName"] = old["Name_lang"]
                changed = True
            entry["status"] = "changed" if changed else "same"
        out.append(entry)

    out.sort(key=lambda e: (-max(i["ilvl"] for i in e["items"]), e["name"]))
    write_json(OUT / "sets.json", {"build": build, "classicBuild": era_db.build, "sets": out})
