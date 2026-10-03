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
import difflib
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
MAX_HISTORY = 8  # how many Forever builds to include in the changelog

# Tables needed to resolve talent tooltips.
SPELL_TABLES = [
    "Talent", "TalentTab", "SpellName", "Spell", "SpellMisc", "SpellEffect",
    "SpellDuration", "SpellRadius", "SpellAuraOptions", "SpellRange",
    "SpellCooldowns", "SpellTargetRestrictions",
]
# Forever's talents live in the modern trait system (the old Talent table in the
# Forever client is stale). Rank values come from per-rank curves.
TRAIT_TABLES = [
    "TraitTree", "TraitNode", "TraitNodeEntry", "TraitDefinition", "TraitEdge",
    "TraitNodeXTraitNodeEntry", "TraitNodeGroupXTraitNode", "TraitCond", "TraitNodeGroupXTraitCond",
    "TraitTreeXTraitCurrency", "TraitCurrency", "TraitCurrencySource", "TraitDefinitionEffectPoints",
    "CurvePoint", "SpellClassOptions",
]
TALENT_CURRENCY_POINTS = 51  # the class-talent trait currency is capped at one point per level 10-60
TRAIT_GRID = 600  # trait node positions are laid out on a 600-unit grid
# SpellClassOptions.SpellClassSet -> ClassID
CLASS_FAMILY = {4: 1, 10: 2, 9: 3, 8: 4, 6: 5, 11: 7, 3: 8, 5: 9, 7: 11}

