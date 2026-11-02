"""Builds a static 3D model (glTF .glb) of a character wearing an item set, from the game client
files on wago.tools. Prototype: one race/gender, bind pose, no animation.

  python3 scripts/model3d/build_set_model.py <set id> [race id] [gender 0|1]

Writes public/models/set-<id>-<race>-<gender>.glb. The character is put together the way the game
does it: the body mesh with the geosets the default look and the equipped items ask for, one body
texture layered from skin, face and the armor textures per body section, and helmet and shoulder
models placed at their attachment points.
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(HERE))

from build_data import load_table  # noqa: E402
from casc import file  # noqa: E402
from m2 import M2, Skin, decode_blp, png  # noqa: E402

BUILD = json.loads((ROOT / "public/data/meta.json").read_text())["build"]
OUT = ROOT / "public" / "models"
ATLAS = (1024, 512)  # body texture size we compose at (the layout is 2048x1024; half is plenty for item textures)
ATT_HEAD, ATT_SHOULDER_R, ATT_SHOULDER_L = 11, 5, 6
# Order body-section textures are painted in (later covers earlier), by inventory slot.
PAINT_ORDER = {7: 0, 8: 1, 4: 2, 5: 3, 20: 3, 6: 4, 9: 5, 10: 6}
# Item slot -> geoset groups its ItemDisplayInfo.GeosetGroup_0..2 set (value + 1 is added to group * 100).
ITEM_GEOSETS = {5: (8, 10, 13), 20: (8, 10, 13), 4: (8,), 7: (11, 9, 13), 8: (5, 20), 10: (4, 23), 6: (18,), 16: (15,)}


def table(name: str) -> list[dict]:
    return load_table(BUILD, name)


def resize(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """Bilinear resize of an (h, w, 4) uint8 image."""
    sh, sw = img.shape[:2]
    if (sw, sh) == (w, h):
        return img
    ys = (np.arange(h) + 0.5) * sh / h - 0.5
    xs = (np.arange(w) + 0.5) * sw / w - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, sh - 1); y1 = np.clip(y0 + 1, 0, sh - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, sw - 1); x1 = np.clip(x0 + 1, 0, sw - 1)
    fy = np.clip(ys - y0, 0, 1)[:, None, None]; fx = np.clip(xs - x0, 0, 1)[None, :, None]
    f = img.astype(np.float32)
    top = f[y0][:, x0] * (1 - fx) + f[y0][:, x1] * fx
    bot = f[y1][:, x0] * (1 - fx) + f[y1][:, x1] * fx
    return (top * (1 - fy) + bot * fy).round().astype(np.uint8)


def blend(dst: np.ndarray, src: np.ndarray, x: int, y: int, mode: str = "alpha") -> None:
    h, w = src.shape[:2]
    d = dst[y:y + h, x:x + w].astype(np.float32)
    s = src.astype(np.float32)
    a = s[:, :, 3:4] / 255
    if mode == "replace":
        d[:, :, :3] = s[:, :, :3]
    elif mode == "multiply":
        d[:, :, :3] = d[:, :, :3] * (1 - a + a * s[:, :, :3] / 255)
    else:
        d[:, :, :3] = d[:, :, :3] * (1 - a) + s[:, :, :3] * a
    d[:, :, 3] = 255
    dst[y:y + h, x:x + w] = d.round().astype(np.uint8)


def texture(fdid: int) -> np.ndarray:
    return decode_blp(file(fdid, BUILD))


class Character:
    def __init__(self, race: int, gender: int):
        self.race, self.gender = race, gender
        rx = next(r for r in table("ChrRaceXChrModel") if r["ChrRacesID"] == str(race) and r["Sex"] == str(gender))
        self.model_id = rx["ChrModelID"]
        cm = next(r for r in table("ChrModel") if r["ID"] == self.model_id)
        self.layout = cm["CharComponentTextureLayoutID"]
        lay = next(r for r in table("CharComponentTextureLayouts") if r["ID"] == self.layout)
        self.layout_size = (int(lay["Width"]), int(lay["Height"]))
        self.sections = {int(r["SectionType"]): tuple(int(r[k]) for k in ("X", "Y", "Width", "Height"))
                         for r in table("CharComponentTextureSections") if r["CharComponentTextureLayoutID"] == self.layout}
        display = next(r for r in table("CreatureDisplayInfo") if r["ID"] == cm["DisplayID"])
        model_data = next(r for r in table("CreatureModelData") if r["ID"] == display["ModelID"])
        self.m2 = M2(file(int(model_data["FileDataID"]), BUILD))
        self.skin = Skin(file(self.m2.skin_ids[0], BUILD))
        self._customization()

    def _customization(self) -> None:
        """The default look: the first choice of every customization option (skin, face, hair...)."""
        options = [r for r in table("ChrCustomizationOption") if r["ChrModelID"] == self.model_id]
        choices = table("ChrCustomizationChoice")
        chosen = {}
        for o in options:
            cs = sorted((c for c in choices if c["ChrCustomizationOptionID"] == o["ID"]), key=lambda c: (int(c["OrderIndex"] or 0), int(c["ID"])))
            if cs:
                chosen[o["Name_lang"]] = cs[0]["ID"]
        chosen_ids = set(chosen.values())
        geo = {r["ID"]: r for r in table("ChrCustomizationGeoset")}
        mats = {r["ID"]: r for r in table("ChrCustomizationMaterial")}
        self.geosets: dict[int, int] = {}  # group -> geoset id
        self.target_materials: dict[str, str] = {}  # texture target -> material resources
        for e in table("ChrCustomizationElement"):
            if e["ChrCustomizationChoiceID"] not in chosen_ids:
                continue
            if e["RelatedChrCustomizationChoiceID"] not in ("0", "") and e["RelatedChrCustomizationChoiceID"] not in chosen_ids:
                continue
            g = geo.get(e["ChrCustomizationGeosetID"])
            if g:
                self.geosets[int(g["GeosetType"])] = int(g["GeosetType"]) * 100 + int(g["GeosetID"])
            m = mats.get(e["ChrCustomizationMaterialID"])
            if m:
                self.target_materials[m["ChrModelTextureTargetID"]] = m["MaterialResourcesID"]

    def compose(self, texture_type: int, items: list[dict]) -> np.ndarray | None:
        """One of the model's composited textures: customization layers, then (for the body) armor."""
        files = textures_by_material()
        layers = sorted((r for r in table("ChrModelTextureLayer")
                         if r["CharComponentTextureLayoutsID"] == self.layout and int(r["TextureType"]) == texture_type),
                        key=lambda r: int(r["Layer"] or 0))
        if not layers:
            return None
        lw, lh = self.layout_size
        sx, sy = ATLAS[0] / lw, ATLAS[1] / lh
        out = np.zeros((ATLAS[1], ATLAS[0], 4), np.uint8)
        out[:, :, 3] = 255
        drawn = False
        for layer in layers:
            mat = self.target_materials.get(layer["ChrModelTextureTargetID_0"])
            if not mat or mat not in files:
                continue
            img = texture(files[mat][0])
            mask = int(layer["TextureSectionTypeBitMask"])
            mode = "replace" if layer["BlendMode"] == "1" and not drawn else "multiply" if layer["BlendMode"] == "6" else "alpha"
            if mask == -1:
                blend(out, resize(img, *ATLAS), 0, 0, mode)
            else:
                for st, (x, y, w, h) in self.sections.items():
                    if mask >> st & 1:
                        blend(out, resize(img, round(w * sx), round(h * sy)), round(x * sx), round(y * sy), mode)
            drawn = True
        if texture_type == 1:
            for it in sorted(items, key=lambda i: PAINT_ORDER.get(i["slot"], 9)):
                for section, fdid in it["sections"]:
                    if section in self.sections:
                        x, y, w, h = self.sections[section]
                        blend(out, resize(texture(fdid), round(w * sx), round(h * sy)), round(x * sx), round(y * sy))
        return out if drawn else None


