"""Continent outlines and zone shapes for the flight map, built from client data only.

The client has no coastlines, but every zone map lists its subzone overlays (WorldMapOverlay):
the rectangles that light up as you explore. Together they cover the land, so this module
rasterizes them onto a grid, smooths the result, and traces it back into polygons:

  land  = everything any overlay covers, blurred and thresholded, holes filled
  zones = each land cell goes to the zone whose overlays cover it most, gaps go to the nearest zone

Plain Python (no numpy) so the data job needs nothing beyond the standard library.
"""

from __future__ import annotations

from array import array
from collections import deque

# Grid cell size in continent-map units (the map is 1 wide); fine enough for a few hundred px of land.
CELL = 0.0016
BLUR_CELLS = 5  # box blur radius for the coastline, applied three times (close to a Gaussian)
MODE_PASSES = 3  # majority-filter passes that iron out ragged zone borders
SIMPLIFY = 0.6  # Douglas-Peucker tolerance, in cells
MIN_LOOP_CELLS = 30  # drop specks smaller than this many cells


class Grid:
    def __init__(self, x0: float, y0: float, w: int, h: int, aspect: float):
        self.x0, self.y0, self.w, self.h, self.aspect = x0, y0, w, h, aspect

    def cell_range(self, x0: float, y0: float, x1: float, y1: float):
        """Cells covered by a rectangle in map units (y already scaled by aspect)."""
        cx0 = max(0, int((min(x0, x1) - self.x0) / CELL))
        cx1 = min(self.w - 1, int((max(x0, x1) - self.x0) / CELL))
        cy0 = max(0, int((min(y0, y1) - self.y0) / CELL))
        cy1 = min(self.h - 1, int((max(y0, y1) - self.y0) / CELL))
        return cx0, cy0, cx1, cy1

    def to_map(self, gx: float, gy: float) -> tuple[float, float]:
        """Grid corner coordinates back to 0..1 map coordinates."""
        return (round(self.x0 + gx * CELL, 4), round((self.y0 + gy * CELL) / self.aspect, 4))


def build(rects: list[tuple[str, float, float, float, float]], aspect: float, pad: float = 0.03):
    """rects: (zone, x0, y0, x1, y1) in 0..1 map coordinates. Returns land polygons, zone polygons
    and a label point per zone, all in 0..1 map coordinates."""
    xs = [v for r in rects for v in (r[1], r[3])]
    ys = [v * aspect for r in rects for v in (r[2], r[4])]
    grid = Grid(min(xs) - pad, min(ys) - pad, 0, 0, aspect)
    grid.w = int((max(xs) - min(xs) + 2 * pad) / CELL) + 1
    grid.h = int((max(ys) - min(ys) + 2 * pad) / CELL) + 1
    n = grid.w * grid.h

    zones = sorted({r[0] for r in rects})
    counts = {z: array("H", bytes(2 * n)) for z in zones}
    for z, x0, y0, x1, y1 in rects:
        cx0, cy0, cx1, cy1 = grid.cell_range(x0, y0 * aspect, x1, y1 * aspect)
        c = counts[z]
        for gy in range(cy0, cy1 + 1):
            row = gy * grid.w
            for gx in range(cx0, cx1 + 1):
                c[row + gx] += 1

    covered = array("f", (1.0 if any(counts[z][i] for z in zones) else 0.0 for i in range(n)))
    land = _fill_holes(_threshold(_blur(covered, grid, BLUR_CELLS), 0.5), grid)

    # Zone per land cell: most overlays wins; uncovered land goes to the nearest labeled cell.
    label = array("h", [-1] * n)
    for i in range(n):
        if land[i]:
            best, best_n = -1, 0
            for zi, z in enumerate(zones):
                if counts[z][i] > best_n:
                    best, best_n = zi, counts[z][i]
            label[i] = best
    _spread(label, land, grid)
    for _ in range(MODE_PASSES):
        label = _mode_filter(label, land, grid)

    land_polys = _trace(land, grid)
    zone_polys = {}
    labels = {}
    for zi, z in enumerate(zones):
        mask = bytearray(1 if label[i] == zi else 0 for i in range(n))
        polys = _trace(mask, grid)
        if polys:
            zone_polys[z] = polys
            labels[z] = _label_point(mask, grid)
    return land_polys, zone_polys, labels


