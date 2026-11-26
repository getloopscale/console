// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// T2.5 of plan canonical-tests-rewrite-v2 v1.0 per ADR-2026-06-17-T3 D7.
// Consumer-side Pact contract test for loop-console → loopscale-data loopmem HTTP.
//
// Shape-asserts the pact_loopmem.json file structure + interaction count +
// Service-Auth header presence. Full Pact-go library integration deferred
// pending ADR-V2-D2 broker decision.

package contract

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type pactDoc struct {
	Consumer struct {
		Name string `json:"name"`
	} `json:"consumer"`
	Provider struct {
		Name string `json:"name"`
	} `json:"provider"`
	Interactions []struct {
		Description   string                 `json:"description"`
		ProviderState string                 `json:"providerState"`
		Request       map[string]interface{} `json:"request"`
		Response      map[string]interface{} `json:"response"`
	} `json:"interactions"`
	Metadata struct {
		PactSpecification struct {
			Version string `json:"version"`
		} `json:"pactSpecification"`
	} `json:"metadata"`
}

func loadPact(t *testing.T) *pactDoc {
	t.Helper()
	wd, _ := os.Getwd()
	pactPath := filepath.Join(wd, "pact_loopmem.json")
	raw, err := os.ReadFile(pactPath)
	if err != nil {
		t.Fatalf("read pact: %v", err)
	}
	var doc pactDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse pact: %v", err)
	}
	return &doc
}

func TestPactThemory_DeclaresConsumerAndProvider(t *testing.T) {
	doc := loadPact(t)
	if doc.Consumer.Name != "loop-console" {
		t.Errorf("consumer = %q, want loop-console", doc.Consumer.Name)
	}
	if doc.Provider.Name != "loopscale-data-loopmem" {
		t.Errorf("provider = %q, want loopscale-data-loopmem", doc.Provider.Name)
	}
}

func TestPactThemory_UsesSpec_2_0_0(t *testing.T) {
	doc := loadPact(t)
	if doc.Metadata.PactSpecification.Version != "2.0.0" {
		t.Errorf("pactSpec = %q", doc.Metadata.PactSpecification.Version)
	}
}

func TestPactThemory_DeclaresAtLeast4Interactions(t *testing.T) {
	doc := loadPact(t)
	if len(doc.Interactions) < 4 {
		t.Errorf("interactions = %d, want >= 4 (memory GET + POST entry + DELETE entry + health)",
			len(doc.Interactions))
	}
}

func TestPactThemory_AuthenticatedEndpoints_DeclareServiceAuthHeader(t *testing.T) {
	doc := loadPact(t)
	for _, i := range doc.Interactions {
		path, _ := i.Request["path"].(string)
		if strings.HasSuffix(path, "/health") {
			continue
		}
		headers, _ := i.Request["headers"].(map[string]interface{})
		if headers == nil {
			t.Errorf("interaction %q missing headers", i.Description)
			continue
		}
		if _, ok := headers["X-Service-Auth"]; !ok {
			t.Errorf("interaction %q missing X-Service-Auth header", i.Description)
		}
	}
}

func TestPactThemory_MutatingEndpoints_DeclareIdempotencyKey(t *testing.T) {
	doc := loadPact(t)
	for _, i := range doc.Interactions {
		method, _ := i.Request["method"].(string)
		if method != "POST" && method != "PUT" && method != "PATCH" {
			continue
		}
		headers, _ := i.Request["headers"].(map[string]interface{})
		if _, ok := headers["Idempotency-Key"]; !ok {
			t.Errorf("mutating interaction %q (method=%s) missing Idempotency-Key", i.Description, method)
		}
	}
}
