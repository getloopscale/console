"""Reading the verdict bands off a thresholds file.

Its own module because it is its own responsibility: the orchestrator decides a verdict,
this decides what the configuration on disk says. Keeping them together is what let a parse
bug hide inside a 300-line file with no test of its own.

Two on-disk formats are accepted, because both exist in the wild:

    band.shippable = 90     # every rules/*-thresholds.txt in this workspace
    SHIPPABLE | 90          # pipe form, kept for backward compatibility

An empty result is a silent catastrophe: the caller's `_verdict_for` falls through to INVALID
when it has no band to compare against, so every plan would be rejected with a verdict nobody
can pass. Callers must treat empty as a configuration error, never as "no bands configured".
"""
from __future__ import annotations

from pathlib import Path

BAND_PREFIX = "band."


def _split_band_line(line: str) -> tuple[str, str] | None:
    """Return (name, raw_value) for one line, or None when the line carries no band."""
    stripped = line.split("#", 1)[0].strip()
    if not stripped:
        return None

    if "|" in stripped:
        name, _, value = stripped.partition("|")
        return name.strip(), value.strip()

    if "=" not in stripped:
        return None

    key, _, value = stripped.partition("=")
    key = key.strip()
    # soft_cap.* / hard_cap.* share the file but are read elsewhere; letting them in
    # would put junk keys in the band table.
    if not key.startswith(BAND_PREFIX):
        return None
    return key[len(BAND_PREFIX) :].upper(), value.strip()


def parse_thresholds(path: Path) -> dict[str, int]:
    """Parse verdict bands from `path`. Unparseable values are skipped, not guessed."""
    bands: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        parsed = _split_band_line(line)
        if parsed is None:
            continue
        name, raw_value = parsed
        try:
            bands[name] = int(raw_value)
        except ValueError:
            continue
    return bands
