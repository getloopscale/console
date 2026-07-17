import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { Badge, Button, Card, PageShell, Select, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M21 — /rag/ask. The core RAG surface: pick a collection, ask a question, get a
 * citation-backed answer. Mirrors the theo-memory playground (query → scored result
 * via POST). Calls the read+write dashboard BFF `POST /v1/dashboard/rag/answers`.
 */

interface Collection {
  id: string;
  name: string | null;
}
interface Source {
  document_id?: string;
  chunk_id?: string;
  score?: number;
}
interface AnswerResult {
  answer: string;
  sources?: Source[];
  confidence?: string;
  // M9 — theo-rag may echo the strategy that actually answered + a router trace
  // (e.g. graph/global fell back to vector). Surfaced when present — never fabricated.
  strategy?: string;
  router?: { strategy?: string; fell_back?: boolean; reason?: string };
}

// M9 — retrieval strategies theo-rag exposes, with outcome-shaped labels (not internal
// jargon). `vector` is the default (progressive disclosure); `graph`/`global` are GraphRAG
// (entity-graph traversal / community-summary global sensemaking), which fail-close to
// vector upstream when the collection has no graph. Kept in lockstep with the BFF enum.
const STRATEGY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'vector', label: 'Fast (semantic)' },
  { value: 'keyword', label: 'Keyword' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'graph', label: 'Entity graph' },
  { value: 'global', label: 'Global sensemaking' },
];

export function RagAskPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Ask'), [setPageTitle]);
  useRequireAuth();

  const [collectionID, setCollectionID] = useState('');
  const [question, setQuestion] = useState('');
  // M9 — default vector keeps the pre-M9 request byte-identical (strategy omitted below).
  const [strategy, setStrategy] = useState('vector');

  const collectionsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/collections'] as const,
    queryFn: () => cloudFetch<{ items: Collection[] }>('/v1/dashboard/rag/collections'),
  });

  const ask = useMutation({
    mutationFn: () =>
      cloudFetch<AnswerResult>('/v1/dashboard/rag/answers', {
        method: 'POST',
        // M9 — omit strategy for the default so the request stays byte-identical to pre-M9;
        // send the selected strategy (graph/global reach GraphRAG) otherwise.
        body: JSON.stringify({
          collection_id: collectionID,
          question,
          ...(strategy !== 'vector' ? { strategy } : {}),
        }),
      }),
  });

  const collections = collectionsQuery.data?.items ?? [];
  const answer = ask.data;

  return (
    <PageShell title="Ask" description="Ask a question and get a citation-backed answer from your documents.">
      <div className="space-y-6">
        <Card>
          <Card.Body>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (collectionID && question.trim()) ask.mutate();
              }}
            >
              <Select value={collectionID} onValueChange={setCollectionID}>
                <Select.Trigger className="w-full" aria-label="Collection">
                  <Select.Value placeholder="Select a collection…" />
                </Select.Trigger>
                <Select.Content>
                  {collections.map((c) => (
                    <Select.Item key={c.id} value={c.id}>
                      {c.name ?? c.id}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about your documents…"
                aria-label="Question"
                rows={3}
              />
              <div className="flex items-center justify-between gap-3">
                {/* M9 — retrieval strategy selector (advanced / progressive disclosure). Default
                    "Fast (semantic)" preserves the pre-M9 journey; Entity graph / Global
                    sensemaking reach GraphRAG. */}
                <Select value={strategy} onValueChange={setStrategy}>
                  <Select.Trigger className="w-56" aria-label="Retrieval strategy">
                    <Select.Value placeholder="Strategy" />
                  </Select.Trigger>
                  <Select.Content>
                    {STRATEGY_OPTIONS.map((s) => (
                      <Select.Item key={s.value} value={s.value}>
                        {s.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
                <Button
                  type="submit"
                  disabled={collectionID === '' || question.trim() === '' || ask.isPending}
                >
                  Ask
                </Button>
              </div>
            </form>
          </Card.Body>
        </Card>

        {ask.isError ? (
          <Alert intent="warning" title="Could not answer the question">
            The RAG service is unavailable. Try again shortly.
          </Alert>
        ) : answer ? (
          <Card>
            <Card.Header>
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-base font-semibold">Answer</h2>
                {answer.confidence ? <Badge variant="default">{answer.confidence}</Badge> : null}
                {/* M9 — surface which strategy actually answered + an honest fallback note when
                    theo-rag returns a router trace (graph/global fell back to vector). */}
                {answer.router?.strategy ?? answer.strategy ? (
                  <Badge variant="outline">
                    {answer.router?.strategy ?? answer.strategy}
                    {answer.router?.fell_back ? ' · fell back to vector' : ''}
                  </Badge>
                ) : null}
              </div>
            </Card.Header>
            <Card.Body className="space-y-3">
              <p className="whitespace-pre-wrap">{answer.answer}</p>
              {answer.sources && answer.sources.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                    Sources · {answer.sources.length}
                  </h4>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="ask-sources">
                    {answer.sources.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                      >
                        <span className="truncate font-mono text-xs text-foreground">
                          {s.document_id ?? s.chunk_id ?? 'source'}
                        </span>
                        {s.score != null ? (
                          <Badge variant="outline">{s.score.toFixed(3)}</Badge>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card.Body>
          </Card>
        ) : null}
      </div>
    </PageShell>
  );
}
