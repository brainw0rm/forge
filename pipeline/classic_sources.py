"""Where recipes come from in Classic Era, from the open-source CMaNGOS Classic database
(https://github.com/cmangos/classic-db, GPL v3): who drops a recipe item and how often, which
vendors sell it, which quests reward it, and at what skill trainers teach a recipe.

The game client doesn't carry any of this (loot, vendors and trainers live on Blizzard's servers),
and this is community-reconstructed Classic data, not Forever's: the site labels it as such and shows
it only for recipe items and recipes that Classic Era had. Zones come from the Classic Era client's
own map tables (UiMapAssignment), so a spawn position names the zone the game would.

Writes public/data/professions/sources-classic.json.
"""

from __future__ import annotations

import gzip
import urllib.request
from collections import defaultdict

from build_data import CACHE, OUT, load_table, num, write_json

DUMP_URL = "https://raw.githubusercontent.com/cmangos/classic-db/master/Full_DB/ClassicDB_1_12_1_z2815.sql.gz"
DUMP = CACHE / "cmangos" / "classicdb.sql.gz"
TABLES = {
    "creature_loot_template", "reference_loot_template", "gameobject_loot_template", "item_loot_template",
    "npc_vendor", "npc_vendor_template", "npc_trainer", "npc_trainer_template",
    "quest_template", "creature_template", "creature", "gameobject_template", "gameobject",
}
# A loot reference used by more creatures than this is a "world drop", not worth listing creature by creature.
WORLD_DROP = 12
MAX_DROPS = 12
RANKS = {1: "elite", 2: "rare elite", 3: "boss", 4: "rare"}


# --------------------------------------------------------------------------- SQL dump

def _rows(values: str):
    """Tuples of an extended INSERT's VALUES list, with quoted strings unescaped."""
    i, n = 0, len(values)
    while i < n:
        if values[i] != "(":
            i += 1
            continue
        i += 1
        row, cur, quoted = [], [], False
        while i < n:
            c = values[i]
            if quoted:
                if c == "\\":
                    cur.append(values[i + 1])
                    i += 2
                    continue
                if c == "'":
                    if i + 1 < n and values[i + 1] == "'":
                        cur.append("'")
                        i += 2
                        continue
                    quoted = False
                else:
                    cur.append(c)
            elif c == "'":
                quoted = True
            elif c == ",":
                row.append("".join(cur))
                cur = []
            elif c == ")":
                row.append("".join(cur))
                i += 1
                break
            else:
                cur.append(c)
            i += 1
        yield row


