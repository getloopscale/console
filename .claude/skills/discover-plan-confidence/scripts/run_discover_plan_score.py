#!/usr/bin/env python3
"""Run M2 structural discover-plan-confidence scoring.

Sibling of discover-confidence/scripts/run_blueprint_score.py — same architecture,
different artifact (discovery PLAN, not blueprint) and different node-3 checker
(check_plan_completeness instead of check_blueprint_completeness).

Hard caps enforced (per discover-plan-golden-rule.md):
  - empty_corner_{tests|deps|tools|techniques} (49)
  - fabricated_citation (49)
  - mandatory_section_missing (70)
  - insufficient_adrs (70)
  - question_budget_violated (70)
  - method_missing (70)

Soft caps (per rubric-discover-plan.md):
  - soft_floor_smell_density_high (89)
  - soft_floor_citation_density_low (89)

Copy-with-attribution from sibling (2026-05-30) per D1 of the discover-plan-confidence plan.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple

# Allow sibling imports when invoked directly
sys.path.insert(0, str(Path(__file__).parent))

from _rubric_loader import load_rubric  # noqa: E402
from _thresholds import parse_thresholds  # noqa: E402
from check_plan_completeness import check_plan_completeness  # noqa: E402
from check_reference_citations import check_reference_citations  # noqa: E402
from check_research_coverage import check_research_coverage  # noqa: E402
from check_spec_smells import check_spec_smells  # noqa: E402


SKILL_ROOT = Path(__file__).parent.parent


def _find_project_root(start: Path) -> Path:
    current = start.resolve().parent if start.is_file() else start.resolve()
    while current != current.parent:
        if (current / ".claude").exists() or (current / ".git").exists():
            return current
        current = current.parent
    return start.resolve().parent if start.is_file() else start.resolve()


def _resolve_plan(arg: str) -> Path:
    p = Path(arg)
    if p.exists() and p.suffix == ".md":
        return p.resolve()
    candidates = [
        Path(".claude/knowledge-base/discoveries/plans") / f"{arg}-plan.md",
        Path(".claude/knowledge-base/discoveries/plans") / f"{arg}.md",
    ]
    for c in candidates:
        if c.exists():
            return c.resolve()
    raise FileNotFoundError(f"Could not resolve discovery plan: {arg}")


def _resolve_rubric(arg: Path | None) -> Path:
    if arg and arg.exists():
        return arg
    return SKILL_ROOT / "templates" / "rubric-discover-plan.md"


def _resolve_thresholds(arg: Path | None, plan_path: Path) -> Path:
    if arg and arg.exists():
        return arg
    project_root = _find_project_root(plan_path)
    project_thresh = project_root / ".claude" / "rules" / "discover-plan-thresholds.txt"
    if project_thresh.exists():
        return project_thresh
    return SKILL_ROOT / "templates" / "discover-plan-thresholds.example.txt"


# Re-exported so existing callers and tests keep importing it from here.
_parse_thresholds = parse_thresholds


def _verdict_for(score: float, bands: dict[str, int]) -> str:
    sorted_bands = sorted(bands.items(), key=lambda kv: kv[1], reverse=True)
    for name, threshold in sorted_bands:
        if score >= threshold:
            return name
    return "INVALID"


class Checks(NamedTuple):
    """The four checker outputs, carried together so they stop travelling as four arguments."""

    coverage: dict[str, Any]
    citations: dict[str, Any]
    completeness: dict[str, Any]
    smells: Any


WEIGHTS = {
    "research_coverage": 0.30,
    "reference_citations": 0.30,
    "plan_completeness": 0.25,
    "structural_risk": 0.15,
}
ACTIVE_DIMENSIONS = list(WEIGHTS)
CALIBRATION = {
    "status": "PROVISIONAL_v1",
    "holdout_count": 0,
    "holdout_target": 30,
    "kappa_measured": False,
}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run M2 structural discover-plan-confidence scoring.")
    parser.add_argument("plan", help="plan slug or .md path")
    parser.add_argument("--rubric", type=Path, default=None)
    parser.add_argument("--thresholds", type=Path, default=None)
    parser.add_argument("--no-warn", action="store_true", help="suppress calibration warning")
    return parser.parse_args()


def _run_checkers(plan_path: Path, rubric_path: Path) -> Checks:
    return Checks(
        coverage=check_research_coverage(plan_path),
        citations=check_reference_citations(plan_path),
        completeness=check_plan_completeness(plan_path),
        smells=check_spec_smells(plan_path, rubric_path),
    )


def _dimension_scores(c: Checks) -> dict[str, float]:
    """Per-dimension 0-100. A plan with zero citations scores 100 — nothing was fabricated."""
    cites = c.citations
    return {
        "research_coverage": 100.0 * c.coverage["corners_populated"] / c.coverage["corners_total"],
        "reference_citations": 100.0
        if cites["total"] == 0
        else 100.0 * cites["verified"] / cites["total"],
        "plan_completeness": 100.0 * c.completeness["found"] / c.completeness["total_required"],
        "structural_risk": max(0.0, 100.0 + c.smells.total_penalty),  # penalty is negative
    }


def _hard_caps(c: Checks) -> list[tuple[str, float]]:
    """Caps that mean the plan is structurally broken (49) or materially incomplete (70)."""
    caps: list[tuple[str, float]] = [(f"empty_corner_{e}", 49.0) for e in c.coverage["empty_corners"]]
    if c.citations["fabricated"] > 0:
        caps.append(("fabricated_citation", 49.0))
    # Node 3 bundles 4 sub-checks per the check_plan_completeness module docstring.
    if c.completeness["missing_mandatory"]:
        caps.append(("mandatory_section_missing", 70.0))
    if c.completeness["adr_count"] < 2:
        caps.append(("insufficient_adrs", 70.0))
    if c.completeness["budget_violations"]:
        caps.append(("question_budget_violated", 70.0))
    if c.completeness["methodless_questions"]:
        caps.append(("method_missing", 70.0))
    return caps


def _soft_caps(c: Checks) -> list[tuple[str, float]]:
    """Conservative-bias floors. Named soft_floor_* and they do NOT make a plan INVALID."""
    caps: list[tuple[str, float]] = []
    if c.smells.total_hits >= 20:
        caps.append(("soft_floor_smell_density_high", 89.0))
    if c.citations["total"] > 0 and c.citations["citation_density_per_200w"] < 1.0:
        caps.append(("soft_floor_citation_density_low", 89.0))
    return caps


def _build_reasons(c: Checks) -> dict[str, Any]:
    top_smells = sorted(c.smells.by_category.items(), key=lambda x: -x[1])[:3]
    return {
        "research_coverage": _reason(c.coverage),
        "reference_citations": _reason(c.citations),
        "plan_completeness": _reason(c.completeness),
        "structural_risk": {
            "contributors": [f"{c.smells.total_hits} smell hits across categories"]
            if c.smells.total_hits == 0
            else [],
            "detractors": [f"{cat}: {count} hits" for cat, count in top_smells],
        },
    }


def _reason(check: dict[str, Any]) -> dict[str, Any]:
    return {"contributors": check["contributors"], "detractors": check["detractors"]}


def _build_sub_reports(c: Checks) -> dict[str, Any]:
    return {
        "research_coverage": c.coverage,
        "reference_citations": c.citations,
        "plan_completeness": c.completeness,
        "structural_risk": {
            "total_hits": c.smells.total_hits,
            "by_category": c.smells.by_category,
            "total_penalty": c.smells.total_penalty,
        },
    }


def _dimension_score_fields(scores: dict[str, float]) -> dict[str, float]:
    return {
        "research_coverage_score": round(scores["research_coverage"], 1),
        "reference_citations_score": round(scores["reference_citations"], 1),
        "plan_completeness_score": round(scores["plan_completeness"], 1),
        "risco_estrutural_score": round(scores["structural_risk"], 1),
    }


class Scoring(NamedTuple):
    """The arithmetic of one run: what each dimension scored, and what the caps did to it."""

    scores: dict[str, float]
    weighted: float
    caps: list[tuple[str, float]]
    final_score: float


def _compute_scoring(c: Checks) -> Scoring:
    scores = _dimension_scores(c)
    weighted = sum(WEIGHTS[dim] * score for dim, score in scores.items())
    caps = _hard_caps(c) + _soft_caps(c)
    return Scoring(scores, weighted, caps, min(weighted, min((v for _, v in caps), default=100.0)))


def _score_plan(plan_path: Path, c: Checks, bands: dict[str, int]) -> dict[str, Any]:
    return _build_output(plan_path, c, _compute_scoring(c), bands)


def _build_output(plan_path: Path, c: Checks, s: Scoring, bands: dict[str, int]) -> dict[str, Any]:
    return {
        "plan_slug": plan_path.stem.replace("-plan", ""),
        "plan_path": str(plan_path),
        "plan_version": None,  # TODO: parse from H1 line or "Version" tag
        "scored_at": datetime.now(timezone.utc).isoformat(),
        **_dimension_score_fields(s.scores),
        "active_dimensions": ACTIVE_DIMENSIONS,
        "weight_normalization_factor": 1.0,
        "weighted_avg": round(s.weighted, 1),
        "hard_caps_triggered": [name for name, _ in s.caps],
        "final_score_after_caps": round(s.final_score, 1),
        "verdict": _verdict_for(s.final_score, bands),
        "calibration": CALIBRATION,
        "reasons": _build_reasons(c),
        "sub_reports": _build_sub_reports(c),
    }


def _exit_code(verdict: str) -> int:
    return {"INVALID": 1, "NON_SHIPPABLE": 3}.get(verdict, 0)


def _warn_if_provisional(no_warn: bool) -> None:
    """The bands are SOTA defaults until a project holdout calibrates them — say so."""
    if no_warn or CALIBRATION["status"] != "PROVISIONAL_v1":
        return
    print(
        "WARN: PROVISIONAL_v1 calibration — score bands are SOTA defaults, "
        "not yet calibrated against project holdout.",
        file=sys.stderr,
    )


def main() -> int:
    args = _parse_args()
    try:
        plan_path = _resolve_plan(args.plan)
    except FileNotFoundError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 2

    bands = _parse_thresholds(_resolve_thresholds(args.thresholds, plan_path))
    if not bands:
        print(json.dumps({"error": "thresholds file yielded no verdict bands"}), file=sys.stderr)
        return 2

    out = _score_plan(plan_path, _run_checkers(plan_path, _resolve_rubric(args.rubric)), bands)
    print(json.dumps(out, indent=2))
    _warn_if_provisional(args.no_warn)
    return _exit_code(out["verdict"])


if __name__ == "__main__":
    sys.exit(main())
