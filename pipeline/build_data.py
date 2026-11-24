#!/usr/bin/env python3
"""Build the site's JSON data from WoW client DB2 tables exported by wago.tools.

Usage:
    python3 pipeline/build_data.py            # fetch (cached) + build
    python3 pipeline/build_data.py --refresh  # re-discover the latest beta builds

Outputs go to public/data/. Raw CSVs are cached in pipeline/.cache/<build>/.
Only the Python standard library is used so this runs anywhere (CI included).
"""

from __future__ import annotations

import ast
import csv
import json
import math
import operator
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / ".cache"
OUT = ROOT / "public" / "data"

WAGO = "https://wago.tools"
# Forever client versions are 1.60.x during the beta. The release may bump the minor version, so
# any 1.x with a minor version of 60 or more counts (Classic Era is 1.15).
FOREVER_VERSION = re.compile(r"^1\.(\d+)\.")
# wago.tools product keys of test realms (beta, PTR, ...). Forever builds from any other product are live.
TEST_PRODUCT = re.compile(r"beta|ptr|test|alpha|^wowt$|^wowz$|xptr", re.I)


def is_forever(version: str) -> bool:
    m = FOREVER_VERSION.match(version)
    return bool(m) and int(m.group(1)) >= 60
CLASSIC_ERA_PRODUCT = "wow_classic_era"
MAX_HISTORY = 8  # how many recent Forever builds meta.json lists

# Tables needed to resolve spell tooltips (recipe effects, ranks, item effects).
SPELL_TABLES = [
    "Talent", "TalentTab", "SpellName", "Spell", "SpellMisc", "SpellEffect",
    "SpellDuration", "SpellRadius", "SpellAuraOptions", "SpellRange",
    "SpellCooldowns", "SpellTargetRestrictions",
]

# Extra tables only needed for the newest build.
LATEST_TABLES = ["ManifestInterfaceData", "CharBaseInfo", "ChrRaces", "ChrClasses", "SkillLineAbility", "SpellLevels",
                 "SkillLine", "ItemSparse", "Item", "RandPropPoints",
                 "ItemDamageOneHand", "ItemDamageTwoHand", "ItemDamageOneHandCaster", "ItemDamageTwoHandCaster",
                 "ItemArmorTotal", "ItemArmorQuality", "ItemArmorShield", "ArmorLocation", "SpellReagents"]

CLASSES = {
    1: ("warrior", "Warrior"),
    2: ("paladin", "Paladin"),
    3: ("hunter", "Hunter"),
    4: ("rogue", "Rogue"),
    5: ("priest", "Priest"),
    7: ("shaman", "Shaman"),
    8: ("mage", "Mage"),
    9: ("warlock", "Warlock"),
    11: ("druid", "Druid"),
}

ALLIANCE = {1, 3, 4, 7, 95}
HORDE = {2, 5, 6, 8, 96}
PLAYABLE_RACES = sorted(ALLIANCE | HORDE)


# --------------------------------------------------------------------------- fetch

def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "forever-forge-pipeline/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - retry any network hiccup
            if attempt == 3:
                raise
            print(f"  retry {url}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def discover_builds(refresh: bool) -> tuple[list[str], str, str]:
    """Return (Forever builds oldest->newest, latest Classic Era build, phase).

    Phase is "beta" until a Forever build shows up under a live (non-test) product; from then on
    only live builds are used, so a later PTR doesn't replace what players actually have.
    FOREVER_PHASE=beta|live overrides the detection (e.g. if wago names the live product oddly)."""
    path = CACHE / "builds.json"
    if refresh or not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(http_get(f"{WAGO}/api/builds"))
    products = json.loads(path.read_text())
    live, test = set(), set()
    for product, builds in products.items():
        for b in builds:
            if is_forever(b["version"]):
                (test if TEST_PRODUCT.search(product) else live).add(b["version"])
    phase = os.environ.get("FOREVER_PHASE") or ("live" if live else "beta")
    num = lambda v: int(v.rsplit(".", 1)[1])  # noqa: E731
    if phase == "live" and live:
        # Keep the beta builds from before launch as history (so the changelog shows beta -> release),
        # but never a test build newer than the first live one (a PTR of the next patch).
        first_live = min(num(v) for v in live)
        pool = live | {v for v in test if num(v) < first_live}
    else:
        pool = test or live
    ordered = sorted(pool, key=num)[-MAX_HISTORY:]
    era = products[CLASSIC_ERA_PRODUCT][0]["version"]
    return ordered, era, phase


def load_table(build: str, table: str) -> list[dict[str, str]]:
    path = CACHE / build / f"{table}.csv"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"  fetch {build} {table}")
        data = http_get(f"{WAGO}/db2/{table}/csv?build={build}")
        if data.lstrip().startswith(b"{"):
            raise RuntimeError(f"wago.tools error for {table}@{build}: {data[:200]!r}")
        path.write_bytes(data)
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader, [])
        rows = list(reader)
    if header and all(h.startswith("Field_") for h in header):
        header = _borrow_header(table, len(header)) or header
    return [dict(zip(header, r)) for r in rows]


