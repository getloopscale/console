"""T1.4 — GoDetector.detect_dead_code (deadcode wrapper) tests."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.detectors.go import GoDetector

pytestmark = pytest.mark.go


# The shape `deadcode -json` ACTUALLY emits: a list of packages, each carrying Funcs.
#
# This fixture used to encode `{"position": "...", "name": "..."}` — flat, lowercase, one
# entry per symbol. No version of the tool emits that. The parser was written against the
# same invented shape, so the test agreed with the bug and passed while every real finding
# came out as `<unknown>` (B-255). A mock that mirrors the implementation's misunderstanding
# proves the two agree, not that either is right.
_DEADCODE_POSITIVE_JSON = json.dumps(
    [
        {
            "Name": "main",
            "Path": "github.com/example/app",
            "Funcs": [
                {
                    "Name": "unreachableFunc",
                    "Position": {"File": "main.go", "Line": 42, "Col": 6},
                    "Generated": False,
                }
            ],
        },
        {
            "Name": "helper",
            "Path": "github.com/example/app/internal",
            "Funcs": [
                {
                    "Name": "orphanMethod",
                    "Position": {"File": "internal/helper.go", "Line": 7, "Col": 1},
                    "Generated": False,
                }
            ],
        },
    ]
)

_DEADCODE_CLEAN_JSON = json.dumps([])


def _mock_run(stdout: str, returncode: int = 0):
    class _R:
        def __init__(self) -> None:
            self.stdout = stdout
            self.stderr = ""
            self.returncode = returncode

    return _R()


def test_go_detector_flags_unreachable_function(tmp_path: Path) -> None:
    det = GoDetector()
    with patch("subprocess.run", return_value=_mock_run(_DEADCODE_POSITIVE_JSON, 0)):
        findings = det.detect_dead_code(tmp_path)
    dead = [f for f in findings if f.detector == "d1_dead_code"]
    assert any("unreachableFunc" in f.symbol_or_line for f in dead)
    assert any("orphanMethod" in f.symbol_or_line for f in dead)


def test_go_detector_no_findings_on_clean(tmp_path: Path) -> None:
    det = GoDetector()
    with patch("subprocess.run", return_value=_mock_run(_DEADCODE_CLEAN_JSON, 0)):
        findings = det.detect_dead_code(tmp_path)
    dead = [f for f in findings if f.detector == "d1_dead_code"]
    assert dead == []


def test_go_detector_emits_auditor_unavailable_when_deadcode_missing(tmp_path: Path) -> None:
    det = GoDetector()
    with patch("subprocess.run", side_effect=FileNotFoundError("deadcode binary missing")):
        findings = det.detect_dead_code(tmp_path)
    assert len(findings) == 1
    assert "auditor_unavailable_deadcode" in findings[0].allowlist_key


# --- B-255: the parser read packages as symbols ------------------------------------------

_DEADCODE_REAL_SHAPE = [
    {
        "Name": "billing",
        "Path": "github.com/usetheoai/theo-cloud/internal/billing",
        "Funcs": [
            {
                "Name": "unusedHelper",
                "Position": {"File": "internal/billing/cost.go", "Line": 42, "Col": 6},
            },
            {
                "Name": "alsoUnused",
                "Position": {"File": "internal/billing/cost.go", "Line": 87, "Col": 6},
            },
        ],
    },
    {
        "Name": "flatted",
        "Path": "github.com/usetheoai/theo-cloud/dashboard/node_modules/flatted/golang/pkg/flatted",
        "Funcs": [
            {
                "Name": "Stringify",
                "Position": {
                    "File": "dashboard/node_modules/flatted/golang/pkg/flatted/flatted.go",
                    "Line": 16,
                    "Col": 6,
                },
            }
        ],
    },
]


def test_deadcode_findings_name_the_function_file_and_line() -> None:
    """`deadcode -json` emits PACKAGES containing Funcs; each Func is the finding.

    The parser looked for lowercase `name` / `position` at the package level — keys that do
    not exist there — so both defaults fired and every finding read
    `Unreachable Go symbol '<unknown>' at <unknown>:0:0`. It also never descended into
    Funcs, so 28 dead functions were reported as 5 findings (B-255).
    """
    det = GoDetector()

    findings = det._parse_deadcode_json(_DEADCODE_REAL_SHAPE)

    billing = [f for f in findings if "billing" in f.file_path]
    assert len(billing) == 2, "one finding per dead FUNCTION, not per package"
    assert {f.symbol_or_line for f in billing} == {
        "unusedHelper @ internal/billing/cost.go:42:6",
        "alsoUnused @ internal/billing/cost.go:87:6",
    }
    assert all("<unknown>" not in f.message for f in findings)


def test_each_deadcode_finding_gets_a_distinct_allowlist_key() -> None:
    """One symbol must be exemptable without exempting the rest.

    Every finding previously carried the same key (built from `<unknown>`), so a single
    allowlist entry would have silenced all of them at once.
    """
    det = GoDetector()

    keys = [f.allowlist_key for f in det._parse_deadcode_json(_DEADCODE_REAL_SHAPE)]

    assert len(keys) == len(set(keys))


def test_vendored_trees_are_not_audited_for_dead_code() -> None:
    """Go source vendored inside an npm package is not ours to garbage-collect."""
    det = GoDetector()

    findings = det._parse_deadcode_json(_DEADCODE_REAL_SHAPE)

    assert not any("node_modules" in f.file_path for f in findings)
