"""Tests for Go module resolution in _registry (B-252).

`symbol_fabrication_go` is a HARD cap: a false positive here blocks /review by contract
(`rules/cycle-code-quality.md` § Hard gates). These tests pin the two shapes that made it
fire against 787 imports in a repository that compiles.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from scripts import _registry


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Never read or write the developer's real lookup cache."""
    monkeypatch.setenv("CODE_QUALITY_CACHE_DIR", str(tmp_path / "cache"))


@pytest.fixture(autouse=True)
def empty_module_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    """No ambient module graph unless a test asks for one.

    `go list -m all` walks UP to find go.mod, so running the suite from inside this
    repository silently answered lookups from the real 111-module graph — which made one
    test pass for a reason it was not testing. A test whose result depends on where it
    runs is not deterministic (`rules/testing.md` § 3).
    """
    monkeypatch.setattr(_registry, "_module_graph", frozenset)


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Fail the test if a lookup reaches the proxy, and record what it asked for.

    A stdlib import must be recognised WITHOUT a network round-trip: the proxy does not
    index the standard library, so asking it is both slow and guaranteed to mislead.
    """
    asked: list[str] = []

    def _forbidden(url: str) -> tuple[object, int]:
        asked.append(url)
        raise AssertionError(f"unexpected proxy lookup: {url}")

    monkeypatch.setattr(_registry, "_http_get_json", _forbidden)
    return asked


@pytest.mark.parametrize(
    "import_path",
    [
        "net/http",
        "encoding/json",
        "log/slog",
        "database/sql",
        "os/signal",
        "go/ast",
        "path/filepath",
        "net/http/httptest",
    ],
)
def test_multi_segment_stdlib_is_not_fabricated(import_path: str, no_network: list[str]) -> None:
    """322 of the 362 stdlib packages contain a slash.

    The guard treated "has no slash" as "is stdlib", so it recognised `fmt` and `os` and
    sent every one of these to the proxy, where they 404 and were reported HARD.
    """
    assert _registry.module_exists_on_go_proxy(import_path) is True
    assert no_network == []


@pytest.mark.parametrize("import_path", ["fmt", "os", "errors", "strings"])
def test_single_segment_stdlib_still_recognised(import_path: str, no_network: list[str]) -> None:
    """The case the old guard did handle must keep working."""
    assert _registry.module_exists_on_go_proxy(import_path) is True
    assert no_network == []


def test_subpackage_of_a_real_module_is_not_fabricated(monkeypatch: pytest.MonkeyPatch) -> None:
    """A sub-package is not itself a module, and the proxy will 404 on its path.

    `github.com/go-chi/chi/v5/middleware` is a real, importable package whose MODULE is
    `github.com/go-chi/chi/v5`. Resolution must walk up the path the way `go mod` does.
    """
    real_module = "github.com/go-chi/chi/v5"
    seen: list[str] = []

    def fake_get(url: str) -> tuple[object, int]:
        seen.append(url)
        return ({}, 200 if f"/{real_module}/@v/list" in url else 404)

    monkeypatch.setattr(_registry, "_http_get_json", fake_get)

    assert _registry.module_exists_on_go_proxy(f"{real_module}/middleware") is True
    assert any(f"/{real_module}/@v/list" in u for u in seen)


def test_a_genuinely_absent_module_is_still_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    """The fix widens what RESOLVES; it must not disarm the gate.

    Every prefix 404s, so nothing about this import is real and it must still come back
    False — otherwise B-252's fix would trade 787 false positives for silent blindness.
    """
    monkeypatch.setattr(_registry, "_http_get_json", lambda _url: ({}, 404))

    assert _registry.module_exists_on_go_proxy("github.com/nobody/definitely-not-real/sub") is False


def test_proxy_outage_stays_ambiguous(monkeypatch: pytest.MonkeyPatch) -> None:
    """EC-2: a 5xx is "I could not tell", never "fabricated"."""
    monkeypatch.setattr(_registry, "_http_get_json", lambda _url: (None, 503))

    assert _registry.module_exists_on_go_proxy("github.com/some/module") is None


def test_prefix_walk_stops_before_the_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """`github.com` alone is not a module path; asking for it is noise, not resolution."""
    seen: list[str] = []

    def fake_get(url: str) -> tuple[object, int]:
        seen.append(url)
        return ({}, 404)

    monkeypatch.setattr(_registry, "_http_get_json", fake_get)
    _registry.module_exists_on_go_proxy("github.com/a/b/c/d")

    assert not any(u.rstrip("/").endswith("github.com/@v/list") for u in seen)


def test_cache_written_by_older_semantics_is_discarded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A resolver fix must invalidate the answers the broken resolver cached (B-254).

    Fixing B-252 changed nothing on the first re-run: `encoding/json` was already cached as
    `exists: false` with a 24h TTL, so it short-circuited before reaching the corrected code.
    A fix that cannot be observed is indistinguishable from a fix that does not work.
    """
    import json

    cache_dir = tmp_path / "cache"
    monkeypatch.setenv("CODE_QUALITY_CACHE_DIR", str(cache_dir))
    cache_dir.mkdir(parents=True)
    (cache_dir / "go.json").write_text(
        json.dumps(
            {
                "_schema": "written-by-a-previous-resolver",
                "encoding/json": {"exists": False, "ts": _registry._now()},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        _registry,
        "_http_get_json",
        lambda _url: pytest.fail("stdlib must not reach the proxy"),
    )

    assert _registry.module_exists_on_go_proxy("encoding/json") is True


def test_cache_written_by_current_semantics_is_honoured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Versioning must not turn the cache off — a matching entry is still served."""
    import json

    cache_dir = tmp_path / "cache"
    monkeypatch.setenv("CODE_QUALITY_CACHE_DIR", str(cache_dir))
    cache_dir.mkdir(parents=True)
    (cache_dir / "go.json").write_text(
        json.dumps(
            {
                "_schema": _registry.CACHE_SCHEMA,
                "github.com/some/module": {"exists": True, "ts": _registry._now()},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        _registry, "_http_get_json", lambda _url: pytest.fail("cached entry must be served")
    )

    assert _registry.module_exists_on_go_proxy("github.com/some/module") is True


def test_private_module_resolves_from_the_local_module_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A private dependency is real; the public proxy will never say so (B-252).

    `github.com/usetheoai/theo-contracts` is required by this repository's go.mod and
    resolves for `go build`, but proxy.golang.org 404s it because the repository is
    private. Reporting it fabricated means every company with private modules gets HARD
    findings on its own working code.

    The toolchain already knows the answer — `go list -m all` — and it is authoritative,
    offline, and covers replace directives and vendoring for free.
    """
    monkeypatch.setattr(
        _registry, "_module_graph", lambda: frozenset({"github.com/usetheoai/theo-contracts"})
    )
    monkeypatch.setattr(
        _registry, "_http_get_json", lambda _url: pytest.fail("must not consult the proxy")
    )

    assert _registry.module_exists_on_go_proxy("github.com/usetheoai/theo-contracts/jwt") is True


def test_two_segment_module_path_is_tried(monkeypatch: pytest.MonkeyPatch) -> None:
    """`go.opentelemetry.io/otel` is a real module path with only two segments.

    The first cut of the prefix walk floored at three segments, so this was never asked
    about at all and came back fabricated — my own regression, caught by re-running the
    audit instead of trusting the drop from 787 to 16.
    """
    monkeypatch.setattr(_registry, "_module_graph", frozenset)
    seen: list[str] = []

    def fake_get(url: str) -> tuple[object, int]:
        seen.append(url)
        return ({}, 200 if "go.opentelemetry.io/otel/@v/list" in url else 404)

    monkeypatch.setattr(_registry, "_http_get_json", fake_get)

    assert _registry.module_exists_on_go_proxy("go.opentelemetry.io/otel/propagation") is True


def test_bare_host_is_never_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    """One segment is a host, not a module path."""
    monkeypatch.setattr(_registry, "_module_graph", frozenset)
    seen: list[str] = []
    monkeypatch.setattr(
        _registry, "_http_get_json", lambda url: (seen.append(url), ({}, 404))[1]
    )

    _registry.module_exists_on_go_proxy("github.com/a/b/c")

    assert not any(u.endswith("github.com/@v/list") for u in seen)