def _borrow_header(table: str, width: int) -> list[str] | None:
    """wago.tools lacks column names for some early builds' tables; reuse a newer build's
    header when the layout has the same number of columns."""
    for other in sorted(CACHE.glob(f"*/{table}.csv"), reverse=True):
        with other.open(newline="", encoding="utf-8") as f:
            header = next(csv.reader(f), [])
        if len(header) == width and not any(h.startswith("Field_") for h in header):
            return header
    return None


# --------------------------------------------------------------------------- spell db

def num(v: str | None) -> float:
    try:
        return float(v) if v not in (None, "") else 0.0
    except ValueError:
        return 0.0


def fmt(x: float) -> str:
    if abs(x - round(x)) < 1e-6:
        return str(int(round(x)))
    return f"{x:.2f}".rstrip("0").rstrip(".")


def fmt_duration(ms: float) -> str:
    s = ms / 1000
    if s >= 3600 and s % 3600 == 0:
        h = s / 3600
        return f"{fmt(h)} hour" + ("s" if h != 1 else "")
    if s >= 60 and s % 60 == 0:
        m = s / 60
        return f"{fmt(m)} min"
    return f"{fmt(s)} sec"


GAME_CODES = [
    (re.compile(r"\|c[0-9a-fA-F]{8}", re.I), ""),          # |cAARRGGBB: start color
    (re.compile(r"\|r", re.I), ""),                         # |r: end color
    (re.compile(r"\|T[^|]*\|t", re.I), ""),                 # |T...|t: inline texture
    (re.compile(r"\|H[^|]*\|h(.*?)\|h", re.I), r"\1"),    # |H...|h text |h: link, keep text
    (re.compile(r"\|n", re.I), "\n"),                      # |n: newline
]


def game_text(text: str) -> str:
    """Tooltip text as players read it: the client's color/texture/link escape codes removed,
    Windows line breaks and indentation normalized, at most one blank line in a row."""
    text = text.replace("||", "\0")
    for pattern, repl in GAME_CODES:
        text = pattern.sub(repl, text)
    text = text.replace("\0", "|").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"(?<=[^\s.:!?])\n(?=[a-z0-9(%+-])", " ", text)  # hard-wrapped sentence: rejoin
    return re.sub(r"\n{3,}", "\n\n", text).strip()


