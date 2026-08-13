"""L1 — Snapshot regression tests over real plans in the project.

Pins the expected verdict + score band for each real plan to detect silent
behavior drift. If a detector change moves a plan into a different band
(e.g., SHIPPABLE -> NON_SHIPPABLE), this test fails LOUDLY and forces
an explicit decision: either accept the new behavior (update snapshot) or
revert the detector change.

We pin BAND (not exact score) because exact scores can shift slightly with
detector refinements. Bands are the semantic gate.
"""
from __future__ import annotations

from pathlib import Path

import pytest


from run_structural import run_structural  # noqa: E402

SKILL_ROOT = Path(__file__).parent.parent
PROJECT_ROOT = SKILL_ROOT.parent.parent.parent
PLANS_DIR = SKILL_ROOT.parent.parent / "knowledge-base" / "plans"
COMPLETED_DIR = PLANS_DIR / "completed"
RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"
THRESHOLDS = SKILL_ROOT.parent.parent / "rules" / "plan-confidence-thresholds.txt"


def _resolve_plan(filename: str) -> Path | None:
    """Find plan in active dir OR completed/ subdir."""
    for candidate in (PLANS_DIR / filename, COMPLETED_DIR / filename):
        if candidate.exists():
            return candidate
    return None


# Pinned snapshots — band + expected hard caps. Scores may shift; bands MUST NOT.
#
# REBUILT 2026-08-13 (B-286). The previous nine all named plans from the KIT's standalone
# repository, none of which exists here — `_resolve_plan` returned None for every one and the
# parametrised test called `pytest.skip`. Nine snapshots, twenty-seven assertions, zero executed,
# in a file whose own docblock promises it "fails LOUDLY". Same class as B-248: a fixture written
# against the standalone layout, carried into a plugin install where it cannot resolve.
#
# Four of the nine were vacuous on a second axis as well — `verdict_in` listed every band in the
# vocabulary and `score_min` was 0, so they asserted nothing even where the plan existed. A
# snapshot that accepts every outcome is not a regression test; it is a filename in a dict.
#
# These six are real plans in THIS repository, scored on the day they were pinned, spanning three
# bands and four distinct hard caps. The bands are tight on purpose: a snapshot exists to fail when
# a detector change moves a plan, and a wide band cannot.
SNAPSHOTS: dict[str, dict[str, object]] = {
    # Clean, no caps — the band a plan is supposed to reach.
    "dashboard-followups-plan.md": {
        "verdict_in": {"SHIPPABLE"},
        "score_min": 85,
        "expected_hard_caps_subset": set(),
    },
    "dashboard-ratchet-burndown-plan.md": {
        "verdict_in": {"SHIPPABLE"},
        "score_min": 85,
        "expected_hard_caps_subset": set(),
    },
    "release-version-detection-plan.md": {
        "verdict_in": {"SHIPPABLE"},
        "score_min": 85,
        "expected_hard_caps_subset": set(),
    },
    # Soft floors only — the M4 template caps, which is the band most in-flight plans sit in.
    "http-error-contract-plan.md": {
        "verdict_in": {"SHIPPABLE_WITH_CAVEATS"},
        "score_min": 80,
        "score_max": 89,
        "expected_hard_caps_subset": {
            "soft_floor_baseline_context_incomplete",
            "soft_floor_drawbacks_section_insufficient",
            "soft_floor_unresolved_questions_section_missing",
        },
    },
    # Hard cap — coverage gap. The cap that MUST keep firing; if this one ever goes green
    # without the plan changing, the unbreakable rule has been weakened.
    "platform-overview-plan.md": {
        "verdict_in": {"INVALID"},
        "score_max": 49,
        "expected_hard_caps_subset": {"coverage_lt_100", "vague_acceptance_criteria"},
    },
    "modal-primitive-consolidation-plan.md": {
        "verdict_in": {"INVALID"},
        "score_max": 49,
        "expected_hard_caps_subset": {"coverage_lt_100"},
    },
}


