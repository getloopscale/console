// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Command mock-openai is a hermetic, deterministic OpenAI-compatible server
// used ONLY by the theo-cloud <-> TheMemory end-to-end harness
// (tests/e2e/docker-compose.e2e.yaml).
//
// TheMemory's server wires `OpenAILLM` + `OpenAIEmbedder` (the official
// `openai` SDK) and routes them at `${OPENAI_BASE_URL}`. For a hermetic e2e
// (no network, no API cost, no flakiness) we point OPENAI_BASE_URL at this
// process and serve the two endpoints the write pipeline touches:
//
//	POST /v1/chat/completions  -> fact extraction. TheMemory's extraction
//	    pipeline expects JSON content shaped `{ "memory": [ { "id", "text" } ] }`
//	    (packages/core/src/domain/extraction/pipeline.ts). We echo the user
//	    message back as a single fact so the seeded text is what gets stored.
//
//	POST /v1/embeddings        -> deterministic embedding vectors of length
//	    MOCK_EMBED_DIM (default 1536 = text-embedding-3-small). Determinism
//	    matters so re-running the harness is stable.
//
// This is test infrastructure: it is NOT an OpenAI implementation, only the
// two shapes the harness exercises.
package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
)

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Messages []chatMessage `json:"messages"`
}

type chatChoice struct {
	Index   int         `json:"index"`
	Message chatMessage `json:"message"`
	Finish  string      `json:"finish_reason"`
}

type chatResponse struct {
	ID      string       `json:"id"`
	Object  string       `json:"object"`
	Model   string       `json:"model"`
	Choices []chatChoice `json:"choices"`
}

// extractedFact mirrors the shape TheMemory's AdditiveExtractionSchema parses
// from `{ "memory": [ ... ] }`.
type extractedFact struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type extraction struct {
	Memory []extractedFact `json:"memory"`
}

type embeddingsRequest struct {
	// Input may be a single string OR an array of strings — decode lazily.
	Input json.RawMessage `json:"input"`
	// The official OpenAI SDK defaults to requesting base64 (perf), then decodes
	// the Float32 bytes client-side. A mock that ignores this and returns a JSON
	// float array makes the SDK do Buffer.from(array) -> N bytes -> Float32Array
	// -> N/4 floats (the 1536->384 bug). So we MUST honor encoding_format.
	EncodingFormat string `json:"encoding_format"`
}

type embeddingDatum struct {
	Object string `json:"object"`
	Index  int    `json:"index"`
	// Either a []float64 (float format) OR a base64 string (base64 format).
	Embedding any `json:"embedding"`
}

// base64Float32 encodes a vector as little-endian Float32 bytes, base64-encoded,
// exactly as the OpenAI embeddings API does for encoding_format=base64.
func base64Float32(vec []float64) string {
	buf := make([]byte, 4*len(vec))
	for i, v := range vec {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(float32(v)))
	}
	return base64.StdEncoding.EncodeToString(buf)
}

type embeddingsResponse struct {
	Object string           `json:"object"`
	Model  string           `json:"model"`
	Data   []embeddingDatum `json:"data"`
}

func embedDim() int {
	if v := os.Getenv("MOCK_EMBED_DIM"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 1536
}

// deterministicVector derives a stable pseudo-embedding from the input text so
// repeated harness runs produce identical vectors. NOT semantically meaningful
// — the e2e asserts the proxy contract (list/forget/isolation), not recall
// quality.
func deterministicVector(text string, dim int) []float64 {
	vec := make([]float64, dim)
	seed := sha256.Sum256([]byte(text))
	for i := 0; i < dim; i++ {
		b := seed[i%len(seed)]
		// Map byte -> [-1, 1], then taper by index so vectors are not flat.
		v := (float64(b)/127.5 - 1.0) / (1.0 + float64(i%len(seed)))
		vec[i] = v
	}
	// L2-normalize (cosine-friendly, mirrors real embedders).
	var norm float64
	for _, v := range vec {
		norm += v * v
	}
	norm = math.Sqrt(norm)
	if norm > 0 {
		for i := range vec {
			vec[i] /= norm
		}
	}
	return vec
}

// lastUserContent returns the content of the last `user` message, stripping a
// leading "<role>: " prefix that TheMemory prepends when it joins the turn.
func lastUserContent(msgs []chatMessage) string {
	content := ""
	for _, m := range msgs {
		if m.Role == "user" {
			content = m.Content
		}
	}
	// TheMemory sends user content as "user: <text>" joined by newlines.
	lines := strings.Split(content, "\n")
	cleaned := make([]string, 0, len(lines))
	for _, ln := range lines {
		if idx := strings.Index(ln, ": "); idx > 0 && idx < 12 {
			cleaned = append(cleaned, ln[idx+2:])
		} else {
			cleaned = append(cleaned, ln)
		}
	}
	return strings.TrimSpace(strings.Join(cleaned, " "))
}

func handleChat(w http.ResponseWriter, r *http.Request) {
	log.Printf("POST /v1/chat/completions")
	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	fact := lastUserContent(req.Messages)
	payload := extraction{Memory: []extractedFact{}}
	if fact != "" {
		payload.Memory = append(payload.Memory, extractedFact{ID: "0", Text: fact})
	}
	content, _ := json.Marshal(payload)
	resp := chatResponse{
		ID:     "mock-chatcmpl",
		Object: "chat.completion",
		Model:  "mock-gpt",
		Choices: []chatChoice{{
			Index:   0,
			Message: chatMessage{Role: "assistant", Content: string(content)},
			Finish:  "stop",
		}},
	}
	writeJSON(w, resp)
}

func handleEmbeddings(w http.ResponseWriter, r *http.Request) {
	log.Printf("POST /v1/embeddings (dim=%d)", embedDim())
	var req embeddingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	dim := embedDim()
	asBase64 := req.EncodingFormat == "base64"
	inputs := decodeInputs(req.Input)
	data := make([]embeddingDatum, 0, len(inputs))
	for i, in := range inputs {
		vec := deterministicVector(in, dim)
		var emb any = vec
		if asBase64 {
			emb = base64Float32(vec)
		}
		data = append(data, embeddingDatum{Object: "embedding", Index: i, Embedding: emb})
	}
	log.Printf("  -> %d embedding(s), dim=%d, format=%s", len(data), dim, req.EncodingFormat)
	writeJSON(w, embeddingsResponse{Object: "list", Model: "mock-embed", Data: data})
}

// decodeInputs accepts the OpenAI `input` field as either a JSON string or a
// JSON array of strings.
func decodeInputs(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return []string{""}
	}
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		return []string{single}
	}
	var arr []string
	if err := json.Unmarshal(raw, &arr); err == nil {
		if len(arr) == 0 {
			return []string{""}
		}
		return arr
	}
	return []string{""}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "11434"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/chat/completions", handleChat)
	mux.HandleFunc("/v1/embeddings", handleEmbeddings)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	log.Printf("mock-openai listening on :%s (embed_dim=%d)", port, embedDim())
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("mock-openai: %v", err)
	}
}
