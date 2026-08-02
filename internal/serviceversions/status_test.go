package serviceversions

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
	"unicode"
)

var at = time.Date(2026, 7, 28, 10, 0, 0, 0, time.UTC)

func marshalToMap(t *testing.T, s ServiceStatus) map[string]any {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return m
}

func TestUnreachable_JSON_omits_version(t *testing.T) {
	m := marshalToMap(t, Unreachable("theo-rag", "connection refused", at))

	if _, present := m["version"]; present {
		t.Fatalf("unreachable payload leaked a version key: %v", m)
	}
	if m["state"] != string(StateUnreachable) {
		t.Fatalf("state = %v, want unreachable", m["state"])
	}
	if m["name"] != "theo-rag" {
		t.Fatalf("name = %v, want theo-rag", m["name"])
	}
	if m["checked_at"] != "2026-07-28T10:00:00Z" {
		t.Fatalf("checked_at = %v, want RFC3339 collection instant", m["checked_at"])
	}
	if m["reason"] != "connection refused" {
		t.Fatalf("reason = %v, want connection refused", m["reason"])
	}
}

func TestTimeout_JSON_omits_version_and_built_at(t *testing.T) {
	m := marshalToMap(t, Timeout("theo-lens", at))

	if _, present := m["version"]; present {
		t.Fatalf("timeout payload leaked a version key: %v", m)
	}
	if _, present := m["built_at"]; present {
		t.Fatalf("timeout payload leaked a built_at key: %v", m)
	}
	if m["state"] != string(StateTimeout) {
		t.Fatalf("state = %v, want timeout", m["state"])
	}
	if m["reason"] != "deadline exceeded" {
		t.Fatalf("reason = %v, want the fixed deadline exceeded reason", m["reason"])
	}
}

func TestNotDeployed_JSON_has_only_name_state_checked_at(t *testing.T) {
	m := marshalToMap(t, NotDeployed("theo-storage", at))

	want := map[string]any{
		"name":       "theo-storage",
		"state":      string(StateNotDeployed),
		"checked_at": "2026-07-28T10:00:00Z",
	}
	if !reflect.DeepEqual(m, want) {
		t.Fatalf("not_deployed payload = %v, want exactly %v", m, want)
	}
}

func TestOK_JSON_carries_version_and_built_at(t *testing.T) {
	m := marshalToMap(t, OK("theo-memory", "0.35.0", "2026-07-01T00:00:00Z", at))

	if m["state"] != string(StateOK) {
		t.Fatalf("state = %v, want ok", m["state"])
	}
	if m["version"] != "0.35.0" {
		t.Fatalf("version = %v, want 0.35.0", m["version"])
	}
	if m["built_at"] != "2026-07-01T00:00:00Z" {
		t.Fatalf("built_at = %v, want the target built_at", m["built_at"])
	}
	if _, present := m["reason"]; present {
		t.Fatalf("ok payload carried a reason: %v", m)
	}
}

func TestOK_with_unknown_built_at_omits_built_at(t *testing.T) {
	m := marshalToMap(t, OK("theo-lens", "0.12.0", "unknown", at))

	if _, present := m["built_at"]; present {
		t.Fatalf("the target sentinel leaked into our contract: %v", m)
	}
	if m["version"] != "0.12.0" {
		t.Fatalf("version = %v, want 0.12.0", m["version"])
	}
}

func TestOK_with_empty_version_degrades_to_unreachable(t *testing.T) {
	s := OK("theo-lens", "", "2026-07-01T00:00:00Z", at)

	if s.State() != StateUnreachable {
		t.Fatalf("State() = %q, want unreachable (D8: an ok without a version is meaningless)", s.State())
	}
	m := marshalToMap(t, s)
	if _, present := m["version"]; present {
		t.Fatalf("degraded payload leaked a version key: %v", m)
	}
	if m["reason"] != "malformed payload" {
		t.Fatalf("reason = %v, want malformed payload", m["reason"])
	}
}

// D8 continua valendo — o sentinela do alvo NAO e uma versao, entao isto nunca vira
// `ok`. O que mudou (2026-08-02) e o estado de destino: era `unreachable`, que afirmava
// que o alvo nao pode ser alcancado quando ele respondeu 200 com corpo bem formado.
// Agora e `no_provenance`. A distincao completa dos tres casos vive em provenance_test.go.
func TestOK_with_unknown_version_does_not_claim_unreachable(t *testing.T) {
	s := OK("theo-rag", "unknown", "", at)

	if s.State() != StateNoProvenance {
		t.Fatalf("State() = %q, want no_provenance (D8: o sentinela nao e versao; mas o alvo RESPONDEU)", s.State())
	}
	if s.State() == StateOK {
		t.Fatal("sentinela nunca pode virar ok")
	}
}

// D6: the strict union is enforced by the compiler, not by review discipline.
// An exported field would make ServiceStatus{State: "unreachable", Version: "0.35.0"}
// legal in any file of the repository.
func TestServiceStatus_has_no_exported_fields(t *testing.T) {
	typ := reflect.TypeOf(ServiceStatus{})
	for i := range typ.NumField() {
		name := typ.Field(i).Name
		if unicode.IsUpper(rune(name[0])) {
			t.Fatalf("field %q is exported — a failure variant carrying a version becomes constructible outside the package (D6)", name)
		}
	}
}
