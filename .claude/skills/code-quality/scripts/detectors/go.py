"""Go detector — wraps deadcode (D1) + Go proxy registry lookup (D2).

T1.4 implementation: detect_dead_code via deadcode subprocess.
T2.5 implementation: detect_symbol_fabrication via tree-sitter + Go proxy.
Other methods still stubs (T3.1) — T4.3 ADR DEFER for mutation.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from scripts import _registry
from scripts._shared import (
    DEFAULT_SKIP_DIRS,
    Finding,
    safe_parse_json,
    sanitize_symbol,
    to_rel_path,
)
from scripts.check_symbol_fab import extract_imports_and_calls

from . import BaseDetector


def _is_stdlib_import(module: str) -> bool:
    """True para um import da biblioteca padrao do Go.

    A regra e do proprio Go, nao uma lista heuristica: o primeiro elemento de um
    module path DEVE conter um ponto (e um dominio — `github.com/...`, `golang.org/x/...`),
    e caminhos da stdlib nunca contem. Ver `go help importpath`.

    Sem esta exclusao o D2 consultava o Go proxy por `encoding/hex`, `crypto/rand` e
    `net/http`, recebia 404 — porque de fato nao sao modulos — e emitia HARD
    `symbol_fabrication_go`. Foram 783 findings afirmando que a biblioteca padrao do
    Go nao existe, o suficiente para reprovar o gate sozinhos.
    """
    primeiro = module.split("/", 1)[0]
    return "." not in primeiro

_DEADCODE_TIMEOUT_SEC = 180


class GoDetector(BaseDetector):
    language = "go"
    manifest_marker = "go.mod"

    def detect_dead_code(self, repo_root: Path) -> list[Finding]:
        """Run `deadcode -json ./...` and parse JSON list into Findings."""
        # `-test` inclui os pacotes de teste como raizes de alcancabilidade. Sem ele o
        # deadcode enxerga so o binario, e todo seam existente PARA teste —
        # `WithInsecureCookieForTests`, `WithClock`, os contadores exercitados em
        # metrics_test.go — aparece como codigo morto. Reportar um seam de teste como
        # morto convida a apaga-lo, e apagar um seam quebra o teste que o usa: o gate
        # estaria empurrando na direcao errada.
        cmd = ["deadcode", "-test", "-json", "./..."]
        try:
            result = subprocess.run(
                cmd,
                cwd=str(repo_root),
                capture_output=True,
                text=True,
                timeout=_DEADCODE_TIMEOUT_SEC,
                check=False,
            )
        except FileNotFoundError:
            return [
                self._auditor_unavailable(
                    "deadcode binary not found (install via "
                    "`go install golang.org/x/tools/cmd/deadcode@v0.45.0`)"
                )
            ]
        except subprocess.TimeoutExpired:
            return [self._auditor_unavailable(f"deadcode timed out after {_DEADCODE_TIMEOUT_SEC}s")]
        except (subprocess.SubprocessError, OSError) as e:
            return [self._auditor_unavailable(f"deadcode invocation failed: {e}")]

        if not result.stdout.strip():
            if result.returncode != 0:
                return [
                    self._auditor_unavailable(
                        f"deadcode exit {result.returncode}: {result.stderr.strip()[:200]}"
                    )
                ]
            return []

        data, parse_finding = safe_parse_json(result.stdout, "deadcode")
        if parse_finding is not None:
            return [
                Finding(
                    detector="d1_dead_code",
                    language="go",
                    severity="SOFT_CAP",
                    file_path=".",
                    symbol_or_line="deadcode",
                    message=f"deadcode JSON output failed to parse: {parse_finding.message}",
                    allowlist_key="go|.|dead_code|auditor_output_malformed_deadcode",
                )
            ]
        return self._parse_deadcode_json(data)

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list[Finding]:
        """T2.5 — Validate Go imports against Go proxy. Skip self-module + vendored (EC-17 analog, EC-18).

        Reads `go.mod#module` from the repo root (passed as parent of first changed file)
        to identify the self-module prefix. Imports starting with that prefix are skipped.
        Imports under `vendor/` are also skipped (vendored deps).
        """
        findings: list[Finding] = []
        self_module = self._read_go_mod_module(changed_files)
        requeridos = self._declared_requires(changed_files)
        for src_file in changed_files:
            if not src_file.exists():
                continue
            rel = to_rel_path(src_file)
            # Skip files under vendor/
            if "/vendor/" in rel or rel.startswith("vendor/"):
                continue
            for sym in extract_imports_and_calls(src_file, "go"):
                if sym.kind != "import":
                    continue
                module = sym.module
                if not module:
                    continue
                if self_module and (module == self_module or module.startswith(f"{self_module}/")):
                    continue  # EC-17 analog — self-module imports
                if _is_stdlib_import(module):
                    continue
                if self._coberto_por_require(module, requeridos):
                    continue
                exists = _registry.module_exists_on_go_proxy(module)
                if exists is True:
                    continue
                sanitized = sanitize_symbol(module)
                if exists is False:
                    findings.append(
                        Finding(
                            detector="d2_symbol_fab",
                            language="go",
                            severity="HARD",
                            file_path=rel,
                            symbol_or_line=f'import "{module}"',
                            message=f"Fabricated Go module '{module}' (not found on Go proxy)",
                            allowlist_key=f"go|{rel}|symbol_fab|{sanitized}",
                        )
                    )
                else:
                    findings.append(
                        Finding(
                            detector="d2_symbol_fab",
                            language="go",
                            severity="SOFT_FLOOR",
                            file_path=rel,
                            symbol_or_line=f'import "{module}"',
                            message=f"Could not verify Go module '{module}' (ambiguous response)",
                            allowlist_key=f"go|{rel}|symbol_fab|symbol_fab_unverifiable_{sanitized}",
                        )
                    )
        return findings

    @staticmethod
    def _read_go_mod_module(changed_files: list[Path]) -> str | None:
        """Walk up from any changed file looking for go.mod; extract `module X` line."""
        for candidate in GoDetector._find_go_mods(changed_files):
            try:
                for line in candidate.read_text(encoding="utf-8").splitlines():
                    stripped = line.strip()
                    if stripped.startswith("module "):
                        return stripped.removeprefix("module ").strip()
            except OSError:
                return None
        return None

    @staticmethod
    def _find_go_mods(changed_files: list[Path]) -> list[Path]:
        """go.mod files reachable walking up from the changed files (dedup, order preserved)."""
        achados: list[Path] = []
        for src in changed_files:
            current = src.resolve().parent if src.is_file() else src.resolve()
            for _ in range(10):  # walk up at most 10 levels
                candidate = current / "go.mod"
                if candidate.is_file() and candidate not in achados:
                    achados.append(candidate)
                    break
                if current == current.parent:
                    break
                current = current.parent
        return achados

    @staticmethod
    def _declared_requires(changed_files: list[Path]) -> set[str]:
        """Module paths declared in `require` across the reachable go.mod files.

        POR QUE ISTO PRECEDE O PROXY: o proxy indexa MODULE paths; o codigo importa
        PACKAGE paths. `github.com/jackc/pgx/v5/stdlib` e um pacote dentro do modulo
        `github.com/jackc/pgx/v5` — o proxy devolve 404 para o caminho completo, e o
        detector concluia "modulo fabricado". Pior: `theo-contracts` e um modulo
        PRIVADO, entao o proxy publico responde 404 para ele PARA SEMPRE. Um 404 de
        proxy publico nao distingue "nao existe" de "nao e publico", e tratar os dois
        como HARD `symbol_fabrication_go` torna o gate permanentemente vermelho num
        repo que depende de modulo privado — que e este.

        O go.mod responde as duas perguntas offline e com autoridade: um import cujo
        prefixo esta declarado em `require` e resolvido pelo `go build ./...` que o
        CI ja roda. Se o modulo nao existisse, o build teria falhado antes deste gate.
        """
        requeridos: set[str] = set()
        for gomod in GoDetector._find_go_mods(changed_files):
            try:
                texto = gomod.read_text(encoding="utf-8")
            except OSError:
                continue
            dentro_do_bloco = False
            for linha in texto.splitlines():
                s = linha.split("//", 1)[0].strip()
                if not s:
                    continue
                if s.startswith("require ("):
                    dentro_do_bloco = True
                    continue
                if dentro_do_bloco and s == ")":
                    dentro_do_bloco = False
                    continue
                if dentro_do_bloco:
                    partes = s.split()
                elif s.startswith("require "):
                    partes = s.removeprefix("require ").split()
                else:
                    continue
                if partes:
                    requeridos.add(partes[0])
        return requeridos

    @staticmethod
    def _coberto_por_require(module: str, requeridos: set[str]) -> bool:
        """True quando `module` e o modulo declarado ou um pacote dentro dele."""
        return any(module == r or module.startswith(f"{r}/") for r in requeridos)

    def detect_orphan_exports(self, repo_root: Path) -> list[Finding]:
        raise NotImplementedError("T3.1: cross-package wiring detector not yet implemented")

    def detect_mutation_score(self, critical_paths: list[Path]) -> list[Finding]:
        # T4.3 — DEFERRED to v0.2 (evaluate go-mutesting vs gremlins first)
        raise NotImplementedError("T4.3: Go mutation testing DEFERRED to v0.2 (graceful skip)")

    # ------------------------------------------------------------------

    def _parse_deadcode_json(self, data) -> list[Finding]:
        """Parse a saida `-json` do deadcode em Findings por FUNCAO.

        Corrigido em 2026-08-06. A versao anterior lia `entry["position"]` e
        `entry["name"]` — minusculos, no nivel de topo. O `deadcode` emite uma
        lista de PACOTES com chaves capitalizadas:

            [{"Name": ..., "Path": ..., "Funcs": [{"Name": ..., "Position": {...}}]}]

        Consequencia medida antes do fix: os `.get()` caiam no default, entao cada
        PACOTE virava um Finding HARD chamado `<unknown>` em `<unknown>:0:0`.
        Neste repo isso produziu 7 findings — o numero de pacotes, nao de funcoes
        mortas — e um FAIL_HARD que bloqueava a promocao sem apontar para lugar
        nenhum. Um gate que reprova sem dizer o que reprovou custa mais que gate
        nenhum: ele treina o time a ignora-lo.

        O formato plano continua aceito, para nao regredir em outra versao.
        """
        findings: list[Finding] = []
        if not isinstance(data, list):
            return findings

        for entry in data:
            if not isinstance(entry, dict):
                continue
            funcs = entry.get("Funcs")
            if isinstance(funcs, list):
                for fn in funcs:
                    if isinstance(fn, dict):
                        f = self._finding_from_func(fn)
                        if f is not None:
                            findings.append(f)
                continue
            position, name = entry.get("position"), entry.get("name")
            if position is None and name is None:
                continue
            f = self._make_dead_finding(str(name or "<unknown>"), str(position or "<unknown>:0:0"))
            if f is not None:
                findings.append(f)
        return findings

    def _finding_from_func(self, fn: dict) -> Finding | None:
        name = str(fn.get("Name", "<unknown>"))
        pos = fn.get("Position")
        if isinstance(pos, dict):
            position = f"{pos.get('File', '<unknown>')}:{pos.get('Line', 0)}:{pos.get('Col', 0)}"
        else:
            position = str(pos or "<unknown>:0:0")
        return self._make_dead_finding(name, position)

    def _make_dead_finding(self, name: str, position: str) -> Finding | None:
        file_part = position.split(":", 1)[0] if ":" in position else position

        # DEFAULT_SKIP_DIRS existia e este detector nao o aplicava: `deadcode ./...`
        # varre tudo abaixo da raiz, incluindo `dashboard/node_modules/flatted/golang/`
        # — codigo Go dentro de uma dependencia npm. Auditar codigo morto de
        # terceiro nao e trabalho deste gate; quem decide e o dono do pacote.
        if any(p in DEFAULT_SKIP_DIRS for p in Path(file_part).parts):
            return None

        return Finding(
            detector="d1_dead_code",
            language="go",
            severity="HARD",
            file_path=file_part,
            symbol_or_line=f"{name} @ {position}",
            message=f"Unreachable Go symbol '{name}' at {position}",
            allowlist_key=f"go|{file_part}|dead_code|{sanitize_symbol(name)}",
        )

    def _auditor_unavailable(self, reason: str) -> Finding:
        return Finding(
            detector="d1_dead_code",
            language="go",
            severity="SOFT_CAP",
            file_path=".",
            symbol_or_line="deadcode",
            message=f"deadcode auditor unavailable: {reason}",
            allowlist_key="go|.|dead_code|auditor_unavailable_deadcode",
        )
