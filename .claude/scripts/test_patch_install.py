"""B-250 — the patcher must not revert a local fix in silence.

## What happened

2026-08-12, mid-session. A plugin update overwrote 22 tracked files in the working tree. Three of
them were fixes **committed earlier in that same session**:

    check_evidence_pointers.py       B-247 regex fix   -> reverted to the broken `\\b` anchor
    test_check_evidence_pointers.py  B-247 tests       -> 32 lines deleted, both regressions gone
    fixtures/good-opportunity.md     B-248 fix         -> reverted to standalone-layout pointers

`git diff` confirmed the patch made no other change to those three files: a pure revert, not a
merge. It was noticed only because the plan's Integration Validation happened to re-run the
neighbouring suite — 35 passed became 32 passed + 1 failed. Nothing warned.

## Why the first guard did not close it

A `LOCAL_EDIT` check was added afterwards, and it asks `git diff --quiet -- <path>`: does the
working tree differ from HEAD? A fix that is **committed** answers no. So the guard covers the
uncommitted case and misses the one that actually occurred — which is the harder one, because
committing is exactly what a careful person does before running an installer.

The signal has to be "does this file differ from what the last patch WROTE", not "does it differ
from HEAD". That needs the patcher to remember what it wrote, which is what `.patch-state` is for.

These tests drive the real script against a real temporary git repository.
"""
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent / "patch_install.sh"
SOURCE_ECOSYSTEM = Path(__file__).parent.parent


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        env={
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@t",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@t",
            "PATH": "/usr/bin:/bin",
            "HOME": str(cwd),
        },
    )


def _run_patch(target: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), str(target)],
        capture_output=True,
        text=True,
    )


@pytest.fixture
def target(tmp_path: Path) -> Path:
    """A consumer project with `.claude/` installed and everything committed."""
    project = tmp_path / "consumer"
    (project / ".claude" / "skills").mkdir(parents=True)
    _git(project, "init", "-q")
    _run_patch(project)  # first patch: establishes the installed baseline
    _git(project, "add", "-A")
    _git(project, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "install")
    return project


def _a_managed_file(target: Path) -> Path:
    """Any file the patcher owns, so the test does not hard-code one that may be retired."""
    state = target / ".claude" / ".patch-state" / "installed.sha256"
    assert state.exists(), "the patcher recorded nothing about what it installed"
    first = state.read_text().splitlines()[0]
    rel = first.split("  ", 1)[1]
    return target / ".claude" / rel


def test_the_patcher_records_what_it_installed(target: Path) -> None:
    """Without a record of what it wrote, the patcher cannot tell old from edited."""
    state = target / ".claude" / ".patch-state" / "installed.sha256"
    assert state.exists()
    lines = [ln for ln in state.read_text().splitlines() if ln.strip()]
    assert lines, "state file is empty"
    digest, rel = lines[0].split("  ", 1)
    assert len(digest) == 64, f"expected a sha256, got {digest!r}"
    installed = target / ".claude" / rel
    assert installed.exists()
    assert hashlib.sha256(installed.read_bytes()).hexdigest() == digest


def test_a_COMMITTED_local_fix_is_reported_by_name(target: Path) -> None:
    """The B-250 scenario verbatim: the fix is committed, so `git diff` is clean."""
    managed = _a_managed_file(target)
    rel = managed.relative_to(target / ".claude").as_posix()
    managed.write_text(managed.read_text() + "\n# a local fix, committed before patching\n")
    _git(target, "add", "-A")
    _git(target, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "local fix")

    # Precondition: this is invisible to the guard that only asks git.
    diff = subprocess.run(
        ["git", "diff", "--quiet", "--", f".claude/{rel}"], cwd=target, capture_output=True
    )
    assert diff.returncode == 0, "the fixture must be COMMITTED, not merely edited"

    result = _run_patch(target)

    assert rel in result.stdout, (
        f"the patcher overwrote a locally-fixed file without naming it.\n{result.stdout}"
    )


def test_a_merely_OUTDATED_file_is_not_reported_as_a_local_change(target: Path) -> None:
    """The other half of the DoD: 'unchanged since the last patch' must stay quiet.

    A guard that shouts on every overwrite is a guard people learn to scroll past, and then the
    one line that mattered scrolls past with it.
    """
    managed = _a_managed_file(target)
    rel = managed.relative_to(target / ".claude").as_posix()

    # Simulate an older install: the file differs from source, and the recorded hash agrees that
    # this is exactly what the patcher last wrote.
    managed.write_text("stale content from an older kit release\n")
    state = target / ".claude" / ".patch-state" / "installed.sha256"
    digest = hashlib.sha256(managed.read_bytes()).hexdigest()
    rewritten = [
        f"{digest}  {rel}" if ln.endswith(f"  {rel}") else ln
        for ln in state.read_text().splitlines()
    ]
    state.write_text("\n".join(rewritten) + "\n")
    _git(target, "add", "-A")
    _git(target, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "older release")

    result = _run_patch(target)

    assert "MUDANCA LOCAL" not in result.stdout or rel not in result.stdout.split(
        "MUDANCA LOCAL", 1
    )[1], f"an out-of-date file was reported as a local edit.\n{result.stdout}"


def test_the_local_fix_is_preserved_in_a_backup(target: Path) -> None:
    """Reporting without preserving would still lose the work."""
    managed = _a_managed_file(target)
    rel = managed.relative_to(target / ".claude").as_posix()
    marker = "# the sentence that must survive the patch\n"
    managed.write_text(managed.read_text() + marker)
    _git(target, "add", "-A")
    _git(target, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "local fix")

    _run_patch(target)

    backups = list((target / ".claude" / ".patch-backups").rglob(rel))
    assert backups, f"no backup taken for {rel}"
    assert any(marker in b.read_text() for b in backups)