_tfd: dict[str, list[int]] | None = None


def textures_by_material() -> dict[str, list[int]]:
    global _tfd
    if _tfd is None:
        _tfd = {}
        for r in table("TextureFileData"):
            _tfd.setdefault(r["MaterialResourcesID"], []).append(int(r["FileDataID"]))
    return _tfd


def item_display(item_id: int) -> dict | None:
    ima = next((r for r in table("ItemModifiedAppearance") if r["ItemID"] == str(item_id) and r["ItemAppearanceModifierID"] == "0"), None)
    if not ima:
        return None
    app = next(r for r in table("ItemAppearance") if r["ID"] == ima["ItemAppearanceID"])
    return next((r for r in table("ItemDisplayInfo") if r["ID"] == app["ItemDisplayInfoID"]), None)


def gendered(files: list[int], race: int, gender: int) -> int | None:
    """Of a material's texture files, the one for this race/gender (or the unisex one)."""
    ctf = {r["ID"]: r for r in table("ComponentTextureFileData")}
    best = None
    for f in files:
        r = ctf.get(str(f))
        g, rc = (int(r["GenderIndex"]), int(r["RaceID"])) if r else (3, 0)
        if g in (gender, 2, 3) and rc in (0, race):
            if best is None or (rc == race) > (best[1] == race):
                best = (f, rc)
    return best[0] if best else (files[0] if files else None)