@pytest.mark.parametrize("plan_filename,expected", list(SNAPSHOTS.items()))
def test_real_plan_snapshot(plan_filename: str, expected: dict[str, object]) -> None:
    plan_path = _resolve_plan(plan_filename)
    # A snapshot naming a plan that does not exist is a FIXTURE DEFECT, not a reason to skip.
    # This was `pytest.skip` and it hid nine dead snapshots for months (B-286): the file promises
    # to "fail LOUDLY" and instead reported nine green skips over zero executed assertions.
    assert plan_path is not None, (
        f"{plan_filename} is pinned in SNAPSHOTS but exists in neither plans/ nor completed/. "
        "A snapshot over a missing plan asserts nothing — delete the entry or restore the plan."
    )

    report = run_structural(plan_path, RUBRIC, THRESHOLDS)

    # Verdict band
    verdict_in = expected["verdict_in"]
    assert isinstance(verdict_in, set)
    assert report.verdict in verdict_in, (
        f"{plan_filename}: verdict drift — expected one of {verdict_in}, "
        f"got {report.verdict} (score={report.final_score_after_caps})"
    )

    # Score envelope
    if "score_min" in expected:
        score_min = expected["score_min"]
        assert isinstance(score_min, int | float)
        assert report.final_score_after_caps >= score_min, (
            f"{plan_filename}: score regression — got {report.final_score_after_caps} < {score_min}"
        )
    if "score_max" in expected:
        score_max = expected["score_max"]
        assert isinstance(score_max, int | float)
        assert report.final_score_after_caps <= score_max, (
            f"{plan_filename}: score regression — got {report.final_score_after_caps} > {score_max}"
        )

    # Hard caps subset
    expected_caps = expected["expected_hard_caps_subset"]
    assert isinstance(expected_caps, set)
    actual_caps = set(report.hard_caps_triggered)
    # Expected caps MUST be in actual; actual may have extras (we'll catch new ones via overlap)
    missing = expected_caps - actual_caps
    assert not missing, (
        f"{plan_filename}: expected hard caps {expected_caps} not in actual {actual_caps}"
    )


NOT_SNAPSHOT_FIXTURES = {
    "l2-wiring-keep-wire-followup.md",
    "memory-write-redesign-followup.md",
    "observability-cache-maturity-baseline.md",
    "observability-cache-maturity-edge-cases.md",
    # Working plan for the patterns-consumption-gate feature itself (gitignored
    # under knowledge-base/plans/); not a regression-snapshot fixture.
    "patterns-consumption-gate-plan.md",
}