def read_dump() -> dict[str, list[dict[str, str]]]:
    if not DUMP.exists():
        DUMP.parent.mkdir(parents=True, exist_ok=True)
        print("  fetch CMaNGOS Classic DB")
        DUMP.write_bytes(urllib.request.urlopen(DUMP_URL, timeout=120).read())
    tables: dict[str, list[dict[str, str]]] = defaultdict(list)
    columns: dict[str, list[str]] = {}
    current = None
    with gzip.open(DUMP, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("CREATE TABLE `"):
                current = line.split("`")[1]
                columns[current] = []
            elif current and line.lstrip().startswith("`"):
                columns[current].append(line.split("`")[1])
            elif line.startswith(")"):
                current = None
            elif line.startswith("INSERT INTO `"):
                name = line.split("`")[1]
                if name in TABLES:
                    cols = columns[name]
                    for row in _rows(line[line.index("VALUES") + 6:]):
                        tables[name].append(dict(zip(cols, row)))
    return tables


# --------------------------------------------------------------------------- loot math

class Loot:
    """CMaNGOS loot rules: ungrouped rows roll on their own; one item per group drops, explicit
    chances first and the rest shared equally; a reference rolls its own template `maxcount` times."""

    def __init__(self, rows: list[dict[str, str]]):
        self.by_entry: dict[str, list[dict[str, str]]] = defaultdict(list)
        for r in rows:
            self.by_entry[r["entry"]].append(r)

    def chances(self, entry: str, refs: "Loot", depth: int = 0) -> dict[str, float]:
        """item id -> chance (0..1) to get it from one roll of this template."""
        out: dict[str, float] = defaultdict(float)
        if depth > 4:
            return out
        groups: dict[str, list[dict[str, str]]] = defaultdict(list)
        for r in self.by_entry.get(entry, []):
            if r["groupid"] not in ("", "0"):
                groups[r["groupid"]].append(r)
                continue
            p = abs(num(r["ChanceOrQuestChance"])) / 100
            self._add(out, r, p, refs, depth)
        for rows in groups.values():
            explicit = [r for r in rows if num(r["ChanceOrQuestChance"]) != 0]
            equal = [r for r in rows if num(r["ChanceOrQuestChance"]) == 0]
            rest = max(0.0, 100 - sum(abs(num(r["ChanceOrQuestChance"])) for r in explicit))
            for r in explicit:
                self._add(out, r, abs(num(r["ChanceOrQuestChance"])) / 100, refs, depth)
            for r in equal:
                self._add(out, r, rest / len(equal) / 100, refs, depth)
        return out

    @staticmethod
    def _add(out, r, p, refs, depth):
        ref = int(num(r["mincountOrRef"]))
        if ref < 0:
            rolls = max(1, int(num(r["maxcount"])))
            for item, q in refs.chances(str(-ref), refs, depth + 1).items():
                out[item] += 1 - (1 - p * q) ** rolls
        else:
            out[r["item"]] += p


# --------------------------------------------------------------------------- zones

class Zones:
    """Map position -> zone name, from the Classic Era client's own map data. Each zone map has one
    rectangle in world coordinates (UiMapAssignment), and neighbouring rectangles overlap; the zone's
    explored-area overlays (WorldMapOverlay) cover only its own land, so a position inside both
    rectangles goes to the zone whose overlays it falls on."""

    def __init__(self, era_build: str):
        ui = {r["ID"]: r for r in load_table(era_build, "UiMap")}
        self.maps = {r["ID"]: r["MapName_lang"] for r in load_table(era_build, "Map")}
        self.areas = {r["ID"]: r["AreaName_lang"] for r in load_table(era_build, "AreaTable")}
        art_maps: dict[str, list[str]] = defaultdict(list)
        for r in load_table(era_build, "UiMapXMapArt"):
            art_maps[r["UiMapArtID"]].append(r["UiMapID"])
        art_style = {r["ID"]: r["UiMapArtStyleID"] for r in load_table(era_build, "UiMapArt")}
        canvas = {r["UiMapArtStyleID"]: (num(r["LayerWidth"]), num(r["LayerHeight"]))
                  for r in load_table(era_build, "UiMapArtStyleLayer") if r["LayerIndex"] == "0"}
        # Overlay rectangles per zone map, in 0..1 of that map, with the subzone each one lights up. The
        # hit rectangle (where the map shows the subzone's name on mouseover) is tighter than the texture.
        self.overlays: dict[str, list[tuple[float, float, float, float, str]]] = defaultdict(list)
        for o in load_table(era_build, "WorldMapOverlay"):
            w, h = canvas.get(art_style.get(o["UiMapArtID"], ""), (0, 0))
            if not w or not h:
                continue
            if num(o["HitRectRight"]) > num(o["HitRectLeft"]) and num(o["HitRectBottom"]) > num(o["HitRectTop"]):
                px = (num(o["HitRectLeft"]), num(o["HitRectTop"]), num(o["HitRectRight"]), num(o["HitRectBottom"]))
            else:
                ox, oy = num(o["OffsetX"]), num(o["OffsetY"])
                px = (ox, oy, ox + num(o["TextureWidth"]), oy + num(o["TextureHeight"]))
            rect = (px[0] / w, px[1] / h, px[2] / w, px[3] / h, self.areas.get(o["AreaID_0"], ""))
            for ui_map in art_maps.get(o["UiMapArtID"], []):
                self.overlays[ui_map].append(rect)
        self.boxes: dict[str, list[tuple[float, float, float, float, float, str, str]]] = defaultdict(list)
        for a in load_table(era_build, "UiMapAssignment"):
            m = ui.get(a["UiMapID"])
            if not m or m.get("Type") not in ("3", "4", "5"):  # zone, dungeon, micro-dungeon
                continue
            x0, y0, x1, y1 = (num(a[f"Region_{i}"]) for i in (0, 1, 3, 4))
            area = (x1 - x0) * (y1 - y0)
            if area > 0:
                self.boxes[a["MapID"]].append((x0, y0, x1, y1, area, m["Name_lang"], a["UiMapID"]))

        self.zone_names = {b[5] for boxes in self.boxes.values() for b in boxes}

    def _fit(self, box, x: float, y: float) -> tuple[float, str] | None:
        """How specifically this zone claims the point (the world area of its smallest overlay that
        covers it) and that overlay's subzone. Cities have no overlays and claim their whole (small)
        rectangle. None: not this zone's land."""
        x0, y0, x1, y1, area, _, ui_map = box
        rects = self.overlays.get(ui_map)
        if not rects:
            return area, ""
        # World X points north and Y west; the map's u grows east and v south.
        u, v = (y1 - y) / (y1 - y0), (x1 - x) / (x1 - x0)
        hits = [((c - a) * (d - b) * area, sub) for a, b, c, d, sub in rects if a <= u <= c and b <= v <= d]
        return min(hits) if hits else None

    def at(self, map_id: str, x: float, y: float) -> str | None:
        """"Subzone, Zone" where the map knows the subzone, else the zone (or the dungeon)."""
        boxes = [b for b in self.boxes.get(map_id, []) if b[0] <= x <= b[2] and b[1] <= y <= b[3]]
        if boxes:
            fits = [(f, b) for b in boxes if (f := self._fit(b, x, y)) is not None]
            if not fits:
                return min(boxes, key=lambda b: b[4])[5]
            (_, sub), box = min(fits, key=lambda fb: fb[0][0])
            if sub in self.zone_names:  # a city drawn on its surrounding zone's map ("Stormwind City")
                return sub
            return f"{sub}, {box[5]}" if sub and sub != box[5] else box[5]
        return self.maps.get(map_id) if map_id not in ("0", "1") else None


def faction_of(templates: dict[str, dict[str, str]], faction: str) -> str | None:
    t = templates.get(faction)
    if not t:
        return None
    group = int(num(t["FactionGroup"]))
    if group & 2 and not group & 4:
        return "Alliance"
    if group & 4 and not group & 2:
        return "Horde"
    return None


def pct(p: float) -> float:
    """Chance in percent, rounded like loot sites do: 2 significant digits below 1%, else 1 decimal."""
    v = p * 100
    return float(f"{v:.2g}") if v < 1 else round(v, 1)


# --------------------------------------------------------------------------- build

def build_classic_sources(era_build: str, era_db, recipe_items: set[str], recipe_spells: set[str]) -> int:
    t = read_dump()
    zones = Zones(era_build)
    faction_templates = {r["ID"]: r for r in load_table(era_build, "FactionTemplate")}
    creatures = {r["Entry"]: r for r in t["creature_template"]}
    objects = {r["entry"]: r for r in t["gameobject_template"]}

    def spawn_zones(spawns: list[tuple[str, float, float]]) -> list[str]:
        counts: dict[str, int] = defaultdict(int)
        for m, x, y in spawns:
            z = zones.at(m, x, y)
            if z:
                counts[z] += 1
        return [z for z, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:3]]

    creature_spawns: dict[str, list] = defaultdict(list)
    for r in t["creature"]:
        creature_spawns[r["id"]].append((r["map"], num(r["position_x"]), num(r["position_y"])))
    object_spawns: dict[str, list] = defaultdict(list)
    for r in t["gameobject"]:
        object_spawns[r["id"]].append((r["map"], num(r["position_x"]), num(r["position_y"])))

    refs = Loot(t["reference_loot_template"])
    creature_loot = Loot(t["creature_loot_template"])
    object_loot = Loot(t["gameobject_loot_template"])
    out: dict[str, dict] = defaultdict(dict)

    # Which references each creature uses, to tell world drops (shared by many) from real drops.
    ref_users: dict[str, int] = defaultdict(int)
    for loot_id, rows in creature_loot.by_entry.items():
        for r in rows:
            if int(num(r["mincountOrRef"])) < 0:
                ref_users[str(-int(num(r["mincountOrRef"])))] += 1

    def world_refs(entry: str, seen: set[str], depth: int = 0) -> set[str]:
        """Items reachable only through widely shared references from this template."""
        items = set()
        for r in refs.by_entry.get(entry, []):
            ref = int(num(r["mincountOrRef"]))
            if ref < 0 and depth < 4:
                items |= world_refs(str(-ref), seen, depth + 1)
            else:
                items.add(r["item"])
        return items

    world_items: set[str] = set()
    for ref, users in ref_users.items():
        if users > WORLD_DROP:
            world_items |= world_refs(ref, set())
    world_items &= recipe_items

    drops: dict[str, list] = defaultdict(list)
    world: dict[str, list] = defaultdict(list)
    for entry, c in creatures.items():
        loot_id = c.get("LootId", "0")
        if loot_id in ("", "0") or loot_id not in creature_loot.by_entry:
            continue
        for item, p in creature_loot.chances(loot_id, refs).items():
            if item not in recipe_items or p <= 0:
                continue
            lvl = (int(num(c["MinLevel"])), int(num(c["MaxLevel"])))
            if item in world_items:
                world[item].append((lvl, p))
            else:
                drops[item].append({
                    "n": c["Name"], "lvl": f"{lvl[0]}" if lvl[0] == lvl[1] else f"{lvl[0]}-{lvl[1]}",
                    **({"rank": RANKS[int(num(c["Rank"]))]} if int(num(c["Rank"])) in RANKS else {}),
                    "zones": spawn_zones(creature_spawns.get(entry, [])), "chance": pct(p),
                })
    for item, lst in drops.items():
        lst.sort(key=lambda d: -d["chance"])
        out[item]["drops"] = lst[:MAX_DROPS]
        if len(lst) > MAX_DROPS:
            out[item]["moreDrops"] = len(lst) - MAX_DROPS
    for item, lst in world.items():
        levels = [l for l, _ in lst]
        chances = [p for _, p in lst]
        out[item]["world"] = {"creatures": len(lst), "lvl": [min(l[0] for l in levels), max(l[1] for l in levels)],
                              "chance": [pct(min(chances)), pct(max(chances))]}

    # Containers and other objects (chests, footlockers).
    for entry, o in objects.items():
        loot_id = o.get("data1", "0") if o.get("type") == "3" else "0"  # chest: data1 = loot id
        if loot_id in ("", "0") or loot_id not in object_loot.by_entry:
            continue
        for item, p in object_loot.chances(loot_id, refs).items():
            if item in recipe_items and p > 0:
                out[item].setdefault("objects", []).append(
                    {"n": o["name"], "zones": spawn_zones(object_spawns.get(entry, [])), "chance": pct(p)})

    # Vendors: their own list, or a shared vendor template.
    templ_items: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in t["npc_vendor_template"]:
        templ_items[r["entry"]].append(r)
    sold: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in t["npc_vendor"]:
        sold[r["entry"]].append(r)
    for entry, c in creatures.items():
        rows = sold.get(entry, []) + templ_items.get(c.get("VendorTemplateId", "0"), [])
        for r in rows:
            if r["item"] in recipe_items:
                v = {"n": c["Name"], "zones": spawn_zones(creature_spawns.get(entry, []))}
                if c.get("SubName"):
                    v["sub"] = c["SubName"]
                fac = faction_of(faction_templates, c.get("Faction", ""))
                if fac:
                    v["faction"] = fac
                if int(num(r["maxcount"])) > 0:
                    v["limited"] = True
                if v not in out[r["item"]].get("vendors", []):
                    out[r["item"]].setdefault("vendors", []).append(v)

    # Quest rewards.
    races_alliance, races_horde = 1 | 4 | 8 | 64, 2 | 16 | 32 | 128
    for q in t["quest_template"]:
        rewards = {q.get(f"RewChoiceItemId{i}") for i in range(1, 7)} | {q.get(f"RewItemId{i}") for i in range(1, 5)}
        for item in rewards & recipe_items:
            zone_id = int(num(q["ZoneOrSort"]))
            races = int(num(q["RequiredRaces"]))
            entry = {"t": q["Title"], "lvl": int(num(q["QuestLevel"]))}
            if zone_id > 0 and zones.areas.get(str(zone_id)):
                entry["zone"] = zones.areas[str(zone_id)]
            if races and not races & races_horde:
                entry["faction"] = "Alliance"
            elif races and not races & races_alliance:
                entry["faction"] = "Horde"
            out[item].setdefault("quests", []).append(entry)

    # Trainers: the skill and price a recipe is taught at. Trainer spells are usually the "teach" spell,
    # which learns the recipe through a LEARN_SPELL effect.
    teaches = {}
    for sid, effs in era_db.effects.items():
        for e in effs.values():
            if e.get("Effect") == "36" and e.get("EffectTriggerSpell") not in ("", "0"):
                teaches[sid] = e["EffectTriggerSpell"]
    trainer_templates: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in t["npc_trainer_template"]:
        trainer_templates[r["entry"]].append(r)
    trainer_rows = list(t["npc_trainer"])
    for c in creatures.values():
        trainer_rows += trainer_templates.get(c.get("TrainerTemplateId", "0"), [])
    trained: dict[str, dict] = {}
    for r in trainer_rows:
        spell = teaches.get(r["spell"], r["spell"])
        if spell not in recipe_spells:
            continue
        skill, cost = int(num(r["reqskillvalue"])), int(num(r["spellcost"]))
        have = trained.get(spell)
        if not have or skill < have["skill"]:
            trained[spell] = {"skill": skill, "cost": cost}

    payload = {
        "source": "CMaNGOS Classic DB (github.com/cmangos/classic-db), GPL v3",
        "items": {k: v for k, v in sorted(out.items(), key=lambda kv: int(kv[0])) if v},
        "trainers": dict(sorted(trained.items(), key=lambda kv: int(kv[0]))),
    }
    write_json(OUT / "professions" / "sources-classic.json", payload)
    return len(payload["items"])
