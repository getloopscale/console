package serviceversions

import (
	"encoding/json"
	"testing"
	"time"
)

// O par que discrimina TRES casos, nao dois. Colapsar dois deles foi o que produziu
// o rotulo mentiroso quatro vezes — e as duas medicoes que motivaram este teste sao
// casos OPOSTOS, nao variacoes do mesmo (medidos no host em 2026-08-02):
//
//   gateway MCP   {"version":"develop-6d0db8d","built_at":"2026-08-02T12:50:35.598Z"}
//                 tem PROVENIENCIA, nao tem a forma completa (sem name/git_sha/node)
//   looprag      {"name":"@usetheo/rag-api","version":"dev","git_sha":"unknown",
//                  "built_at":"unknown","node":"v22.12.0"}
//                 tem a FORMA completa, nao tem proveniencia nenhuma
//
// Se a forma parcial derrubasse o veredito, o gateway — que sabe exatamente qual
// revisao roda — seria reportado como defeituoso. Se a proveniencia ausente nao
// derrubasse, o rag sairia `ok`, afirmando uma medicao que nao houve.

// CASO 1 — forma invalida: o payload nao produz versao alguma.
func TestOK_absent_version_is_malformed_payload(t *testing.T) {
	got := OK("theo-x", "", "", time.Now())

	if got.State() != StateUnreachable {
		t.Fatalf("State() = %q, want unreachable", got.State())
	}
	if got.reason != reasonMalformedPayload {
		t.Fatalf("reason = %q, want %q", got.reason, reasonMalformedPayload)
	}
}

// CASO 2 — forma valida, proveniencia ausente. Os DOIS sentinelas que o contrato
// declara (docs/service-version-endpoint.md): `dev` para version, `unknown` para o
// resto. O alvo respondeu e foi honesto; quem falhou foi a camada de deploy.
func TestOK_provenance_sentinels_are_no_provenance(t *testing.T) {
	for _, sentinel := range []string{"unknown", "dev"} {
		t.Run(sentinel, func(t *testing.T) {
			got := OK("looprag", sentinel, "unknown", time.Now())

			// `unreachable` seria falso: o servico esta no ar e respondeu bem formado.
			// Trocar uma mentira por outra mais visivel nao e correcao.
			if got.State() != StateNoProvenance {
				t.Fatalf("State() = %q, want no_provenance — o alvo RESPONDEU bem formado", got.State())
			}
		})
	}
}

// CASO 3 — forma PARCIAL com proveniencia presente. O gateway MCP nao emite
// name/git_sha/node e ainda assim sabe sua revisao. Campo ausente que o probe nao
// consome NAO pode derrubar o veredito.
func TestOK_partial_shape_with_real_provenance_is_ok(t *testing.T) {
	got := OK("loopmcp", "develop-6d0db8d", "2026-08-02T12:50:35.598Z", time.Now())

	if got.State() != StateOK {
		t.Fatalf("State() = %q, want ok — proveniencia real; forma parcial e irrelevante", got.State())
	}
	if got.version != "develop-6d0db8d" {
		t.Fatalf("version = %q, want develop-6d0db8d", got.version)
	}
}

// CONTROLE NEGATIVO OBRIGATORIO — nenhum estado vira `ok` por AUSENCIA de dado, so
// por PRESENCA. Sem este teste as tres regras acima poderiam ser satisfeitas por um
// default permissivo que trata "nao sei" como "esta bom".
func TestNoState_becomes_ok_from_absent_data(t *testing.T) {
	absent := []struct{ name, version, builtAt string }{
		{"empty version, empty built_at", "", ""},
		{"empty version, real built_at", "", "2026-08-02T12:50:35Z"},
		{"sentinel version, empty built_at", "unknown", ""},
		{"sentinel version, sentinel built_at", "unknown", "unknown"},
		{"dev version, sentinel built_at", "dev", "unknown"},
		{"dev version, real built_at", "dev", "2026-08-02T12:50:35Z"},
	}
	for _, c := range absent {
		t.Run(c.name, func(t *testing.T) {
			if got := OK("theo-x", c.version, c.builtAt, time.Now()); got.State() == StateOK {
				t.Fatalf("State() = ok para version=%q built_at=%q — ok exige proveniencia PRESENTE",
					c.version, c.builtAt)
			}
		})
	}
}

// O invariante de tipo do ADR D3 vale para o estado novo: so a variante `ok` carrega
// versao. Um `no_provenance` que vazasse `version` reintroduziria exatamente a mentira
// que o estado existe para evitar.
func TestNoProvenance_never_marshals_a_version(t *testing.T) {
	b, err := json.Marshal(OK("looprag", "dev", "unknown", time.Now()))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := m["version"]; present {
		t.Fatalf("no_provenance emitiu version: %s", b)
	}
	if m["state"] != string(StateNoProvenance) {
		t.Fatalf("state = %v, want %q", m["state"], StateNoProvenance)
	}
}
