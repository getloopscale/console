package ci

// The console and the engine share one Postgres database, and the engine owns its schema:
// the e2e mounts `getloopscale/loop-runtime` `api/internal/db/migrations` and applies them as is.
// No compiler relates a table name in a Go string here to a CREATE TABLE over there, so a
// rename on one side (the 2026-11-20 rewrite turned `loopscale_api_keys` into `loop_runtime_api_keys`
// and the role `loop_console` into `loop_console`) leaves the console querying a relation
// that does not exist (#518). These tests make that drift fail before a request does.

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

const (
	ciWorkflowPath    = "../../.github/workflows/ci.yml"
	driftWorkflowPath = "../../.github/workflows/e2e-drift.yml"
	e2eImagesEnvPath  = "../../.github/e2e-images.env"
	engineRepository  = "getloopscale/loop-runtime"
	repoRoot          = "../.."
	// Sibling layout the e2e jobs check out: loop-console/loop-console (this repo) next to
	// loop-console/loopscale (the engine). From internal/ci that is three levels up.
	defaultMigrationsDir = "../../../loopscale/api/internal/db/migrations"
)

var (
	fullSHA = regexp.MustCompile(`^[0-9a-f]{40}$`)

	envFilePin  = regexp.MustCompile(`(?m)^LOOPSCALE_ENGINE_REF=(\S+)$`)
	workflowPin = regexp.MustCompile(`(?m)^\s*LOOPSCALE_ENGINE_REF:\s*(\S+)`)
	repoLine    = regexp.MustCompile(`(?m)^\s*repository:\s*(\S+)`)

	createdTable = regexp.MustCompile(`(?i)\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?`)
	renamedTable = regexp.MustCompile(`(?i)\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?[a-z_][a-z0-9_]*\s+RENAME\s+TO\s+([a-z_][a-z0-9_]*)`)
	createdRole  = regexp.MustCompile(`(?i)\bCREATE\s+ROLE\s+([a-z_][a-z0-9_]*)`)

	// Only engine-namespaced names are checked. Generic words after FROM or UPDATE show up
	// in comments and log text, and `users` or `tenants` are not part of the rename. The
	// keyword is matched against the text right before each name (input is lower-cased).
	engineName   = regexp.MustCompile(`(loopscale|loop-runtime)_[a-z0-9_]*`)
	tableKeyword = regexp.MustCompile(`(?:^|[^.a-z0-9_])(?:from|into|update|join|table)\s+$`)
	roleKeyword  = regexp.MustCompile(`(?:create\s+role\s+|(?:^|[^a-z0-9_])to\s+|postgres://)$`)
)

type engineNameRef struct {
	name      string
	before    string // up to 32 bytes preceding the name
	qualified bool   // followed by '.', so it names a schema
}

// engineNameRefs finds every loopscale_* or loop_runtime_* identifier that starts a word.
func engineNameRefs(body string) []engineNameRef {
	var refs []engineNameRef
	for _, loc := range engineName.FindAllStringIndex(body, -1) {
		start, end := loc[0], loc[1]
		if start > 0 && isIdentByte(body[start-1]) {
			continue
		}
		from := start - 32
		if from < 0 {
			from = 0
		}
		refs = append(refs, engineNameRef{
			name:      body[start:end],
			before:    body[from:start],
			qualified: end < len(body) && body[end] == '.',
		})
	}
	return refs
}

func isIdentByte(b byte) bool {
	return b == '_' || b >= 'a' && b <= 'z' || b >= '0' && b <= '9'
}