class SpellDB:
    def __init__(self, build: str):
        self.build = build
        self.hides_values = is_forever(build)
        t = {name: load_table(build, name) for name in SPELL_TABLES}
        self.talents = t["Talent"]
        self.tabs = t["TalentTab"]
        self.names = {r["ID"]: r["Name_lang"] for r in t["SpellName"]}
        self.desc = {r["ID"]: r["Description_lang"] for r in t["Spell"]}
        self.misc = {r["SpellID"]: r for r in t["SpellMisc"] if r["DifficultyID"] == "0"}
        self.effects: dict[str, dict[int, dict[str, str]]] = {}
        for r in t["SpellEffect"]:
            if r["DifficultyID"] != "0":
                continue
            self.effects.setdefault(r["SpellID"], {})[int(r["EffectIndex"]) + 1] = r
        self.durations = {r["ID"]: r for r in t["SpellDuration"]}
        self.radius = {r["ID"]: r for r in t["SpellRadius"]}
        self.aura = {r["SpellID"]: r for r in t["SpellAuraOptions"] if r["DifficultyID"] == "0"}
        self.ranges = {r["ID"]: r for r in t["SpellRange"]}
        self.cooldowns = {r["SpellID"]: r for r in t["SpellCooldowns"] if r["DifficultyID"] == "0"}
        self.targets = {r["SpellID"]: r for r in t["SpellTargetRestrictions"] if r["DifficultyID"] == "0"}

    # ---- raw values -------------------------------------------------------
    def effect(self, sid: str, idx: int) -> dict[str, str]:
        return self.effects.get(sid, {}).get(idx, {})

    def duration_ms(self, sid: str) -> float:
        m = self.misc.get(sid)
        if not m:
            return 0.0
        return num(self.durations.get(m["DurationIndex"], {}).get("Duration"))

    @staticmethod
    def points(e: dict[str, str], maximum: bool = False) -> float:
        """Effect base points. Classic Era clients still use base + die-roll columns."""
        if "EffectDieSides" in e:
            dice = num(e.get("EffectDieSides"))
            return num(e.get("EffectBasePoints")) + (dice if maximum else min(dice, 1))
        return num(e.get("EffectBasePointsF"))

    def has(self, sid: str) -> bool:
        return sid in self.names and bool(self.desc.get(sid))

    def value(self, sid: str, letter: str, idx: int, signed: bool = False) -> float | str | None:
        """Resolve a single $<letter><idx> variable; numbers are raw, 'd' is a string.
        Plain $s1 shows magnitudes; inside ${...} Blizzard negates explicitly, so keep sign."""
        e = self.effect(sid, idx or 1)
        l = letter.lower()
        override = self.override.get(idx or 1) if sid == self.override_sid else None
        if l in ("s", "m"):
            v = override if override is not None else self.points(e, maximum=letter == "M")
            v = v if signed else abs(v)
            # The beta client ships some talent spells with zeroed values (filled in
            # by server hotfixes we can't see). Show them as unknown, not as 0.
            return "?" if v == 0 and self.hides_values else v
        if l == "d":
            return fmt_duration(self.duration_ms(sid))
        if l == "t":
            return num(e.get("EffectAuraPeriod")) / 1000
        if l == "o":
            period = num(e.get("EffectAuraPeriod"))
            ticks = self.duration_ms(sid) / period if period else 1
            return abs(override if override is not None else self.points(e)) * ticks
        if l == "a":
            return num(self.radius.get(e.get("EffectRadiusIndex_0", ""), {}).get("Radius"))
        if l == "h":
            return num(self.aura.get(sid, {}).get("ProcChance"))
        if l == "n":
            return num(self.aura.get(sid, {}).get("ProcCharges"))
        if l == "u":
            return num(self.aura.get(sid, {}).get("CumulativeAura"))
        if l == "x":
            return num(e.get("EffectChainTargets"))
        if l == "b":
            return num(e.get("EffectPointsPerResource"))
        if l == "e":
            return num(e.get("EffectAmplitude"))
        if l == "q":
            return num(e.get("EffectMiscValue_0"))
        if l == "i":
            return num(self.targets.get(sid, {}).get("MaxTargets"))
        if l == "r":
            m = self.misc.get(sid)
            return num(self.ranges.get(m["RangeIndex"], {}).get("RangeMax_0")) if m else 0.0
        return None

    def effect_keys(self, sid: str) -> list[tuple[int, int, int]]:
        """What a spell does, per effect: (effect type, aura type, misc value such as the stat or school)."""
        return sorted(
            (int(num(e.get("Effect"))), int(num(e.get("EffectAura"))), int(num(e.get("EffectMiscValue_0"))))
            for e in self.effects.get(sid, {}).values()
        )

    def cooldown_ms(self, sid: str) -> float:
        c = self.cooldowns.get(sid)
        if not c:
            return 0.0
        return max(num(c["RecoveryTime"]), num(c["CategoryRecoveryTime"]))

    # ---- tooltip rendering ------------------------------------------------
    VAR = re.compile(r"(\d*)([a-zA-Z])(\d?)")

    override: dict[int, float] = {}
    override_sid = ""

    def render(self, sid: str, depth: int = 0, overrides: dict[int, float] | None = None) -> str:
        """Render a tooltip. `overrides` replaces effect base points ({effect index: value}),
        which is how trait ranks change a talent's numbers."""
        text = self.desc.get(sid, "") or ""
        if depth == 0:
            self.override, self.override_sid = overrides or {}, sid
        try:
            rendered = self._render(text, sid, depth)
            return game_text(rendered) if depth == 0 else rendered
        finally:
            if depth == 0:
                self.override, self.override_sid = {}, ""

    def _render(self, text: str, sid: str, depth: int) -> str:
        out: list[str] = []
        i = 0
        last_num: float | None = None
        while i < len(text):
            ch = text[i]
            if ch != "$":
                out.append(ch)
                i += 1
                continue
            i += 1
            if i >= len(text):
                break
            c = text[i]
            if c == "{":  # ${expr}[.N]
                end = _match(text, i, "{", "}")
                expr = text[i + 1:end]
                i = end + 1
                decimals = None
                m = re.match(r"\.(\d)", text[i:])
                if m:
                    decimals = int(m.group(1))
                    i += 2
                v = self._eval(expr, sid)
                if v is None:
                    out.append("?")
                else:
                    last_num = v
                    out.append(f"{v:.{decimals}f}" if decimals is not None else fmt(v))
            elif c == "?":  # $?cond[a][b]... -> choose the final (default) branch
                j = i + 1
                while j < len(text) and text[j] not in "[":
                    j += 1
                branches = []
                while j < len(text) and text[j] == "[":
                    end = _match(text, j, "[", "]")
                    branches.append(text[j + 1:end])
                    j = end + 1
                    # chained conditions: $?a[x]?b[y][z]
                    while j < len(text) and text[j] not in "[" and text[j] in "?!|&0123456789asS":
                        j += 1
                i = j
                if branches:
                    out.append(self._render(branches[-1], sid, depth))
            elif c in "/*":  # $/10;s1  $*2;s1
                m = re.match(r"[/*]([\d.]+);(\d*)([a-zA-Z])(\d?)", text[i:])
                if not m:
                    out.append("$")
                    continue
                i += m.end()
                v = self._var(m.group(2) or sid, m.group(3), int(m.group(4) or 1), depth)
                if v == "?":
                    out.append("?")
                elif isinstance(v, (int, float)):
                    div = float(m.group(1))
                    v = v / div if c == "/" else v * div
                    last_num = v
                    out.append(fmt(v))
                else:
                    out.append("?")
            elif c == "@":  # $@spelldesc123 / $@spellname123
                m = re.match(r"@(spelldesc|spellname|spellaura)(\d+)", text[i:])
                if m:
                    i += m.end()
                    ref = m.group(2)
                    if m.group(1) == "spellname":
                        out.append(self.names.get(ref, ""))
                    elif depth < 3:
                        out.append(self.render(ref, depth + 1))
                else:
                    m = re.match(r"@\w+", text[i:])
                    i += m.end() if m else 0
            elif c in "lLgG" and re.match(r"[lLgG][^;:$]*:[^;]*;", text[i:]):
                m = re.match(r"[lLgG]([^;:$]*):([^;]*);", text[i:])
                i += m.end()
                if c in "lL":
                    out.append(m.group(1) if last_num == 1 else m.group(2))
                else:
                    out.append(m.group(1))
            else:
                m = self.VAR.match(text, i)
                if not m:
                    out.append("$")
                    continue
                # named variables like $proccooldown
                word = re.match(r"[a-zA-Z]{3,}", text[i:])
                if word and not m.group(1):
                    i += word.end()
                    if word.group(0) == "proccooldown":
                        v = num(self.aura.get(sid, {}).get("ProcCategoryRecovery")) / 1000
                        # Most texts write "$proccooldown sec" themselves; don't add a second "sec".
                        out.append(fmt(v) if re.match(r"\s*sec\b", text[i:]) else fmt(v) + " sec")
                    continue
                i = m.end()
                v = self._var(m.group(1) or sid, m.group(2), int(m.group(3) or 1), depth)
                if isinstance(v, (int, float)):
                    last_num = v
                    out.append(fmt(v))
                else:
                    out.append(v if v is not None else "?")
        return "".join(out)

    def _var(self, sid: str, letter: str, idx: int, depth: int):
        # Classic Era effects with a die roll: the client shows $s as "min to max" (e.g.
        # "Restores 1350 to 2250 mana."), unless the text spells out the maximum itself ($m).
        if letter == "s" and not (sid == self.override_sid and (idx or 1) in self.override):
            e = self.effect(sid, idx or 1)
            dice = num(e.get("EffectDieSides")) if "EffectDieSides" in e else 0
            if dice > 1 and f"$m{idx or 1}" not in self.desc.get(sid, "").lower():
                base = num(e.get("EffectBasePoints"))
                lo, hi = sorted((abs(base + 1), abs(base + dice)))
                return f"{fmt(lo)} to {fmt(hi)}"
        return self.value(sid, letter, idx)

    def _eval(self, expr: str, sid: str) -> float | None:
        def sub(m: re.Match) -> str:
            v = self.value(m.group(1) or sid, m.group(2), int(m.group(3) or 1), signed=True)
            if v == "?":
                raise _Unknown
            if isinstance(v, str):
                # duration string inside an expression -> seconds
                return str(self.duration_ms(m.group(1) or sid) / 1000)
            return repr(v if v is not None else 0.0)

        try:
            py = re.sub(r"\$(\d*)([a-zA-Z])(\d?)", sub, expr)
        except _Unknown:
            return None
        py = py.replace("<", " < ").replace(">", " > ")
        try:
            return float(_safe_eval(ast.parse(py.strip(), mode="eval").body))
        except Exception:  # noqa: BLE001 - malformed Blizzard expression
            return None


