// Package version reports this binary's own build provenance.
//
// WHY IT EXISTS. Until M22 theo-cloud CONSUMED `/v1/version` from every sibling service
// (`internal/serviceversions/probe.go`) and served none itself. `GET /v1/version` returned a literal
// 404, measured 6/6 against the public-dev edge, while the host reconciler's third convergence axis
// probed a different, JWT-gated endpoint, read its 401 as "a rota existe" and declared provenance
// converged. The service could not say what it was running, and the thing that checks it said
// everything was fine.
//
// WHY -X AND NOT ANYTHING ELSE. The workspace spec (theo-workspace/docs/service-version-endpoint.md,
// § "Camada 3 — a proveniência, que é onde isso quebra") requires the source of truth to be the OCI
// label, never `git rev-parse` on the host. Every runtime route to that label is closed here:
//
//   - Labels live in the image config blob, not in any layer filesystem. There is nothing to read.
//   - The only API that exposes them is the Docker Engine socket, which this service does not mount
//     and must not: it would grant root-equivalent host control, the inverse of why the runtime
//     stage is distroless.
//   - Kubernetes' Downward API exposes POD labels; image labels are not among them, and
//     `status.containerStatuses[].imageID` is not a legal fieldRef.
//   - Go's free `vcs.revision` stamping via debug.ReadBuildInfo is impossible: `.dockerignore`
//     excludes `.git`, and the Dockerfile copies only go.mod/go.sum, cmd/, internal/ and openapi/.
//
// So `-X` is chosen by elimination, and it happens to be the strongest option available: the value
// lives in the binary's rodata, inside the layer whose content hash IS the image. There is no state
// outside the artifact that can go stale. Pulling a new digest necessarily changes the reported sha.
//
// That property is the whole point. The failure the spec names has one mechanism — a SEPARATE
// WRITER. theo-memory's provenance was written into a .env on the host; when its deploy moved
// push→pull the writing job vanished, nobody noticed, and the container ran the new image while
// reporting the old commit. A second, measured recurrence followed a rename. `-X` deletes the
// writer, so the "image" and "provenance" convergence axes collapse into one fact.
package version

import (
	"encoding/json"
	"net/http"
	"runtime"
)

// Injected at link time by the container build:
//
//	-ldflags "-X github.com/usetheoai/theo-cloud/internal/version.Version=$V ..."
//
// The defaults are the unstamped-build sentinels and are NOT interchangeable — see the note on
// Version below.
var (
	// Version defaults to "dev", never "unknown".
	//
	// This is a hard coupling with internal/serviceversions, not a stylistic choice.
	// serviceversions.normalizeUnknown maps the "unknown" sentinel to the empty string, and OK()
	// degrades a row with an empty version to Unreachable. A locally built gateway reporting
	// "unknown" would therefore show its own row as unreachable and pin aggregateState at
	// "degraded" forever — a permanently amber panel, which lies exactly as much as a permanently
	// green one. "dev" survives normalization and keeps the row honest.
	Version = "dev"

	// GitSHA and BuiltAt use "unknown" safely: the panel never renders GitSHA (it is infrastructure
	// data), and BuiltAt's "unknown" is normalized to absence, leaving the Built cell blank on an
	// otherwise ok row.
	GitSHA  = "unknown"
	BuiltAt = "unknown"
)

// serviceName is a compile-time literal, matching how the sibling services identify themselves.
const serviceName = "theo-cloud"

// Info is the wire contract of GET /v1/version. Five fields, all always present.
//
// The contract mandates sentinels rather than omission: a missing field and a field reporting
// "unknown" are different statements, and only the second one is honest about not knowing.
type Info struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	GitSHA  string `json:"git_sha"`
	BuiltAt string `json:"built_at"`
	Node    string `json:"node"`
}

// Read returns this binary's provenance. It is pure, allocation-light and never panics: it reads
// only immutable package-level strings set once at link time, plus runtime.Version().
func Read() Info {
	return Info{
		Name:    serviceName,
		Version: Version,
		GitSHA:  GitSHA,
		BuiltAt: BuiltAt,
		Node:    runtime.Version(),
	}
}

// Handler serves GET /v1/version.
//
// AUTH-EXEMPT BY CONTRACT. With a credential in front of it, "the service is down" and "your
// credential is wrong" produce the same response, and the operator — or the reconciler — cannot tell
// them apart. That ambiguity is precisely what this endpoint exists to remove.
func Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		// Info has no field that can fail to marshal; the error is unreachable, and swallowing a
		// write error on a response already committed would add nothing an operator could act on.
		_ = json.NewEncoder(w).Encode(Read())
	}
}
