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
}

export function RagAskPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('RAG · Ask'), [setPageTitle]);
  useRequireAuth();

  const [collectionID, setCollectionID] = useState('');
  const [question, setQuestion] = useState('');

  const collectionsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/rag/collections'] as const,
    queryFn: () => cloudFetch<{ items: Collection[] }>('/v1/dashboard/rag/collections'),
  });

  const ask = useMutation({
    mutationFn: () =>
      cloudFetch<AnswerResult>('/v1/dashboard/rag/answers', {
        method: 'POST',
        body: JSON.stringify({ collection_id: collectionID, question }),
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
              <div className="flex justify-end">
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
              </div>
            </Card.Header>
            <Card.Body className="space-y-3">
              <p className="whitespace-pre-wrap">{answer.answer}</p>
              {answer.sources && answer.sources.length > 0 ? (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-muted-foreground">Sources</h4>
                  <ul className="space-y-1 text-sm">
                    {answer.sources.map((s, i) => (
                      <li key={i} className="font-mono">
                        {s.document_id ?? s.chunk_id ?? 'source'}
                        {s.score != null ? ` · ${s.score.toFixed(3)}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card.Body>
          </Card>
        ) : null}
      </div>
    </PageShell>
  );
}
