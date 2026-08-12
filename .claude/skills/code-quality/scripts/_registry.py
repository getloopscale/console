"""Shared registry-lookup cache for D2 (symbol fabrication) detection.

Provides per-ecosystem `package_exists_*` functions that hit the respective
registry (PyPI / npm / crates.io / Go proxy) and cache results for 24h
(per `code-quality-thresholds.txt:symbol_fab.cache_ttl_hours`).

Per ADR D5: deterministic; never falls back to LLM-as-judge.
Per EC-2: HTML-response ambiguity returns None (not False) — prevents
false-positive HARD findings during registry outages.
Per EC-3: corrupted cache file is detected + discarded + re-fetched.
Per EC-9: cache writes use `write_atomic` for crash-safe concurrent CI runs.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote

from scripts._shared import write_atomic

_CACHE_DIR_ENV = "CODE_QUALITY_CACHE_DIR"
_CACHE_TTL_SECONDS = 24 * 3600  # 24h per thresholds default

# Stamped into every cache file and checked on read. Bump it whenever a resolver's
# semantics change, so answers produced by the previous semantics are discarded rather
# than served as fact.
#
# B-254: fixing B-252 appeared to do nothing, because `encoding/json` was already cached
# as `exists: false` with 24h to live and short-circuited before reaching the corrected
# resolver. A fix that cannot be observed is indistinguishable from one that does not work.
CACHE_SCHEMA = "go-module-graph+prefix-walk+stdlib-v2"
_HTTP_TIMEOUT_SECONDS = 5
_USER_AGENT = "code-quality-skill/0.1 (audit only)"


def _cache_dir() -> Path:
    override = os.environ.get(_CACHE_DIR_ENV)
    if override:
        return Path(override)
    return Path.home() / ".cache" / "code-quality" / "registry"


def _cache_path(ecosystem: str) -> Path:
    base = _cache_dir() / f"{ecosystem}.json"
    base.parent.mkdir(parents=True, exist_ok=True)
    return base


def _load_cache(ecosystem: str) -> dict[str, Any]:
    """Load the ecosystem cache. Returns empty dict on missing or corrupted (EC-3)."""
    path = _cache_path(ecosystem)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        # EC-3 — corrupted cache; discard silently and re-fetch on next lookup.
        try:
            path.unlink()
        except OSError:
            pass
        return {}
    if not isinstance(data, dict):
        return {}
    if data.get("_schema") != CACHE_SCHEMA:
        # B-254 — written by resolver semantics that no longer apply. Discarding is the
        # only safe reading: the entries may be answers to a question we no longer ask.
        return {}
    return data


def _save_cache(ecosystem: str, cache: dict[str, Any]) -> None:
    """Atomic cache write (EC-9)."""
    write_atomic(_cache_path(ecosystem), json.dumps(cache, ensure_ascii=False))


def _now() -> float:
    return time.time()


def _cache_get(ecosystem: str, key: str) -> bool | None:
    cache = _load_cache(ecosystem)
    entry = cache.get(key)
    if not entry:
        return None
    try:
        ts = float(entry.get("ts", 0))
        exists = entry.get("exists")
    except (TypeError, ValueError):
        return None
    if _now() - ts > _CACHE_TTL_SECONDS:
        return None
    if isinstance(exists, bool):
        return exists
    return None


def _cache_set(ecosystem: str, key: str, exists: bool | None) -> None:
    """Persist a lookup result. `None` results are NOT cached (ambiguous)."""
    if exists is None:
        return
    cache = _load_cache(ecosystem)
    cache["_schema"] = CACHE_SCHEMA
    cache[key] = {"exists": exists, "ts": _now()}
    _save_cache(ecosystem, cache)


# ---------------------------------------------------------------------------
# Per-ecosystem lookups
# ---------------------------------------------------------------------------


def _http_get_json(url: str, *, headers: dict[str, str] | None = None) -> tuple[Any | None, int | None]:
    """Return (json_data, status_code). On non-200 OR HTML response OR network
    failure, return (None, status_code|None) — ambiguous, NEVER False (EC-2).
    """
    try:
        import requests
    except ImportError:
        return (None, None)
    h = {"User-Agent": _USER_AGENT}
    if headers:
        h.update(headers)
    try:
        resp = requests.get(url, headers=h, timeout=_HTTP_TIMEOUT_SECONDS)
    except Exception:  # noqa: BLE001 — any network failure -> ambiguous
        return (None, None)
    if resp.status_code != 200:
        return (None, resp.status_code)
    content_type = resp.headers.get("Content-Type", "")
    if "html" in content_type.lower():
        # EC-2 — HTML response is ambiguous (likely outage page); do NOT classify as missing.
        return (None, resp.status_code)
    try:
        return (resp.json(), 200)
    except ValueError:
        return (None, resp.status_code)


def package_exists_on_pypi(name: str) -> bool | None:
    """True/False if PyPI returns 200/404. None if ambiguous (timeout, HTML, etc.)."""
    cached = _cache_get("python", name)
    if cached is not None:
        return cached
    data, status = _http_get_json(f"https://pypi.org/pypi/{quote(name, safe='-_.')}/json")
    if status == 200 and isinstance(data, dict):
        result = True
    elif status == 404:
        result = False
    else:
        return None
    _cache_set("python", name, result)
    return result


def package_exists_on_npm(name: str) -> bool | None:
    """npm registry. Scoped packages (`@scope/name`) are URL-encoded."""
    cached = _cache_get("typescript", name)
    if cached is not None:
        return cached
    encoded = quote(name, safe="@/")
    encoded = encoded.replace("/", "%2F") if name.startswith("@") else encoded
    data, status = _http_get_json(f"https://registry.npmjs.org/{encoded}")
    if status == 200 and isinstance(data, dict):
        result = True
    elif status == 404:
        result = False
    else:
        return None
    _cache_set("typescript", name, result)
    return result


def crate_exists_on_crates_io(name: str) -> bool | None:
    """crates.io. Handles `_` ↔ `-` ambiguity by trying both forms."""
    cached = _cache_get("rust", name)
    if cached is not None:
        return cached
    # crates.io stores names case-insensitively but underscores vs dashes can differ
    for candidate in {name, name.replace("_", "-"), name.replace("-", "_")}:
        data, status = _http_get_json(
            f"https://crates.io/api/v1/crates/{quote(candidate, safe='-_')}"
        )
        if status == 200 and isinstance(data, dict):
            _cache_set("rust", name, True)
            return True
        if status is None:
            # Network ambiguity on first try → bail out as None (don't keep guessing)
            return None
    _cache_set("rust", name, False)
    return False


def _go_proxy_encode(module: str) -> str:
    """Go proxy encodes uppercase via `!` prefix (e.g., gopkg.in/Yaml.v2 -> gopkg.in/!yaml.v2)."""
    out = []
    for ch in module:
        if ch.isupper():
            out.append("!" + ch.lower())
        else:
            out.append(ch)
    return "".join(out)


@lru_cache(maxsize=1)
def _stdlib_packages() -> frozenset[str]:
    """The standard library, from `go list std` — the only source that cannot drift.

    The previous guard treated "has no slash" as "is stdlib". Measured with `go list std`:
    322 of the 362 stdlib packages DO contain a slash (`net/http`, `encoding/json`,
    `log/slog`, `go/ast`, …), so all of them were sent to the proxy, which does not index
    the standard library, and every one came back 404 = "fabricated" (B-252).

    A hand-kept list would go stale every Go release; asking the toolchain does not.
    Returns an empty set when `go` is unavailable, which downgrades this to the old
    behaviour rather than crashing an audit of a repo that has no Go at all.
    """
    try:
        proc = subprocess.run(
            ["go", "list", "std"], capture_output=True, text=True, check=False, timeout=60
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return frozenset()
    if proc.returncode != 0:
        return frozenset()
    return frozenset(line.strip() for line in proc.stdout.splitlines() if line.strip())


@lru_cache(maxsize=1)
def _module_graph() -> frozenset[str]:
    """Every module the current build resolves, from `go list -m all`.

    This is the authoritative answer and the proxy is not. It covers what the public proxy
    structurally cannot:

      - PRIVATE modules (`github.com/usetheoai/theo-contracts`), which 404 forever;
      - `replace` directives pointing at a local path or a fork;
      - vendored trees.

    Reporting a private dependency as fabricated would give every company with private
    modules HARD findings on its own compiling code (B-252).

    Returns an empty set when `go` is unavailable or the directory is not a module, which
    simply falls through to the proxy rather than failing the audit.
    """
    try:
        proc = subprocess.run(
            ["go", "list", "-m", "all"],
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return frozenset()
    if proc.returncode != 0:
        return frozenset()
    # Each line is `module/path v1.2.3` (or `module/path v1 => replacement`).
    return frozenset(
        line.split()[0] for line in proc.stdout.splitlines() if line.strip() and " " in line
    )


def _resolved_by_module_graph(import_path: str) -> bool:
    """Is this import a package of some module the build already resolves?"""
    graph = _module_graph()
    if not graph:
        return False
    return any(
        import_path == module or import_path.startswith(f"{module}/") for module in graph
    )


def _module_path_candidates(import_path: str) -> list[str]:
    """Module paths to try for an import, longest first.

    An import path is not necessarily a module path: `github.com/go-chi/chi/v5/middleware`
    is a real package whose MODULE is `github.com/go-chi/chi/v5`. The proxy only answers
    for modules, so resolution walks up the way `go mod` does.

    The floor is TWO segments, not three. How many segments a module path has is
    host-dependent and cannot be decided syntactically: `go.opentelemetry.io/otel` and
    `gopkg.in/yaml.v2` are two, `github.com/owner/repo` is three. Flooring at three made
    every otel import unresolvable. One extra 404 is cheap; a wrong floor is a false HARD
    finding. A single segment is a host, never a module, and is not asked for.
    """
    parts = import_path.split("/")
    return ["/".join(parts[:i]) for i in range(len(parts), 1, -1)]


def module_exists_on_go_proxy(import_path: str) -> bool | None:
    """Does this Go import resolve — as stdlib, or as a package of some real module?

    Returns True when it resolves, False when every candidate module path is absent, and
    None when the proxy could not answer (EC-2: an outage must never read as fabricated).
    """
    cached = _cache_get("go", import_path)
    if cached is not None:
        return cached
    if "/" not in import_path or import_path in _stdlib_packages():
        # Stdlib — the proxy does not index it. No network call: asking would 404 and the
        # answer would be wrong, which is exactly how B-252 happened.
        _cache_set("go", import_path, True)
        return True
    if _resolved_by_module_graph(import_path):
        # The build already resolves it. Authoritative, offline, and true for private
        # modules the public proxy will never answer for.
        _cache_set("go", import_path, True)
        return True

    saw_ambiguous = False
    for candidate in _module_path_candidates(import_path):
        encoded = _go_proxy_encode(candidate)
        _data, status = _http_get_json(f"https://proxy.golang.org/{encoded}/@v/list")
        if status == 200:
            _cache_set("go", import_path, True)
            return True
        if status not in (404, 410):
            saw_ambiguous = True

    if saw_ambiguous:
        # At least one lookup failed for a reason other than absence. Reporting False here
        # would turn a registry outage into a HARD "fabricated" finding.
        return None
    _cache_set("go", import_path, False)
    return False


__all__ = [
    "package_exists_on_pypi",
    "package_exists_on_npm",
    "crate_exists_on_crates_io",
    "module_exists_on_go_proxy",
]
