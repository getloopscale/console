// Package serviceversions probes the /v1/version endpoint of the platform's
// data-plane services and reports each result as a strict discriminated union.
//
// The central invariant (ADR D3/D6 of the M21 plan) is that a failure variant
// can never carry a version. Go has no sum type, so the union is enforced by
// unexported fields plus a custom MarshalJSON: a caller outside this package
// cannot build ServiceStatus{state: unreachable, version: "0.35.0"}, and the
// marshaller cannot emit one. The compiler is the guard, not code review.
package serviceversions

import (
	"encoding/json"
	"time"
)

// State is the discriminant of the union. Exactly one of the four values below
// describes a probe outcome.
type State string

const (
	// StateOK means the target answered with a usable version.
	StateOK State = "ok"
	// StateUnreachable means the target was reached for but did not yield a
	// usable version: refused, non-200, or a payload we could not use.
	StateUnreachable State = "unreachable"
	// StateTimeout means the probe did not conclude within the available budget,
	// either because the per-service deadline expired or the caller gave up.
	StateTimeout State = "timeout"
	// StateUnauthorized means the target ANSWERED but refused the probe (401/403).
	//
	// #345 — deliberadamente separado de StateUnreachable. Um 401 prova que a pilha HTTP do alvo
	// esta DE PE; o que faltou foi credencial no probe. Colapsar os dois pintava o indicador do
	// dashboard de vermelho permanente, e um indicador sempre-vermelho e um indicador desligado:
	// o usuario aprende a ignorar, e quando algo degradar de verdade ninguem olha.
	//
	// E o espelho do defeito que o reconciliador deste mesmo ambiente tinha, lendo 401 como "a
	// rota existe". Nos dois casos o erro e tratar "nao me deixaram medir" como uma medicao.
	StateUnauthorized State = "unauthorized"
	// StateNotDeployed means the target has no base URL configured, so nothing
	// was measured. It is a declared absence, not a failure.
	StateNotDeployed State = "not_deployed"
)

// unknownSentinel is the literal the targets emit when they do not know their
// own build metadata (theo-lens, theo-memory). It is normalized away at this
// boundary so it never enters our contract (ADR D8).
const unknownSentinel = "unknown"

// reasonMalformedPayload is the closed-set reason for a response that reached us
// but could not be turned into a version.
const reasonMalformedPayload = "malformed payload"

// reasonDeadlineExceeded is the fixed reason of every timeout variant. It is a
// constant rather than an error string so no internal host:port can leak (R5).
const reasonDeadlineExceeded = "deadline exceeded"

// ServiceStatus is one service's probe outcome. Every field is unexported: the
// four constructors below are the only way to build one (ADR D6).
type ServiceStatus struct {
	name      string
	state     State
	checkedAt time.Time
	version   string
	builtAt   string
	reason    string
}

// OK reports that name answered with version at instant at.
//
// An ok without a version is meaningless in a panel whose purpose is to show the
// version, so an empty or sentinel version degrades to unreachable rather than
// producing a successful variant with nothing to show (ADR D8).
func OK(name, version, builtAt string, at time.Time) ServiceStatus {
	if normalizeUnknown(version) == "" {
		return Unreachable(name, reasonMalformedPayload, at)
	}
	return ServiceStatus{
		name:      name,
		state:     StateOK,
		checkedAt: at,
		version:   version,
		builtAt:   normalizeUnknown(builtAt),
	}
}

// Unreachable reports that name could not be read, for the given closed-set
// reason. reason must never be an error string — it would carry the target's
// host and port into the browser (R5).
func Unreachable(name, reason string, at time.Time) ServiceStatus {
	return ServiceStatus{name: name, state: StateUnreachable, checkedAt: at, reason: reason}
}

// Unauthorized reports that name answered but refused the probe (401/403). NAO e degradacao: e
// ausencia de medicao, e o painel a mostra como tal em vez de afirmar saude que ninguem apurou.
func Unauthorized(name, reason string, at time.Time) ServiceStatus {
	return ServiceStatus{name: name, state: StateUnauthorized, checkedAt: at, reason: reason}
}

// Timeout reports that the probe of name did not conclude within the budget.
func Timeout(name string, at time.Time) ServiceStatus {
	return ServiceStatus{name: name, state: StateTimeout, checkedAt: at, reason: reasonDeadlineExceeded}
}

// NotDeployed reports that name has no base URL configured, so nothing was
// measured. The service is still listed: omitting it would hide that it exists
// and did not come up.
func NotDeployed(name string, at time.Time) ServiceStatus {
	return ServiceStatus{name: name, state: StateNotDeployed, checkedAt: at}
}

// State returns the union's discriminant. It is the minimal accessor the metrics
// layer needs to label a probe outcome.
func (s ServiceStatus) State() State { return s.state }

// Name returns the service this outcome describes. Together with State it is the
// whole surface the metrics label needs; nothing exposes version outside the
// marshaller, so no caller can read a version off a failure variant.
func (s ServiceStatus) Name() string { return s.name }

// statusEnvelope is the wire shape. version and built_at are only ever populated
// for the ok variant, which is what makes the union strict on the wire too.
type statusEnvelope struct {
	Name      string `json:"name"`
	State     State  `json:"state"`
	CheckedAt string `json:"checked_at"`
	Version   string `json:"version,omitempty"`
	BuiltAt   string `json:"built_at,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// MarshalJSON emits version and built_at only for the ok variant, so no failure
// payload can carry a version even if a future field were added carelessly.
func (s ServiceStatus) MarshalJSON() ([]byte, error) {
	env := statusEnvelope{
		Name:      s.name,
		State:     s.state,
		CheckedAt: s.checkedAt.UTC().Format(time.RFC3339),
	}
	if s.state == StateOK {
		env.Version = s.version
		env.BuiltAt = s.builtAt
	} else {
		env.Reason = s.reason
	}
	return json.Marshal(env)
}

// normalizeUnknown maps the targets' "unknown" sentinel to absence, so callers
// never have to remember to compare against a magic string (ADR D8).
func normalizeUnknown(v string) string {
	if v == unknownSentinel {
		return ""
	}
	return v
}