# Active plans with no pinned snapshot. FROZEN 2026-08-13 at 44 (B-259).
#
# This list may SHRINK and may not GROW, and it is asserted as a set rather than a count so that
# neither direction can happen quietly. Adding a plan without a snapshot fails here; snapshotting
# one without deleting its line here fails here too.
#
# ## Why a frozen set and not "snapshot all 44"
#
# The test that guarded this was `uncovered == empty`, and it had been red for long enough that
# 40 plans had accumulated behind it — the B-228 slice then added two more without noticing,
# because a test that is always red reports nothing when it goes redder. That is the failure mode
# B-242 through B-246 each describe: a population that nobody owns, recorded by an assertion
# nobody can satisfy.
#
# Pinning all 44 would mean authoring 44 verdict bands in one sitting, for plans whose authors are
# not here, and every one of those bands would then be a snapshot somebody guessed. The band is
# only worth pinning by someone who knows what the plan is supposed to score.
#
# So the debt is frozen instead of paid: every plan written from today needs a snapshot or an
# explicit line here, and the 44 fall one at a time as their own slices touch them. That is the
# ownership the item asked for — not a promise to fix it later, a gate that makes it impossible to
# add to.
DEFERRED_SNAPSHOT = {
    "account-broker-m1-plan.md",
    "account-foundation-m0-plan.md",
    "billing-per-account-m2-plan.md",
    "capability-overviews-answer-a-question-plan.md",
    "charts-primitive-honesty-plan.md",
    "dashboard-data-access-layer-plan.md",
    "dashboard-english-only-plan.md",
    "dashboard-logs-sse-suite-repair-plan.md",
    "dashboard-rag-bff-plan.md",
    "docs-claims-guard-plan.md",
    "edge-rag-broker-plan.md",
    "edge-rag-hermetic-e2e-plan.md",
    "engine-project-cap-enforcement-plan.md",
    "event-boundary-validation-plan.md",
    "f1-safe-navigation-boundary-plan.md",
    "f2-sse-end-reason-plan.md",
    "full-chain-e2e-plan.md",
    "gateway-graphexpand-recall-ui-plan.md",
    "hermetic-project-cap-plan.md",
    "live-test-gaps-fix-plan.md",
    "m3-enforce-propagate-plan.md",
    "mcp-proxy-rag-plan.md",
    "rag-chunk-editor-reembed-plan.md",
    "rag-connectors-dashboard-plan.md",
    "rag-dashboard-ui-plan.md",
    "rag-scope-graduation-plan.md",
    "release-version-detection-edge-cases.md",
    "skills-cross-repo-flat-list-gateway-plan.md",
    "skills-cross-repo-sdk-symmetry-plan.md",
    "sse-identity-and-time-plan.md",
    "sse-stream-policy-plan.md",
    "standard-modal-component-plan.md",
    "tenant-blob-storage-plan.md",
    "themory-gateway-forget-cutover-plan.md",
    "themory-gateway-provider-capability-guard-plan.md",
    "themory-graph-gateway-dashboard-plan.md",
    "trust-guardrails-operation-plan.md",
    "workspace-bulk-operations-plan.md",
}


def _uncovered_plans() -> set[str]:
    active = {p.name for p in PLANS_DIR.glob("*.md") if p.is_file()}
    return active - NOT_SNAPSHOT_FIXTURES - set(SNAPSHOTS.keys())


def test_no_new_plan_escapes_the_snapshot_suite() -> None:
    """A plan authored from 2026-08-13 on is snapshotted, or deferred by name (B-259)."""
    new = sorted(_uncovered_plans() - DEFERRED_SNAPSHOT)
    assert not new, (
        f"{len(new)} plan(s) have no pinned snapshot and are not in DEFERRED_SNAPSHOT:\n"
        + "\n".join(f"  {n}" for n in new)
        + "\n\nAdd a SNAPSHOTS entry (a verdict band you can defend), or add the filename to "
        "DEFERRED_SNAPSHOT with the rest of the frozen debt."
    )


def test_the_deferred_list_is_still_debt_and_not_folklore() -> None:
    """The other direction: a plan that gained a snapshot, or vanished, leaves this list (B-259)."""
    stale = sorted(DEFERRED_SNAPSHOT - _uncovered_plans())
    assert not stale, (
        f"{len(stale)} entr(y/ies) in DEFERRED_SNAPSHOT no longer belong there — the plan was "
        f"snapshotted or deleted:\n" + "\n".join(f"  {s}" for s in stale) + "\n\nDelete them here."
    )


def test_score_determinism_real_plans() -> None:
    """Real plans: same input -> same output across multiple invocations."""
    for filename in SNAPSHOTS:
        plan_path = _resolve_plan(filename)
        if plan_path is None:
            continue
        r1 = run_structural(plan_path, RUBRIC, THRESHOLDS)
        r2 = run_structural(plan_path, RUBRIC, THRESHOLDS)
        assert r1.final_score_after_caps == r2.final_score_after_caps, (
            f"{filename}: nondeterministic score {r1.final_score_after_caps} != {r2.final_score_after_caps}"
        )
        assert r1.verdict == r2.verdict
        assert r1.hard_caps_triggered == r2.hard_caps_triggered
