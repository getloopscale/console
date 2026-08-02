package serviceversions

import (
	"testing"
	"time"
)

// Um alvo que responde `{"version":"unknown"}` NAO emitiu payload malformado: ele
// emitiu exatamente o sentinela que o contrato manda emitir quando o deploy nao
// injetou proveniencia (docs/service-version-endpoint.md). Chamar isso de "malformed
// payload" manda o operador depurar o SERVICO quando quem falhou foi a camada de
// deploy — a mesma classe de mentira que `not deployed` sobre servico saudavel.
//
// As duas causas continuam degradando para `unreachable` (ADR D8: um ok sem versao
// nao tem o que mostrar); o que muda e' a RAZAO, que e' o unico campo que diz ao
// operador onde procurar.
func TestOK_sentinel_version_reports_missing_provenance_not_malformed(t *testing.T) {
	at := time.Now()

	got := OK("theo-traefik-mcp", "unknown", "unknown", at)

	if got.State() != StateUnreachable {
		t.Fatalf("State() = %q, want unreachable (ADR D8: ok sem versao nao e ok)", got.State())
	}
	if got.reason != reasonNoProvenance {
		t.Fatalf("Reason() = %q, want %q — o payload estava bem formado; faltou proveniencia",
			got.reason, reasonNoProvenance)
	}
}

// Controle negativo: JSON que o decoder nao consegue ler CONTINUA sendo malformado.
// Sem este par, a correcao viraria um rename cego que apaga a distincao em vez de
// cria-la.
func TestOK_empty_version_still_reports_malformed_payload(t *testing.T) {
	got := OK("theo-x", "", "", time.Now())

	if got.State() != StateUnreachable {
		t.Fatalf("State() = %q, want unreachable", got.State())
	}
	if got.reason != reasonMalformedPayload {
		t.Fatalf("Reason() = %q, want %q — versao ausente do payload nao e sentinela honesta",
			got.reason, reasonMalformedPayload)
	}
}