# Extra tables only needed for the newest build.
LATEST_TABLES = ["ManifestInterfaceData", "CharBaseInfo", "ChrRaces", "ChrClasses", "SkillLineAbility", "SpellLevels",
                 "SkillLine", "LFGDungeons", "ContentTuning", "Map", "ItemSparse", "Item", "RandPropPoints",
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
# TalentTab.ClassMask bit -> ClassID
MASK_TO_CLASS = {1 << (cid - 1): cid for cid in CLASSES}

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
                        out.append(fmt(v) + " sec")
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

def ranks_of(t: dict[str, str]) -> list[str]:
    return [t[f"SpellRank_{i}"] for i in range(9) if t.get(f"SpellRank_{i}", "0") not in ("0", "")]


def tab_class(tab: dict[str, str]) -> int:
    return MASK_TO_CLASS.get(int(tab["ClassMask"]), 0)


def extract_talents(db: SpellDB, era: SpellDB | None = None) -> dict[str, dict]:
    """Return {talentId: normalized talent} for every talent in the build.

    The Forever beta client only ships the rank-1 spell of most talents, and a few
    talents ship no spell at all. We never invent numbers:
      - missing higher ranks are copied from Classic Era only when Forever's rank 1
        reads identically to Classic's rank 1; otherwise they stay "" (unknown);
      - a talent with no Forever spell falls back to Classic Era's text.
    `estimated` is the first rank index that isn't straight from the Forever client.
    """
    tabs = {r["ID"]: r for r in db.tabs}
    out: dict[str, dict] = {}
    for t in db.talents:
        tab = tabs.get(t["TabID"])
        if not tab:
            continue
        spells = ranks_of(t)
        if not spells:
            continue
        first = spells[0]
        source = "forever"
        if db.has(first):
            texts = [db.render(first)]
            name = db.names[first]
            for k, sid in enumerate(spells[1:], start=2):
                texts.append(db.render(sid) if db.has(sid) else "")
            estimated = next((i for i, x in enumerate(texts) if not x), len(texts))
            if estimated < len(texts):
                same_as_era = era is not None and era.has(first) and same_text(era.render(first), texts[0])
                for i in range(estimated, len(texts)):
                    if same_as_era and era.has(spells[i]):
                        texts[i] = era.render(spells[i])
        elif era is not None and era.has(first):
            source = "classic"
            name = era.names[first]
            texts = [era.render(sid) if era.has(sid) else "" for sid in spells]
            estimated = 0
        else:
            source = "missing"
            name = db.names.get(first) or f"Unknown talent {t['ID']}"
            texts = ["Tooltip data for this talent is not in the current beta client."] * len(spells)
            estimated = 0
        prereq = None
        if t["PrereqTalent_0"] not in ("0", ""):
            prereq = {"id": int(t["PrereqTalent_0"]), "rank": int(t["PrereqRank_0"]) + 1}
        spell_db = db if source == "forever" else (era or db)
        out[t["ID"]] = {
            "id": int(t["ID"]),
            "tab": int(t["TabID"]),
            "classId": tab_class(tab),
            "name": name,
            "tier": int(t["TierID"]),
            "col": int(t["ColumnIndex"]),
            "ranks": texts,
            "estimated": estimated,
            "source": source,
            "spells": [int(s) for s in spells],
            "prereq": prereq,
            "active": _is_active(spell_db, first),
            "iconFile": spell_db.misc.get(first, {}).get("SpellIconFileDataID", ""),
            "effectKeys": spell_db.effect_keys(first),
        }
    return out


def _clusters(values: list[int], gap: int) -> list[list[int]]:
    """Group sorted positions into clusters separated by more than `gap`."""
    out: list[list[int]] = []
    for v in sorted(set(values)):
        if out and v - out[-1][-1] <= gap:
            out[-1].append(v)
        else:
            out.append([v])
    return out


def extract_trait_talents(db: SpellDB) -> dict[str, dict]:
    """Forever class talents from the trait system: {nodeId: normalized talent}.

    Each class has one trait tree holding its three talent trees side by side. Node
    positions give tier/column, TraitCond gives the points required in that tree,
    TraitEdge gives prerequisites, and per-rank curves give each rank's numbers.
    """
    t = {name: load_table(db.build, name) for name in TRAIT_TABLES}
    trees_with_points = {r["TraitTreeID"] for r in t["TraitTreeXTraitCurrency"]
                         if next((c for c in t["TraitCurrency"] if c["ID"] == r["TraitCurrencyID"]), {})
                         .get("SourcedMax") == str(TALENT_CURRENCY_POINTS)}
    entries = {r["ID"]: r for r in t["TraitNodeEntry"]}
    defs = {r["ID"]: r for r in t["TraitDefinition"]}
    node_entry: dict[str, str] = {}
    for r in t["TraitNodeXTraitNodeEntry"]:
        node_entry.setdefault(r["TraitNodeID"], r["TraitNodeEntryID"])
    curves: dict[str, dict[int, float]] = {}
    for r in t["CurvePoint"]:
        curves.setdefault(r["CurveID"], {})[round(num(r["Pos_0"]))] = num(r["Pos_1"])
    effect_curves: dict[str, dict[int, str]] = {}
    for r in t["TraitDefinitionEffectPoints"]:
        effect_curves.setdefault(r["TraitDefinitionID"], {})[int(r["EffectIndex"]) + 1] = r["CurveID"]
    family = {r["SpellID"]: int(r["SpellClassSet"]) for r in t["SpellClassOptions"]}
    groups_of: dict[str, list[str]] = {}
    for r in t["TraitNodeGroupXTraitNode"]:
        groups_of.setdefault(r["TraitNodeID"], []).append(r["TraitNodeGroupID"])
    conds = {r["ID"]: r for r in t["TraitCond"]}
    group_conds: dict[str, list[dict]] = {}
    for r in t["TraitNodeGroupXTraitCond"]:
        if r["TraitCondID"] in conds:
            group_conds.setdefault(r["TraitNodeGroupID"], []).append(conds[r["TraitCondID"]])
    prereqs: dict[str, str] = {}
    for r in t["TraitEdge"]:
        prereqs[r["RightTraitNodeID"]] = r["LeftTraitNodeID"]

    # Talent-table tabs give the tree names/art; match them to node clusters by spell ids.
    tab_of_spell = {}
    for r in db.talents:
        for sid in ranks_of(r):
            tab_of_spell[sid] = r["TabID"]
    tabs = {r["ID"]: r for r in db.tabs}

    by_tree: dict[str, list[dict]] = {}
    for n in t["TraitNode"]:
        if n["TraitTreeID"] in trees_with_points and n["ID"] in node_entry:
            by_tree.setdefault(n["TraitTreeID"], []).append(n)

    # One tree per class: the largest one whose spells belong to that class.
    class_tree: dict[int, str] = {}
    for tree, nodes in by_tree.items():
        fams = [family.get(defs[entries[node_entry[n["ID"]]]["TraitDefinitionID"]]["SpellID"]) for n in nodes]
        fam = max(set(f for f in fams if f), key=fams.count, default=None)
        cid = CLASS_FAMILY.get(fam or -1)
        if cid and len(nodes) > len(by_tree.get(class_tree.get(cid, ""), [])):
            class_tree[cid] = tree

    out: dict[str, dict] = {}
    for cid, tree in class_tree.items():
        nodes = by_tree[tree]
        min_y = min(int(n["PosY"]) for n in nodes)
        # Clusters are computed from on-grid nodes only (a parked node can sit far away).
        nodes = [n for n in nodes if (int(n["PosY"]) - min_y) / TRAIT_GRID <= 6.5]
        clusters = _clusters([int(n["PosX"]) for n in nodes], gap=TRAIT_GRID * 2)
        for ci, xs in enumerate(clusters):
            members = [n for n in nodes if xs[0] <= int(n["PosX"]) <= xs[-1]]
            spells = [defs[entries[node_entry[n["ID"]]]["TraitDefinitionID"]]["SpellID"] for n in members]
            tab_ids = [tab_of_spell[s_] for s_ in spells if s_ in tab_of_spell]
            tab_id = max(set(tab_ids), key=tab_ids.count) if tab_ids else None
            tab = tabs.get(tab_id) if tab_id else None
            if tab is None:  # fall back to the Talent-table tab order for this class
                class_tabs = sorted((r for r in db.tabs if tab_class(r) == cid), key=lambda r: int(r["OrderIndex"]))
                tab = class_tabs[ci] if ci < len(class_tabs) else {"ID": f"{tree}-{ci}", "Name_lang": f"Tree {ci + 1}",
                                                                    "BackgroundFile": "", "SpellIconID": ""}
            for n in members:
                if not 0 <= round((int(n["PosY"]) - min_y) / TRAIT_GRID) <= 6:
                    continue  # parked off the grid: not part of the playable tree
                entry = entries[node_entry[n["ID"]]]
                d = defs[entry["TraitDefinitionID"]]
                sid = d["SpellID"]
                max_ranks = max(1, int(entry["MaxRanks"]))
                rank_curves = effect_curves.get(d["ID"], {})
                texts = []
                for rank in range(1, max_ranks + 1):
                    ov = {idx: curves.get(cv, {}).get(rank) for idx, cv in rank_curves.items()}
                    ov = {k: v for k, v in ov.items() if v is not None}
                    texts.append(db.render(sid, overrides=ov))
                req = 0
                for g in groups_of.get(n["ID"], []):
                    for c in group_conds.get(g, []):
                        req = max(req, int(num(c.get("SpentAmountRequired"))))
                prereq = None
                if n["ID"] in prereqs:
                    left = prereqs[n["ID"]]
                    left_entry = entries.get(node_entry.get(left, ""), {})
                    prereq = {"id": int(left), "rank": max(1, int(left_entry.get("MaxRanks", 1)))}
                icon_file = d["OverrideIcon"] if d["OverrideIcon"] not in ("", "0") else db.misc.get(sid, {}).get("SpellIconFileDataID", "")
                out[n["ID"]] = {
                    "id": int(n["ID"]),
                    "tab": int(tab["ID"]) if str(tab["ID"]).isdigit() else tab["ID"],
                    "tabInfo": {"name": tab["Name_lang"], "background": tab.get("BackgroundFile", ""),
                                "iconFile": tab.get("SpellIconID", ""), "order": ci},
                    "classId": cid,
                    "name": d["OverrideName_lang"] or db.names.get(sid) or f"Talent {n['ID']}",
                    "tier": round((int(n["PosY"]) - min_y) / TRAIT_GRID),
                    "col": round((int(n["PosX"]) - xs[0]) / TRAIT_GRID),
                    "req": req,
                    "ranks": texts,
                    "estimated": max_ranks,
                    "source": "forever",
                    "spells": [int(sid)],
                    "prereq": prereq,
                    "active": _is_active(db, sid),
                    "iconFile": icon_file,
                    "effectKeys": db.effect_keys(sid),
                }
    return out


def _is_active(db: SpellDB, sid: str) -> bool:
    """Whether a talent grants a button to press (drawn round, like the game does).
    Some Forever passives lack SPELL_ATTR0_PASSIVE (0x40), so also require a
    cooldown, a non-self range or a cast time."""
    m = db.misc.get(sid)
    if not m or int(m["Attributes_0"]) & 0x40:
        return False
    return db.cooldown_ms(sid) > 0 or m["RangeIndex"] not in ("0", "1") or m["CastingTimeIndex"] not in ("0", "1")


NUMBER = re.compile(r"-?\d+(?:\.\d+)?|\?")
WORDING = [(re.compile(r"\brage points?\b", re.I), "rage"), (re.compile(r"\bhit points\b", re.I), "health"),
           (re.compile(r"\bsecs\b"), "sec"), (re.compile(r"[^a-z#% ]"), " ")]


def skeleton(text: str) -> str:
    """Text with numbers blanked and cosmetic wording normalized."""
    out = NUMBER.sub("#", text).lower()
    for pat, rep in WORDING:
        out = pat.sub(rep, out)
    return " ".join(out.split())


def numbers(text: str) -> list[str]:
    return NUMBER.findall(text)


def same_text(a: str, b: str) -> bool:
    """Equal numbers and equal wording, ignoring cosmetic edits like capitalization."""
    return numbers(a) == numbers(b) and skeleton(a) == skeleton(b)


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, skeleton(a), skeleton(b)).ratio()


