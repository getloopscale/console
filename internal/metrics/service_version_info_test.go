package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// O par que discrimina, e ele e a razao de esta metrica existir
// (getloopscale/loopscale-workspace#37).
//
// O painel de versoes e o instrumento de observabilidade da frota e nao tinha
// observabilidade propria: o counter que ja existia so materializa serie DEPOIS que
// um humano autenticado abre a tela, entao um /metrics vazio era indistinguivel de
// coletor quebrado. Metrica ausente nao pode significar duas coisas.

// Servico configurado e respondendo: state=ok E a versao real como label.
func TestServiceVersionInfo_ok_carries_the_real_version(t *testing.T) {
	SetServiceVersionInfo("loopmcp", "ok", "develop-6d0db8d")

	if got := ServiceVersionInfoValue("loopmcp", "ok", "develop-6d0db8d"); got != 1 {
		t.Fatalf("value = %v, want 1 — a serie do estado corrente tem de existir", got)
	}
}

// Servico NAO configurado: a serie EXISTE, com state=not_deployed. Nunca some.
// Se sumisse, quem le o grafico concluiria que a frota encolheu — e um alvo ausente
// seria indistinguivel de um coletor que parou.
func TestServiceVersionInfo_unconfigured_target_still_emits(t *testing.T) {
	SetServiceVersionInfo("looptrace", "not_deployed", "")

	if got := ServiceVersionInfoValue("looptrace", "not_deployed", ""); got != 1 {
		t.Fatalf("value = %v, want 1 — alvo nao configurado tem de aparecer, nao sumir", got)
	}
}

// Alvo declarado e ainda nao coletado: a serie tambem existe, com um estado PROPRIO.
// E o que torna a ausencia de serie inequivoca — ausencia passa a significar
// exatamente uma coisa: o alvo nao esta declarado.
func TestServiceVersionInfo_seeded_before_any_collection(t *testing.T) {
	SeedServiceVersionInfo("loopstore")

	if got := ServiceVersionInfoValue("loopstore", "not_collected", ""); got != 1 {
		t.Fatalf("value = %v, want 1 — alvo declarado tem serie antes da primeira coleta", got)
	}
}

// TRANSICAO — o teste que impede a metrica de mentir por acumulo. `state` e `version`
// sao LABELS, entao um Set ingenuo deixaria a serie antiga valendo 1 para sempre ao
// lado da nova, e o alvo apareceria em dois estados ao mesmo tempo. Exatamente a
// classe de mentira que o painel vem corrigindo o dia todo.
func TestServiceVersionInfo_transition_retires_the_previous_series(t *testing.T) {
	SetServiceVersionInfo("looprag", "ok", "1.2.3")
	if got := ServiceVersionInfoValue("looprag", "ok", "1.2.3"); got != 1 {
		t.Fatalf("pre-condicao falhou: value = %v, want 1", got)
	}

	SetServiceVersionInfo("looprag", "no_provenance", "")

	if got := ServiceVersionInfoValue("looprag", "ok", "1.2.3"); got != 0 {
		t.Fatalf("serie antiga sobreviveu (value = %v): o alvo apareceria em DOIS estados", got)
	}
	if got := ServiceVersionInfoValue("looprag", "no_provenance", ""); got != 1 {
		t.Fatalf("serie nova = %v, want 1", got)
	}
}

// Um alvo nunca pode aparecer com versao num estado que nao a comporta. O invariante
// do ADR D3 vive no tipo `ServiceStatus`; aqui ele e' responsabilidade de quem emite,
// e o emissor (internal/serviceversions) so passa versao quando o estado e' ok.
// Este teste trava o comportamento do SETTER caso alguem o chame errado.
func TestServiceVersionInfo_degraded_state_never_keeps_a_version_label(t *testing.T) {
	SetServiceVersionInfo("loopscale-x", "ok", "9.9.9")
	SetServiceVersionInfo("loopscale-x", "unreachable", "")

	if got := ServiceVersionInfoValue("loopscale-x", "ok", "9.9.9"); got != 0 {
		t.Fatalf("estado degradado conviveu com a versao antiga (value = %v)", got)
	}
}

// O elo que falha em SILENCIO: os testes acima leem o GaugeVec diretamente, o que
// prova o comportamento do setter e NAO prova que a metrica esta registrada. Um
// `MustRegister` esquecido deixaria todos eles verdes e o /metrics sem a serie —
// derrotando o proposito inteiro do #37, que e' justamente ser legivel de fora.
//
// E' o pilar de metrica-de-runtime do wiring triad exercido de verdade: nao "o codigo
// existe e compila", mas "a serie aparece na exposicao HTTP".
func TestServiceVersionInfo_is_actually_exposed_on_the_metrics_endpoint(t *testing.T) {
	SetServiceVersionInfo("loopscale-exposed", "ok", "9.9.9")

	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	body := rec.Body.String()
	if !strings.Contains(body, "loop_console_service_version_info") {
		t.Fatal("loop_console_service_version_info ausente do /metrics — GaugeVec nao registrado")
	}
	if !strings.Contains(body, `service="loopscale-exposed"`) || !strings.Contains(body, `version="9.9.9"`) {
		t.Error("a serie foi exposta sem os labels que a tornam util (service/version)")
	}
}
