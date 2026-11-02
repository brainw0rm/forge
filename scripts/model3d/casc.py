"""Game files by file id from wago.tools, cached on disk (pipeline/.cache/casc/)."""

from __future__ import annotations

import urllib.request
from pathlib import Path

CACHE = Path(__file__).resolve().parents[2] / "pipeline" / ".cache" / "casc"
UA = "ForeverForge/1.0 (+https://wow-forever-forge.com)"


def file(fdid: int, build: str) -> bytes:
    path = CACHE / build / str(fdid)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(f"https://wago.tools/api/casc/{fdid}?version={build}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as res:
            path.write_bytes(res.read())
    return path.read_bytes()
