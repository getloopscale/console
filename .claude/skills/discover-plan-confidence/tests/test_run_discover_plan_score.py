"""Regression tests for the discover-plan-confidence orchestrator.

Why this file exists: every `check_*.py` had a test, the ORCHESTRATOR had none — and the
bug lived exactly there. `_parse_thresholds` split on `|` (the allowlist format) while every
thresholds file in the workspace is written `key = value`. The parse silently produced an
EMPTY band dict, and `_verdict_for` falls through to `return "INVALID"` when it has no bands
to compare against. Net effect: *every* discovery plan scored INVALID regardless of its score
— a gate that is fail-closed and blind, which is worse than no gate, because it reports a
verdict nobody can pass and looks like it is working.

These tests pin the contract at the seam that broke: the file on disk must reach the verdict.
"""
from __future__ import annotations

from pathlib import Path

import pytest

import run_discover_plan_score as orch


BANDS_KEY_VALUE = """\
# Thresholds — the format actually used by every rules/ file in this workspace.
soft_cap.question_count_low = 3
hard_cap.question_count_max = 15
band.shippable = 90
band.shippable_with_caveats = 70
band.needs_revision = 50
band.invalid = 0
"""


def _write(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "discover-plan-thresholds.txt"
    p.write_text(body, encoding="utf-8")
    return p


def test_parses_the_key_equals_value_format_used_by_the_rules_files(tmp_path: Path) -> None:
    """The format on disk must parse. This is the assertion the bug violated."""
    bands = orch._parse_thresholds(_write(tmp_path, BANDS_KEY_VALUE))

    assert bands, "bands must not be empty — an empty dict makes every verdict INVALID"
    assert bands["SHIPPABLE"] == 90
    assert bands["SHIPPABLE_WITH_CAVEATS"] == 70
    assert bands["NEEDS_REVISION"] == 50


def test_soft_floor_score_of_89_is_shippable_with_caveats_not_invalid(tmp_path: Path) -> None:
    """A soft floor caps at 89. The script says soft caps 'do NOT trigger INVALID' (line 187).

    89 sits below band.shippable (90) and at/above band.shippable_with_caveats (70), so the
    honest verdict is SHIPPABLE_WITH_CAVEATS. Returning INVALID here would make the soft
    floor indistinguishable from a fabricated citation — a 49-cap offence.
    """
    bands = orch._parse_thresholds(_write(tmp_path, BANDS_KEY_VALUE))

    assert orch._verdict_for(89.0, bands) == "SHIPPABLE_WITH_CAVEATS"


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (100.0, "SHIPPABLE"),
        (90.0, "SHIPPABLE"),
        (89.9, "SHIPPABLE_WITH_CAVEATS"),
        (70.0, "SHIPPABLE_WITH_CAVEATS"),
        (69.9, "NEEDS_REVISION"),
        (50.0, "NEEDS_REVISION"),
        (49.0, "INVALID"),
        (0.0, "INVALID"),
    ],
)
def test_band_boundaries_are_inclusive_at_the_floor(
    tmp_path: Path, score: float, expected: str
) -> None:
    """Each band owns its floor value; the one below it belongs to the next band down."""
    bands = orch._parse_thresholds(_write(tmp_path, BANDS_KEY_VALUE))

    assert orch._verdict_for(score, bands) == expected


def test_pipe_delimited_format_still_parses(tmp_path: Path) -> None:
    """Backward compatibility: if any file in the wild uses `NAME | value`, keep reading it."""
    bands = orch._parse_thresholds(_write(tmp_path, "SHIPPABLE | 90\nNEEDS_REVISION | 50\n"))

    assert bands["SHIPPABLE"] == 90
    assert bands["NEEDS_REVISION"] == 50


def test_the_projects_own_thresholds_file_yields_usable_bands() -> None:
    """The real file this project ships must produce bands — not an empty dict.

    Guards the exact production configuration, so a future edit that reverts the format
    fails here instead of silently INVALIDating every discovery plan again.
    """
    project_root = Path(__file__).resolve().parents[4]
    thresholds = project_root / ".claude" / "rules" / "discover-plan-thresholds.txt"
    if not thresholds.exists():
        pytest.skip(f"project thresholds file not present at {thresholds}")

    bands = orch._parse_thresholds(thresholds)

    assert bands, f"{thresholds} parsed to an empty band dict"
    assert "SHIPPABLE" in bands
