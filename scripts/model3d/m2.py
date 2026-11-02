"""Readers for the WoW client's 3D formats: M2 models (chunked MD21), .skin mesh profiles and BLP
textures. Only what a static, unanimated render needs: the bind-pose mesh, its geosets, texture
slots and attachment points."""

from __future__ import annotations

import struct
import zlib

import numpy as np


class Reader:
    def __init__(self, data: bytes, base: int = 0):
        self.d, self.base = data, base

    def u32(self, o): return struct.unpack_from("<I", self.d, self.base + o)[0]
    def i32(self, o): return struct.unpack_from("<i", self.d, self.base + o)[0]
    def u16(self, o): return struct.unpack_from("<H", self.d, self.base + o)[0]
    def i16(self, o): return struct.unpack_from("<h", self.d, self.base + o)[0]
    def f32(self, o): return struct.unpack_from("<f", self.d, self.base + o)[0]
    def arr(self, o): return self.u32(o), self.u32(o + 4)  # (count, offset)


def chunks(data: bytes) -> dict[str, tuple[int, int]]:
    out, o = {}, 0
    while o + 8 <= len(data):
        tag = data[o:o + 4].decode("ascii", "replace")
        size = struct.unpack_from("<I", data, o + 4)[0]
        out[tag] = (o + 8, size)
        o += 8 + size
    return out


# Offsets into the MD20 header (Legion and later, version >= 264).
H = {
    "name": 8, "flags": 16, "global_loops": 20, "sequences": 28, "sequence_lookup": 36, "bones": 44,
    "key_bone_lookup": 52, "vertices": 60, "num_skin_profiles": 68, "colors": 72, "textures": 80,
    "texture_weights": 88, "texture_transforms": 96, "replaceable_texture_lookup": 104, "materials": 112,
    "bone_lookup": 120, "texture_lookup": 128, "texcoord_lookup": 136, "transparency_lookup": 144,
    "texture_transform_lookup": 152, "bounding_box": 160, "bounding_radius": 184, "collision_box": 188,
    "collision_radius": 212, "collision_indices": 216, "collision_positions": 224, "collision_normals": 232,
    "attachments": 240, "attachment_lookup": 248,
}


class M2:
    def __init__(self, data: bytes):
        ch = chunks(data)
        if "MD21" not in ch:
            raise ValueError("not a chunked M2")
        start, size = ch["MD21"]
        self.r = Reader(data, start)
        if data[start:start + 4] != b"MD20":
            raise ValueError("MD21 chunk without MD20")
        self.version = self.r.u32(4)
        r = self.r
        n, o = r.arr(H["vertices"])
        raw = np.frombuffer(data, dtype=np.uint8, count=n * 48, offset=start + o).reshape(n, 48)
        self.pos = raw[:, 0:12].copy().view("<f4").reshape(n, 3)
        self.normal = raw[:, 20:32].copy().view("<f4").reshape(n, 3)
        self.uv = raw[:, 32:40].copy().view("<f4").reshape(n, 2)
        self.uv2 = raw[:, 40:48].copy().view("<f4").reshape(n, 2)
        self.textures = []
        n, o = r.arr(H["textures"])
        for i in range(n):
            self.textures.append({"type": r.u32(o + i * 16), "flags": r.u32(o + i * 16 + 4)})
        self.texture_lookup = [r.u16(o + 2 * i) for i in range(r.arr(H["texture_lookup"])[0]) for o in [r.arr(H["texture_lookup"])[1]]]
        n, o = r.arr(H["materials"])
        self.materials = [{"flags": r.u16(o + i * 4), "blend": r.u16(o + i * 4 + 2)} for i in range(n)]
        n, o = r.arr(H["attachments"])
        self.attachments = {}
        for i in range(n):
            b = o + i * 40
            self.attachments.setdefault(r.u32(b), (r.u16(b + 4), (r.f32(b + 8), r.f32(b + 12), r.f32(b + 16))))
        n, o = r.arr(H["bones"])
        self.bone_pivots = [(r.f32(o + i * 88 + 76), r.f32(o + i * 88 + 80), r.f32(o + i * 88 + 84)) for i in range(n)]
        self.bone_parents = [r.i16(o + i * 88 + 8) for i in range(n)]
        # File ids that later chunks provide instead of names.
        self.skin_ids, self.texture_ids = [], []
        if "SFID" in ch:
            s, sz = ch["SFID"]
            self.skin_ids = list(struct.unpack_from(f"<{sz // 4}I", data, s))
        if "TXID" in ch:
            s, sz = ch["TXID"]
            self.texture_ids = list(struct.unpack_from(f"<{sz // 4}I", data, s))


