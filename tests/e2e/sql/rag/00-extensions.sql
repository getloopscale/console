-- M18 e2e — theo-rag's 0000 migration uses the pgvector `vector` type + an HNSW index,
-- so the extension MUST exist before the drizzle migrations run. ankane/pgvector bundles it.
CREATE EXTENSION IF NOT EXISTS vector;