class _Unknown(Exception):
    pass


def _match(text: str, start: int, open_: str, close: str) -> int:
    depth = 0
    for j in range(start, len(text)):
        if text[j] == open_:
            depth += 1
        elif text[j] == close:
            depth -= 1
            if depth == 0:
                return j
    return len(text) - 1


_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
        ast.Div: operator.truediv, ast.USub: operator.neg, ast.UAdd: operator.pos,
        ast.Lt: operator.lt, ast.Gt: operator.gt, ast.LtE: operator.le, ast.GtE: operator.ge}
_FUNCS = {"max": max, "min": min, "floor": math.floor, "ceil": math.ceil, "abs": abs,
          "cond": lambda c, a, b: a if c else b, "gt": lambda a, b: a > b, "lt": lambda a, b: a < b}


def _safe_eval(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.BinOp):
        return _OPS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp):
        return _OPS[type(node.op)](_safe_eval(node.operand))
    if isinstance(node, ast.Compare) and len(node.ops) == 1:
        return _OPS[type(node.ops[0])](_safe_eval(node.left), _safe_eval(node.comparators[0]))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS:
        return _FUNCS[node.func.id](*[_safe_eval(a) for a in node.args])
    raise ValueError(f"unsupported expression node {ast.dump(node)}")


# --------------------------------------------------------------------------- talents