class Skin:
    def __init__(self, data: bytes):
        if data[:4] != b"SKIN":
            raise ValueError("not a .skin file")
        r = Reader(data)
        n, o = r.arr(4)
        self.vertices = np.frombuffer(data, dtype="<u2", count=n, offset=o).astype(np.int64)
        n, o = r.arr(12)
        self.indices = np.frombuffer(data, dtype="<u2", count=n, offset=o).astype(np.int64)
        n, o = r.arr(28)
        self.submeshes = []
        for i in range(n):
            b = o + i * 48
            level = r.u16(b + 2)
            self.submeshes.append({
                "geoset": r.u16(b), "vstart": r.u16(b + 4) + (level << 16), "vcount": r.u16(b + 6),
                "istart": r.u16(b + 8) + (level << 16), "icount": r.u16(b + 10),
            })
        n, o = r.arr(36)
        self.batches = []
        for i in range(n):
            b = o + i * 24
            self.batches.append({
                "flags": data[b], "shader": r.u16(b + 2), "submesh": r.u16(b + 4), "material": r.u16(b + 10),
                "texture_count": r.u16(b + 14), "texture_combo": r.u16(b + 16),
            })


# ---------------------------------------------------------------------------------- BLP textures

def _rgb565(c: np.ndarray) -> np.ndarray:
    r = ((c >> 11) & 31) * 255 // 31
    g = ((c >> 5) & 63) * 255 // 63
    b = (c & 31) * 255 // 31
    return np.stack([r, g, b], -1).astype(np.int32)