UNIT = re.compile(r"(\d+(?:\.\d+)?)\s*(min|hour|hours)\b")


def _seconds(text: str) -> str:
    """Express durations in seconds so "1 min" and "60 sec" compare equal."""
    return UNIT.sub(lambda m: f"{float(m.group(1)) * (60 if m.group(2) == 'min' else 3600):g} sec", text)


def _numbers_match(cur: dict, old: dict) -> bool:
    """Same rank count and the same numbers in every rank's tooltip (order-insensitive, so
    rephrased sentences still match; durations normalized to seconds). Values the Forever
    client leaves blank ("?") are skipped.

    Raw effect fields aren't compared: the Classic Era and Forever clients store the same
    thing differently (e.g. permanent auras as duration -1 vs 0, proc chance 101 vs 0)."""
    if len(cur["ranks"]) != len(old["ranks"]):
        return False
    for a, b in zip(cur["ranks"], old["ranks"]):
        a, b = _seconds(a), _seconds(b)
        na = sorted(abs(float(x)) for x in numbers(a) if x != "?")
        nb = sorted(abs(float(x)) for x in numbers(b) if x != "?")
        tolerance = 1e-6
        if "?" in numbers(a):
            # Can't see every Forever number: require what's visible to appear in Classic.
            if not all(any(abs(x - y) <= tolerance for y in nb) for x in na):
                return False
        elif len(na) != len(nb) or any(abs(x - y) > tolerance for x, y in zip(na, nb)):
            return False
    return True