def icon_names(build: str) -> dict[str, str]:
    rows = load_table(build, "ManifestInterfaceData")
    out = {}
    for r in rows:
        if "icons" in r["FilePath"].lower():
            out[r["ID"]] = r["FileName"].rsplit(".", 1)[0].lower()
    return out


# --------------------------------------------------------------------------- main

def build_races(build: str, era_build: str):
    races = {r["ID"]: r for r in load_table(build, "ChrRaces")}
    combos = {(int(r["RaceID"]), int(r["ClassID"])) for r in load_table(build, "CharBaseInfo")}
    era_combos = {(int(r["RaceID"]), int(r["ClassID"])) for r in load_table(era_build, "CharBaseInfo")}
    out = []
    for rid in PLAYABLE_RACES:
        r = races.get(str(rid))
        if not r:
            continue
        out.append({
            "id": rid,
            "name": r["Name_lang"],
            "faction": "alliance" if rid in ALLIANCE else "horde",
            "lore": r.get("LoreDescription_lang", ""),
            "classes": [
                {"id": cid, "status": "new" if (rid, cid) not in era_combos else "classic"}
                for cid in CLASSES if (rid, cid) in combos
            ],
        })
    return out


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))


def main() -> None:
    refresh = "--refresh" in sys.argv
    builds, era_build, phase = discover_builds(refresh)
    if not builds:
        sys.exit("No Forever (1.60.x) builds found on wago.tools")
    latest = builds[-1]
    print(f"Forever builds ({phase}): {', '.join(builds)}\nClassic Era: {era_build}")

    for name in LATEST_TABLES:
        load_table(latest, name)

    latest_db = SpellDB(latest)
    era_db = SpellDB(era_build)
    icons = icon_names(latest)

    write_json(OUT / "races.json", build_races(latest, era_build))  # the item database reads it

    # Imported here: they import helpers from this module.
    import extras
    import itemdb
    n_prof = extras.build_professions(latest_db, era_build, icons)
    n_db = itemdb.build_itemdb(latest_db, era_db, icons, json.loads((OUT / "professions" / "index.json").read_text()))
    # Where recipes come from in Classic Era (the client has no loot, vendor or trainer data).
    import classic_sources
    recipe_items, recipe_spells = set(), set()
    for p in json.loads((OUT / "professions" / "index.json").read_text()):
        for r in json.loads((OUT / "professions" / f"{p['slug']}.json").read_text())["recipes"]:
            recipe_spells.add(str(r["spell"]))
            recipe_items |= {str(i["id"]) for i in r.get("learnedFrom", [])}
    try:
        n_src = classic_sources.build_classic_sources(era_build, era_db, recipe_items, recipe_spells)
    except OSError as err:  # the dump moved or GitHub is down: keep the last file rather than fail the job
        print(f"Classic sources not rebuilt ({err}); keeping the previous file")
        n_src = "the previous"
    write_json(OUT / "meta.json", {
        "build": latest, "classicBuild": era_build, "builds": builds, "phase": phase,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "classes": [{"id": cid, "slug": slug, "name": name} for cid, (slug, name) in CLASSES.items()],
    })
    print(f"Wrote {n_prof} professions, {n_db} items and Classic sources for {n_src} recipe items -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