def item_model(res_id: str, race: int, gender: int, position: int | None = None) -> int | None:
    cmf = {r["ID"]: r for r in table("ComponentModelFileData")}
    for r in table("ModelFileData"):
        if r["ModelResourcesID"] != res_id:
            continue
        c = cmf.get(r["FileDataID"])
        if not c:
            return int(r["FileDataID"])
        if int(c["RaceID"]) in (0, race) and int(c["GenderIndex"]) in (gender, 2) and (position is None or int(c["PositionIndex"]) in (position, -1)):
            return int(r["FileDataID"])
    return None


# ---------------------------------------------------------------------------------- glTF writer

class Gltf:
    def __init__(self):
        self.bin = bytearray()
        self.doc = {"asset": {"version": "2.0", "generator": "Forever Forge set model prototype"}, "scene": 0,
                    "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "materials": [], "textures": [],
                    "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
                    "buffers": [], "bufferViews": [], "accessors": []}

    def _view(self, data: bytes, target: int | None = None) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        view = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            view["target"] = target
        self.bin += data
        self.doc["bufferViews"].append(view)
        return len(self.doc["bufferViews"]) - 1

    def _accessor(self, arr: np.ndarray, kind: str, target: int, minmax: bool = False) -> int:
        ctype = {np.dtype("float32"): 5126, np.dtype("uint32"): 5125}[arr.dtype]
        acc = {"bufferView": self._view(arr.tobytes(), target), "componentType": ctype, "count": len(arr), "type": kind}
        if minmax:
            acc["min"], acc["max"] = arr.min(0).tolist(), arr.max(0).tolist()
        self.doc["accessors"].append(acc)
        return len(self.doc["accessors"]) - 1

    def material(self, img: np.ndarray, name: str, alpha: str = "OPAQUE") -> int:
        self.doc["images"].append({"bufferView": self._view(png(img)), "mimeType": "image/png", "name": name})
        self.doc["textures"].append({"sampler": 0, "source": len(self.doc["images"]) - 1})
        mat = {"name": name, "pbrMetallicRoughness": {"baseColorTexture": {"index": len(self.doc["textures"]) - 1},
               "metallicFactor": 0, "roughnessFactor": 0.85}, "doubleSided": True, "alphaMode": alpha}
        if alpha == "MASK":
            mat["alphaCutoff"] = 0.5
        self.doc["materials"].append(mat)
        return len(self.doc["materials"]) - 1

    def mesh(self, name: str, parts: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, int]], translation=(0, 0, 0)) -> None:
        prims = []
        for pos, nrm, uv, idx, mat in parts:
            prims.append({"attributes": {"POSITION": self._accessor(pos.astype(np.float32), "VEC3", 34962, True),
                                         "NORMAL": self._accessor(nrm.astype(np.float32), "VEC3", 34962),
                                         "TEXCOORD_0": self._accessor(uv.astype(np.float32), "VEC2", 34962)},
                          "indices": self._accessor(idx.astype(np.uint32), "SCALAR", 34963), "material": mat})
        self.doc["meshes"].append({"name": name, "primitives": prims})
        self.doc["nodes"].append({"name": name, "mesh": len(self.doc["meshes"]) - 1, "translation": list(translation)})
        self.doc["scenes"][0]["nodes"].append(len(self.doc["nodes"]) - 1)

    def write(self, path: Path) -> None:
        while len(self.bin) % 4:
            self.bin.append(0)
        self.doc["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(self.doc, separators=(",", ":")).encode()
        js += b" " * (-len(js) % 4)
        path.write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin))
                         + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(self.bin), 0x004E4942) + self.bin)