// Every engine checkout pins the same full SHA, read from one versioned file, and names the
// repository where the engine lives now. Before #518 `ci.yml` and `.github/e2e-images.env`
// carried two different SHAs of `getloopscale/engine`, and both vanished with the rewrite.
func TestEngineCheckoutPinsAgreeAndNameLoopruntime(t *testing.T) {
	env := read(t, e2eImagesEnvPath)
	m := envFilePin.FindStringSubmatch(env)
	if m == nil {
		t.Fatalf("%s declares no LOOPSCALE_ENGINE_REF", e2eImagesEnvPath)
	}
	pin := m[1]
	if !fullSHA.MatchString(pin) {
		t.Fatalf("%s: LOOPSCALE_ENGINE_REF=%q is not a full commit SHA", e2eImagesEnvPath, pin)
	}

	ci := read(t, ciWorkflowPath)
	pins := workflowPin.FindAllStringSubmatch(ci, -1)
	if len(pins) == 0 {
		t.Fatalf("%s declares no LOOPSCALE_ENGINE_REF; the e2e jobs need the engine pin", ciWorkflowPath)
	}
	for _, p := range pins {
		if p[1] != pin {
			t.Errorf("%s pins LOOPSCALE_ENGINE_REF=%s but %s pins %s; they must move together",
				ciWorkflowPath, p[1], e2eImagesEnvPath, pin)
		}
	}

	for _, path := range []string{ciWorkflowPath, driftWorkflowPath} {
		body := read(t, path)
		if strings.Contains(body, "getloopscale/engine") {
			t.Errorf("%s still references getloopscale/engine; the engine is %s", path, engineRepository)
		}
		if !strings.Contains(body, "repository: "+engineRepository) {
			t.Errorf("%s has no checkout of %s", path, engineRepository)
		}
		for _, r := range repoLine.FindAllStringSubmatch(body, -1) {
			if strings.HasSuffix(r[1], "/engine") || strings.HasSuffix(r[1], "/loopscale") {
				t.Errorf("%s checks out %s; the engine is %s", path, r[1], engineRepository)
			}
		}
	}
}

// Every engine-namespaced table or role the console names must be one the loop-runtime
// migrations create. Needs a loop-runtime checkout: LOOP_RUNTIME_MIGRATIONS_DIR, or the sibling
// layout the e2e jobs use. The e2e jobs set REQUIRE_LOOP_RUNTIME_MIGRATIONS=1 so a missing
// checkout fails instead of skipping.
func TestConsoleSchemaNamesExistInLoopruntimeMigrations(t *testing.T) {
	dir := os.Getenv("LOOP_RUNTIME_MIGRATIONS_DIR")
	if dir == "" {
		dir = defaultMigrationsDir
	}
	ups, _ := filepath.Glob(filepath.Join(dir, "*.up.sql"))
	if len(ups) == 0 {
		if os.Getenv("REQUIRE_LOOP_RUNTIME_MIGRATIONS") == "1" {
			t.Fatalf("no *.up.sql under %s; check out %s or set LOOP_RUNTIME_MIGRATIONS_DIR", dir, engineRepository)
		}
		t.Skipf("no loop-runtime migrations under %s; set LOOP_RUNTIME_MIGRATIONS_DIR to run this check", dir)
	}

	tables, roles := map[string]bool{}, map[string]bool{}
	for _, f := range ups {
		sql := read(t, f)
		for _, m := range createdTable.FindAllStringSubmatch(sql, -1) {
			tables[strings.ToLower(m[1])] = true
		}
		for _, m := range renamedTable.FindAllStringSubmatch(sql, -1) {
			tables[strings.ToLower(m[1])] = true
		}
		for _, m := range createdRole.FindAllStringSubmatch(sql, -1) {
			roles[strings.ToLower(m[1])] = true
		}
	}

	unknown := map[string][]string{}
	err := filepath.WalkDir(repoRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", "node_modules", "dashboard", "vendor", "bin":
				return filepath.SkipDir
			}
			return nil
		}
		switch filepath.Ext(path) {
		case ".go", ".sql", ".yaml", ".yml":
		default:
			return nil
		}
		body := strings.ToLower(read(t, path))
		rel, _ := filepath.Rel(repoRoot, path)
		for _, ref := range engineNameRefs(body) {
			switch {
			case ref.qualified: // `schema.table`: the name before the dot is a schema
			case tableKeyword.MatchString(ref.before):
				if !tables[ref.name] {
					unknown["table "+ref.name] = append(unknown["table "+ref.name], rel)
				}
			case roleKeyword.MatchString(ref.before):
				if !roles[ref.name] && !tables[ref.name] {
					unknown["role "+ref.name] = append(unknown["role "+ref.name], rel)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", repoRoot, err)
	}

	keys := make([]string, 0, len(unknown))
	for k := range unknown {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		t.Errorf("%s is not created by any migration under %s; used in %s",
			k, dir, strings.Join(dedupe(unknown[k]), ", "))
	}
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	out := in[:0]
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