def _dxt_colors(block: np.ndarray, dxt1: bool) -> tuple[np.ndarray, np.ndarray]:
    """block: (N, 8) color part. Returns palette (N, 4, 4 RGBA) and per-pixel indices (N, 16)."""
    c0 = block[:, 0].astype(np.int32) | (block[:, 1].astype(np.int32) << 8)
    c1 = block[:, 2].astype(np.int32) | (block[:, 3].astype(np.int32) << 8)
    p0, p1 = _rgb565(c0), _rgb565(c1)
    four = (c0 > c1) | (not dxt1)
    p2 = np.where(four[:, None], (2 * p0 + p1) // 3, (p0 + p1) // 2)
    p3 = np.where(four[:, None], (p0 + 2 * p1) // 3, 0)
    a = np.full((len(block), 4), 255, np.int32)
    if dxt1:
        a[:, 3] = np.where(four, 255, 0)
    pal = np.stack([p0, p1, p2, p3], 1)
    pal = np.concatenate([pal, a[:, :, None]], -1)
    bits = block[:, 4:8].astype(np.uint32)
    word = bits[:, 0] | (bits[:, 1] << 8) | (bits[:, 2] << 16) | (bits[:, 3] << 24)
    idx = np.stack([(word >> (2 * k)) & 3 for k in range(16)], -1)
    return pal, idx


def _assemble(px: np.ndarray, w: int, h: int) -> np.ndarray:
    """px: (blocks, 16, 4) -> image (h, w, 4)."""
    bw, bh = max(w // 4, 1), max(h // 4, 1)
    img = px.reshape(bh, bw, 4, 4, 4).transpose(0, 2, 1, 3, 4).reshape(bh * 4, bw * 4, 4)
    return img[:h, :w].astype(np.uint8)


def decode_blp(data: bytes) -> np.ndarray:
    """First mip level of a BLP2 texture as an (h, w, 4) RGBA array."""
    if data[:4] != b"BLP2":
        raise ValueError("not BLP2")
    encoding, alpha_depth, alpha_type = data[8], data[9], data[10]
    w, h = struct.unpack_from("<II", data, 12)
    off, size = struct.unpack_from("<I", data, 20)[0], struct.unpack_from("<I", data, 84)[0]
    mip = np.frombuffer(data, dtype=np.uint8, count=size, offset=off)
    if encoding == 3:  # uncompressed BGRA
        img = mip[: w * h * 4].reshape(h, w, 4)[:, :, [2, 1, 0, 3]]
        return img.copy()
    if encoding == 1:  # palettized
        pal = np.frombuffer(data, dtype=np.uint8, count=1024, offset=148).reshape(256, 4)[:, [2, 1, 0, 3]].copy()
        idx = mip[: w * h]
        img = pal[idx].reshape(h, w, 4).copy()
        if alpha_depth == 0:
            img[:, :, 3] = 255
        elif alpha_depth == 8:
            img[:, :, 3] = mip[w * h: w * h * 2].reshape(h, w)
        elif alpha_depth == 1:
            bits = np.unpackbits(mip[w * h: w * h + (w * h + 7) // 8], bitorder="little")[: w * h]
            img[:, :, 3] = bits.reshape(h, w) * 255
        return img
    if encoding == 2:
        nblocks = max(w // 4, 1) * max(h // 4, 1)
        if alpha_type == 0:  # DXT1
            b = mip[: nblocks * 8].reshape(nblocks, 8)
            pal, idx = _dxt_colors(b, dxt1=alpha_depth > 0)
            if alpha_depth == 0:
                pal[:, :, 3] = 255
            px = np.take_along_axis(pal, idx[:, :, None].repeat(4, -1).astype(np.int64), 1)
            return _assemble(px, w, h)
        b = mip[: nblocks * 16].reshape(nblocks, 16)
        pal, idx = _dxt_colors(b[:, 8:16], dxt1=False)
        px = np.take_along_axis(pal, idx[:, :, None].repeat(4, -1).astype(np.int64), 1)
        if alpha_type == 1:  # DXT3: explicit 4-bit alpha
            a = b[:, 0:8]
            lo, hi = a & 15, a >> 4
            alpha = np.stack([lo, hi], -1).reshape(nblocks, 16).astype(np.int32) * 17
        else:  # DXT5: interpolated alpha
            a0, a1 = b[:, 0].astype(np.int32), b[:, 1].astype(np.int32)
            ap = np.zeros((nblocks, 8), np.int32)
            ap[:, 0], ap[:, 1] = a0, a1
            six = a0 > a1
            for k in range(2, 8):
                ap[:, k] = np.where(six, ((8 - k) * a0 + (k - 1) * a1) // 7, 0)
            for k in range(2, 6):
                ap[:, k] = np.where(six, ap[:, k], ((6 - k) * a0 + (k - 1) * a1) // 5)
            ap[:, 6] = np.where(six, ap[:, 6], 0)
            ap[:, 7] = np.where(six, ap[:, 7], 255)
            bits = b[:, 2:8].astype(np.uint64)
            word = sum(bits[:, k] << np.uint64(8 * k) for k in range(6))
            aidx = np.stack([(word >> np.uint64(3 * k)) & np.uint64(7) for k in range(16)], -1).astype(np.int64)
            alpha = np.take_along_axis(ap, aidx, 1)
        px[:, :, 3] = alpha
        return _assemble(px, w, h)
    raise ValueError(f"BLP encoding {encoding} not supported")


def png(img: np.ndarray) -> bytes:
    """Encode an (h, w, 4) uint8 array as PNG (stdlib only)."""
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))
    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