def to_gltf(v: np.ndarray) -> np.ndarray:
    """WoW (x forward, y left, z up) -> glTF (x right, y up, z toward the viewer), facing the viewer."""
    return np.stack([v[:, 1], v[:, 2], v[:, 0]], -1)


def parts_of(m2: M2, skin: Skin, geosets: set[int] | None, tex_for) -> list:
    """Mesh parts per batch whose geoset is shown, with the material tex_for(texture slot) gives."""
    parts = []
    for b in skin.batches:
        sm = skin.submeshes[b["submesh"]]
        if geosets is not None and sm["geoset"] not in geosets:
            continue
        if b["texture_combo"] >= len(m2.texture_lookup):
            continue
        slot = m2.texture_lookup[b["texture_combo"]]
        mat = tex_for(slot, b)
        if mat is None:
            continue
        tri = skin.indices[sm["istart"]: sm["istart"] + sm["icount"]]
        verts = skin.vertices[tri]  # global vertex ids, per corner
        uniq, inv = np.unique(verts, return_inverse=True)
        parts.append((to_gltf(m2.pos[uniq]), to_gltf(m2.normal[uniq]), m2.uv[uniq], inv.astype(np.uint32), mat))
    return parts


def build(set_id: int, race: int = 1, gender: int = 0) -> Path:
    sets = json.loads((ROOT / "public/data/sets.json").read_text())["sets"]
    s = next(x for x in sets if x["id"] == set_id)
    ch = Character(race, gender)
    files = textures_by_material()
    items, hidden_groups, extra_geosets = [], set(), {}
    head = shoulders = None
    for piece in s["items"]:
        d = item_display(piece["id"])
        if not d:
            continue
        sections = []
        for r in table("ItemDisplayInfoMaterialRes"):
            if r["ItemDisplayInfoID"] == d["ID"] and r["MaterialResourcesID"] in files:
                f = gendered(files[r["MaterialResourcesID"]], race, gender)
                if f:
                    sections.append((int(r["ComponentSection"]), f))
        items.append({"slot": piece["slot"], "sections": sections})
        for i, group in enumerate(ITEM_GEOSETS.get(piece["slot"], ())):
            v = int(d[f"GeosetGroup_{i}"] or 0)
            if v:
                extra_geosets[group] = group * 100 + 1 + v
        if piece["slot"] == 8 and 20 not in extra_geosets:
            extra_geosets[20] = 2002  # boots replace the bare-foot mesh even when they don't pick a variant
        if piece["slot"] == 1:
            head = d
            vis = d[f"HelmetGeosetVis_{gender}"]
            for r in table("HelmetGeosetData"):
                if r["HelmetGeosetVisDataID"] == vis and r["RaceID"] in (str(race), "0"):
                    hidden_groups.add(int(r["HideGeosetGroup"]))
        if piece["slot"] == 3:
            shoulders = d

    # Geosets: body (0), the default look, then what the items ask for, minus what the helmet hides.
    groups = {g: gid for g, gid in ch.geosets.items()}
    groups.update(extra_geosets)
    shown = {0} | {gid for g, gid in groups.items() if g not in hidden_groups}
    # Groups the look didn't set default to their "01" variant (bare hands, no sleeves...).
    present = {sm["geoset"] for sm in ch.skin.submeshes}
    for gid in present:
        g = gid // 100
        if g and g not in groups and g not in hidden_groups and gid % 100 == 1:
            shown.add(gid)

    out = Gltf()
    body = ch.compose(1, items)
    mats = {}
    if body is not None:
        mats[1] = out.material(body, "body")
    for t in (19, 6):
        img = ch.compose(t, [])
        if img is not None:
            mats[t] = out.material(img, f"layer-{t}", "MASK")

    def body_tex(slot: int, batch: dict):
        t = ch.m2.textures[slot]["type"]
        if t in mats:
            return mats[t]
        if t == 0 and slot < len(ch.m2.texture_ids) and ch.m2.texture_ids[slot]:
            key = f"file-{ch.m2.texture_ids[slot]}"
            if key not in mats:
                mats[key] = out.material(texture(ch.m2.texture_ids[slot]), key, "MASK")
            return mats[key]
        return None

    out.mesh("character", parts_of(ch.m2, ch.skin, shown, body_tex))

    def attach(d: dict, res_key: str, mat_key: str, att: int, position: int | None, name: str):
        fid = item_model(d[res_key], race, gender, position)
        mat_files = files.get(d[mat_key], [])
        if not fid:
            return
        m = M2(file(fid, BUILD))
        sk = Skin(file(m.skin_ids[0], BUILD))
        cache = {}

        def tex(slot: int, batch: dict):
            t = m.textures[slot]["type"]
            fdid = (mat_files[0] if mat_files else None) if t == 2 else (m.texture_ids[slot] if slot < len(m.texture_ids) else None)
            if not fdid:
                return None
            if fdid not in cache:
                blend_mode = m.materials[batch["material"]]["blend"] if batch["material"] < len(m.materials) else 0
                cache[fdid] = out.material(texture(fdid), f"{name}-{fdid}", "OPAQUE" if blend_mode == 0 else "MASK")
            return cache[fdid]
        bone, pos = ch.m2.attachments.get(att, (0, (0, 0, 0)))
        out.mesh(name, parts_of(m, sk, None, tex), translation=to_gltf(np.array([pos], np.float32))[0].tolist())

    if head is not None and head["ModelResourcesID_0"] not in ("0", ""):
        attach(head, "ModelResourcesID_0", "ModelMaterialResourcesID_0", ATT_HEAD, None, "helm")
    if shoulders is not None:
        attach(shoulders, "ModelResourcesID_0", "ModelMaterialResourcesID_0", ATT_SHOULDER_L, 0, "shoulder-left")
        attach(shoulders, "ModelResourcesID_1", "ModelMaterialResourcesID_1", ATT_SHOULDER_R, 1, "shoulder-right")

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"set-{set_id}-{race}-{gender}.glb"
    out.write(path)
    # The site's list of available models (src/viewer3d.ts reads it).
    idx_path = OUT / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else {"sets": {}}
    race_name = next(r["Name_lang"] for r in table("ChrRaces") if r["ID"] == str(race))
    entry = {"file": path.name, "label": f"{race_name} {'male' if gender == 0 else 'female'}"}
    idx["sets"][str(set_id)] = [e for e in idx["sets"].get(str(set_id), []) if e["file"] != path.name] + [entry]
    idx_path.write_text(json.dumps(idx, indent=1) + "\n")
    return path


if __name__ == "__main__":
    args = [int(a) for a in sys.argv[1:]]
    p = build(*args) if args else build(321)
    print(f"Wrote {p.relative_to(ROOT)} ({p.stat().st_size // 1024} KB)")
