package routes

// M16 (D4): the canonical looprag MCP surface. Kept here (not inline in cmd/main.go)
// so the one-bucket invariant test guards the ACTUAL production map — a new @getloopscale/rag-mcp
// tool that is not bucketed, or one bucketed twice, fails the test (the roadmap's tool-drift guard).

// RagMCPTools is the exhaustive set of @getloopscale/rag-mcp tool names. It MUST stay in sync
// with looprag packages/mcp/src/tools.ts TOOL_NAMES; the one-bucket test asserts every
// tool here appears in exactly one RagScopeTools bucket.
var RagMCPTools = []string{
	"ask",
	"create_collection",
	"ingest_document",
	"list_collections",
	"retrieve",
}

// RagScopeTools maps each rag data scope to the MCP tool names it grants. A rag:read key
// exposes ONLY read tools (no write tool ever). The delete bucket is empty today
// (@getloopscale/rag-mcp has no delete tool) but is present so all three data scopes are declared.
var RagScopeTools = map[string][]string{
	"rag:read":   {"ask", "list_collections", "retrieve"},
	"rag:write":  {"create_collection", "ingest_document"},
	"rag:delete": {},
}