# --------------------------------------------------------------------------- raster helpers

def _blur(src: array, grid: Grid, r: int) -> array:
    w, h = grid.w, grid.h
    cur = src
    for _ in range(3):
        tmp = array("f", bytes(4 * w * h))
        for y in range(h):  # horizontal pass, running sum
            row = y * w
            acc = 0.0
            for x in range(-r, r + 1):
                if 0 <= x < w:
                    acc += cur[row + x]
            for x in range(w):
                tmp[row + x] = acc / (2 * r + 1)
                if x - r >= 0:
                    acc -= cur[row + x - r]
                if x + r + 1 < w:
                    acc += cur[row + x + r + 1]
        out = array("f", bytes(4 * w * h))
        for x in range(w):  # vertical pass
            acc = 0.0
            for y in range(-r, r + 1):
                if 0 <= y < h:
                    acc += tmp[y * w + x]
            for y in range(h):
                out[y * w + x] = acc / (2 * r + 1)
                if y - r >= 0:
                    acc -= tmp[(y - r) * w + x]
                if y + r + 1 < h:
                    acc += tmp[(y + r + 1) * w + x]
        cur = out
    return cur


def _threshold(src: array, t: float) -> bytearray:
    return bytearray(1 if v >= t else 0 for v in src)


def _fill_holes(mask: bytearray, grid: Grid) -> bytearray:
    """Water not connected to the grid's edge is a gap between overlays, not a lake: fill it."""
    w, h = grid.w, grid.h
    outside = bytearray(w * h)
    q = deque(i for i in range(w * h) if (i % w in (0, w - 1) or i // w in (0, h - 1)) and not mask[i])
    for i in q:
        outside[i] = 1
    while q:
        i = q.popleft()
        x, y = i % w, i // w
        for j in (i - 1 if x else -1, i + 1 if x < w - 1 else -1, i - w if y else -1, i + w if y < h - 1 else -1):
            if j >= 0 and not mask[j] and not outside[j]:
                outside[j] = 1
                q.append(j)
    return bytearray(0 if outside[i] else 1 for i in range(w * h))


def _spread(label: array, land: bytearray, grid: Grid) -> None:
    """Give unlabeled land cells the label of the nearest labeled cell (breadth-first)."""
    w, h = grid.w, grid.h
    q = deque(i for i in range(w * h) if label[i] >= 0)
    while q:
        i = q.popleft()
        x, y = i % w, i // w
        for j in (i - 1 if x else -1, i + 1 if x < w - 1 else -1, i - w if y else -1, i + w if y < h - 1 else -1):
            if j >= 0 and land[j] and label[j] < 0:
                label[j] = label[i]
                q.append(j)


def _mode_filter(label: array, land: bytearray, grid: Grid) -> array:
    w, h = grid.w, grid.h
    out = array("h", label)
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            i = y * w + x
            if not land[i]:
                continue
            tally: dict[int, int] = {}
            for dy in (-w, 0, w):
                for dx in (-1, 0, 1):
                    v = label[i + dy + dx]
                    if v >= 0:
                        tally[v] = tally.get(v, 0) + 1
            best = max(tally.items(), key=lambda kv: (kv[1], kv[0] == label[i]))[0]
            out[i] = best
    return out


def _label_point(mask: bytearray, grid: Grid) -> tuple[float, float]:
    """The zone cell farthest from the zone's edge: a good spot for its name."""
    w, h = grid.w, grid.h
    dist = array("i", [-1] * (w * h))
    q = deque()
    for i in range(w * h):
        if mask[i]:
            x, y = i % w, i // w
            if x in (0, w - 1) or y in (0, h - 1) or not (mask[i - 1] and mask[i + 1] and mask[i - w] and mask[i + w]):
                dist[i] = 0
                q.append(i)
    best = q[0] if q else 0
    while q:
        i = q.popleft()
        if dist[i] > dist[best]:
            best = i
        x, y = i % w, i // w
        for j in (i - 1 if x else -1, i + 1 if x < w - 1 else -1, i - w if y else -1, i + w if y < h - 1 else -1):
            if j >= 0 and mask[j] and dist[j] < 0:
                dist[j] = dist[i] + 1
                q.append(j)
    return grid.to_map(best % w + 0.5, best // w + 0.5)


# --------------------------------------------------------------------------- tracing

def _trace(mask: bytearray, grid: Grid) -> list[list[tuple[float, float]]]:
    """Marching squares around the cells of `mask`; returns closed, simplified, smoothed loops."""
    w, h = grid.w, grid.h
    at = lambda x, y: 1 if 0 <= x < w and 0 <= y < h and mask[y * w + x] else 0  # noqa: E731
    # Segments between edge midpoints of each 2x2 sample square (samples at cell centers). Every
    # midpoint ends up with exactly two neighbors, so walking the neighbors traces closed loops.
    nbr: dict[tuple[float, float], list[tuple[float, float]]] = {}

    def seg(a, b):
        nbr.setdefault(a, []).append(b)
        nbr.setdefault(b, []).append(a)

    for y in range(-1, h):
        for x in range(-1, w):
            tl, tr, br, bl = at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)
            case = tl << 3 | tr << 2 | br << 1 | bl
            if case in (0, 15):
                continue
            top, right, bottom, left = (x + 1, y + 0.5), (x + 1.5, y + 1), (x + 1, y + 1.5), (x + 0.5, y + 1)
            # Saddles (5, 10) keep the two inside cells connected.
            table = {
                1: [(left, bottom)], 2: [(bottom, right)], 3: [(left, right)], 4: [(right, top)],
                5: [(left, top), (right, bottom)], 6: [(bottom, top)], 7: [(left, top)], 8: [(top, left)],
                9: [(top, bottom)], 10: [(top, right), (bottom, left)], 11: [(top, right)], 12: [(right, left)],
                13: [(right, bottom)], 14: [(bottom, left)],
            }
            for a, b in table[case]:
                seg(a, b)

    loops = []
    seen: set[tuple[float, float]] = set()
    for start in nbr:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            a, b = nbr[cur][0], nbr[cur][1]
            n = b if a == prev else a
            if n == start or n in seen:
                break
            loop.append(n)
            seen.add(n)
            prev, cur = cur, n
        if len(loop) >= 4 and abs(_area(loop)) >= MIN_LOOP_CELLS:
            # Simplify the closed loop as two open halves (its start and end point coincide).
            k = max(range(len(loop)), key=lambda i: (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2)
            half1 = _simplify(loop[: k + 1], SIMPLIFY)
            half2 = _simplify(loop[k:] + [loop[0]], SIMPLIFY)
            pts = _chaikin(half1[:-1] + half2[:-1], 2)
            loops.append([grid.to_map(px, py) for px, py in pts])
    return loops


def _area(loop):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(loop, loop[1:] + loop[:1])) / 2


def _simplify(pts, tol):
    """Douglas-Peucker, iterative."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        (x1, y1), (x2, y2) = pts[s], pts[e]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** 0.5 or 1e-9
        best, bi = 0.0, -1
        for i in range(s + 1, e):
            d = abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / norm
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(s, bi), (bi, e)]
    return [p for p, k in zip(pts, keep) if k]


def _chaikin(loop, passes):
    for _ in range(passes):
        out = []
        for a, b in zip(loop, loop[1:] + loop[:1]):
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        loop = out
    return loop