def _is_subset(small: list, big: list) -> bool:
    rest = list(big)
    for k in small:
        if k not in rest:
            return False
        rest.remove(k)
    return True


def classify(cur: dict, old: dict | None) -> tuple[str, list[str]]:
    """Compare a Forever talent with its Classic Era counterpart by what it does, not how
    the tooltip is worded.

      unchanged  same effects and the same numbers (the tooltip may be reworded)
      tuned      same effects, different numbers or rank count
      expanded   the Classic effects plus something new (extra effect or bonus)
      reworked   does something different
      new        no Classic counterpart (or replaces an unrelated Classic talent)
      moved      unchanged, but sits somewhere else in the tree
    """
    if cur["source"] != "forever":
        return "unverified", []
    if old is None:
        return "new", []
    notes = []
    renamed = cur["name"] != old["name"]
    same_core = cur["effectKeys"] == old["effectKeys"]
    overlap = set(cur["effectKeys"]) & set(old["effectKeys"])
    if renamed and not overlap and similarity(cur["ranks"][0], old["ranks"][0]) < 0.6:
        return "new", ["replaces"]
    if cur["tab"] != old["tab"]:
        notes.append("moved-tree")
    elif (cur["tier"], cur["col"]) != (old["tier"], old["col"]):
        notes.append("moved")
    if len(cur["ranks"]) != len(old["ranks"]):
        notes.append("ranks")
    if renamed:
        notes.append("renamed")
    if same_core:
        if _numbers_match(cur, old):
            if skeleton(cur["ranks"][-1]) != skeleton(old["ranks"][-1]):
                notes.append("reworded")
            return ("moved" if "moved" in notes or "moved-tree" in notes else "unchanged"), notes
        return "tuned", notes
    if _is_subset(old["effectKeys"], cur["effectKeys"]):
        return "expanded", notes
    return "reworked", notes


def match_classic(cur: dict, era_by_spell: dict[tuple, dict], era_by_name: dict[tuple, dict]) -> dict | None:
    """The Classic Era talent a Forever talent descends from: same rank-1 spell, else same name."""
    return era_by_spell.get((cur["classId"], cur["spells"][0])) or era_by_name.get((cur["classId"], cur["name"]))


# --------------------------------------------------------------------------- icons

def icon_names(build: str) -> dict[str, str]:
    rows = load_table(build, "ManifestInterfaceData")
    out = {}
    for r in rows:
        if "icons" in r["FilePath"].lower():
            out[r["ID"]] = r["FileName"].rsplit(".", 1)[0].lower()
    return out


# --------------------------------------------------------------------------- main

REVIEW_FILE = ROOT / "pipeline" / "classification-review.json"


def load_review() -> dict[str, dict]:
    """Human-reviewed statuses (see the file's note). Keyed by trait node id."""
    if not REVIEW_FILE.exists():
        return {}
    return json.loads(REVIEW_FILE.read_text())["talents"]


def build_class_files(latest: SpellDB, era_db: SpellDB, icons: dict[str, str], build: str, era_build: str):
    review = load_review()
    stale_reviews = []
    cur = extract_trait_talents(latest)
    era = extract_talents(era_db)
    era_by_name = {(t["classId"], t["name"]): t for t in era.values()}
    era_by_spell = {(t["classId"], t["spells"][0]): t for t in era.values()}
    summary = []

    for cid, (slug, cname) in CLASSES.items():
        mine = [t for t in cur.values() if t["classId"] == cid]
        tab_infos = sorted({t["tab"]: t["tabInfo"] for t in mine}.items(), key=lambda kv: kv[1]["order"])
        trees = []
        counts = {"new": 0, "reworked": 0, "expanded": 0, "tuned": 0, "moved": 0, "unchanged": 0, "unverified": 0}
        for tab_id, info in tab_infos:
            talents = []
            for t in sorted((x for x in mine if x["tab"] == tab_id), key=lambda x: (x["tier"], x["col"])):
                old = match_classic(t, era_by_spell, era_by_name)
                status, notes = classify(t, old)
                reviewed = review.get(str(t["id"]))
                reason = None
                if reviewed:
                    if reviewed["checkedText"] == t["ranks"][-1]:
                        status, reason = reviewed["status"], reviewed["reason"]
                        if status == "new" and old and "replaces" not in notes:
                            notes.append("replaces")
                    else:
                        stale_reviews.append(f"{slug}:{t['id']} {t['name']}")
                counts[status] += 1
                entry = {k: t[k] for k in ("id", "name", "tier", "col", "req", "ranks", "spells", "prereq",
                                           "active", "estimated", "source")}
                entry["icon"] = icons.get(t["iconFile"], "inv_misc_questionmark")
                entry["status"] = status
                if reason:
                    entry["reason"] = reason
                if notes:
                    entry["notes"] = notes
                if old and status != "unchanged":
                    entry["classic"] = {
                        "name": old["name"], "ranks": old["ranks"], "tier": old["tier"],
                        "col": old["col"], "tab": old["tab"],
                    }
                talents.append(entry)
            trees.append({
                "id": tab_id,
                "name": info["name"],
                "background": info["background"],
                "icon": icons.get(info["iconFile"], "inv_misc_questionmark"),
                "talents": talents,
            })
        # Classic talents that no longer exist in this class.
        removed = []
        names_now = {t["name"] for t in mine}
        spells_now = {t["spells"][0] for t in mine}
        for old in era.values():
            if old["classId"] == cid and old["name"] not in names_now and old["spells"][0] not in spells_now:
                tabname = next((t["Name_lang"] for t in era_db.tabs if int(t["ID"]) == old["tab"]), "")
                removed.append({"name": old["name"], "tree": tabname, "tier": old["tier"],
                                "ranks": old["ranks"]})
        removed.sort(key=lambda r: (r["tree"], r["tier"], r["name"]))
        payload = {
            "build": build, "classicBuild": era_build, "classId": cid, "slug": slug,
            "name": cname, "trees": trees, "removed": removed,
        }
        write_json(OUT / "classes" / f"{slug}.json", payload)
        summary.append({"id": cid, "slug": slug, "name": cname,
                        "trees": [{"name": tr["name"], "icon": tr["icon"]} for tr in trees],
                        "counts": counts, "removed": len(removed)})
    if stale_reviews:
        print(f"Review needed: {len(stale_reviews)} reviewed talents changed text since review: " + ", ".join(stale_reviews))
    return summary


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


def diff_builds(builds: list[str]) -> list[dict]:
    """Talent-level changelog between consecutive Forever beta builds (newest first)."""
    entries = []
    prev_db = None
    prev_talents: dict[str, dict] = {}
    for b in builds:
        db = SpellDB(b)
        talents = {k: v for k, v in extract_trait_talents(db).items()}
        if prev_db is not None:
            changes = []
            for tid, t in talents.items():
                old = prev_talents.get(tid)
                cls = CLASSES.get(t["classId"], ("?",))[0]
                if old is None:
                    changes.append({"type": "added", "talent": t["id"], "class": cls, "name": t["name"],
                                    "after": t["ranks"][-1]})
                    continue
                kinds = []
                if (old["tier"], old["col"], old["tab"]) != (t["tier"], t["col"], t["tab"]):
                    kinds.append("moved")
                if old["req"] != t["req"]:
                    kinds.append("req")
                if len(old["ranks"]) != len(t["ranks"]):
                    kinds.append("ranks")
                if old["name"] != t["name"]:
                    kinds.append("renamed")
                if old["prereq"] != t["prereq"]:
                    kinds.append("prereq")
                if old["ranks"] != t["ranks"]:
                    kinds.append("text")
                if kinds:
                    changes.append({"type": "changed", "kinds": kinds, "talent": t["id"], "class": cls,
                                    "name": t["name"], "oldName": old["name"],
                                    "before": old["ranks"][-1], "after": t["ranks"][-1],
                                    "beforeRanks": len(old["ranks"]), "afterRanks": len(t["ranks"]),
                                    "beforePos": [old["tier"], old["col"]], "afterPos": [t["tier"], t["col"]]})
            for tid, old in prev_talents.items():
                if tid not in talents:
                    changes.append({"type": "removed", "talent": old["id"],
                                    "class": CLASSES.get(old["classId"], ("?",))[0],
                                    "name": old["name"], "before": old["ranks"][-1]})
            changes.sort(key=lambda c: (c["class"], c["name"]))
            entries.append({"build": b, "previous": prev_db.build, "changes": changes})
        prev_db, prev_talents = db, talents
    entries.reverse()
    return entries


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
    load_table(era_build, "CharBaseInfo")

    latest_db = SpellDB(latest)
    era_db = SpellDB(era_build)
    icons = icon_names(latest)

    summary = build_class_files(latest_db, era_db, icons, latest, era_build)
    races = build_races(latest, era_build)
    changelog = diff_builds(builds)

    write_json(OUT / "races.json", races)  # before the item database, which reads it

    # Imported here: extras.py imports helpers from this module.
    import extras
    extras.build_leveling(latest_db, icons)
    extras.build_dungeons(latest)
    extras.build_legacy(latest_db, icons)
    n_items = extras.build_items(latest, era_build, icons)
    n_prof = extras.build_professions(latest_db, era_build, icons)
    n_nodes, n_paths = extras.build_flights(latest, era_build)
    import itemdb
    n_db = itemdb.build_itemdb(latest_db, era_db, icons, json.loads((OUT / "professions" / "index.json").read_text()))
    print(f"Extras: {n_items} gear items, {n_db} items in the database, {n_prof} professions, "
          f"{n_nodes} flight points, {n_paths} flight routes, leveling, dungeons, legacy")

    write_json(OUT / "changelog.json", changelog)
    write_json(OUT / "meta.json", {
        "build": latest, "classicBuild": era_build, "builds": builds, "phase": phase,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "classes": summary,
    })
    total = sum(sum(c["counts"].values()) for c in summary)
    print(f"Wrote {total} talents for {len(summary)} classes, {len(races)} races, "
          f"{len(changelog)} changelog entries -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
