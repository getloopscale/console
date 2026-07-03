import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Input, PageShell, Textarea } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * M44 — /lens/ask. The M33 "Ask about this step" copilot: pick a trace, ask a question, get a
 * grounded answer via the read-scope BFF (`POST /v1/dashboard/lens/traces/{id}/ask`). Read-only
 * display — no query invalidation (the answer is not managed state).
 */

interface AnswerResult {
  answer: string;
}

export function LensAskPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Lens · Ask'), [setPageTitle]);
  useRequireAuth();

  const [traceID, setTraceID] = useState('');
  const [question, setQuestion] = useState('');

  const ask = useMutation({
    mutationFn: () =>
      cloudFetch<AnswerResult>(`/v1/dashboard/lens/traces/${encodeURIComponent(traceID)}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question }),
      }),
  });

  const answer = ask.data;

  return (
    <PageShell title="Ask" description="Ask the copilot about a trace and get a grounded answer.">
      <div className="space-y-6">
        <Card>
          <Card.Body>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (traceID.trim() && question.trim()) ask.mutate();
              }}
            >
              <Input
                value={traceID}
                onChange={(e) => setTraceID(e.target.value)}
                placeholder="Trace id"
                aria-label="Trace id"
              />
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about this trace…"
                aria-label="Question"
              />
              <Button type="submit" disabled={!traceID.trim() || !question.trim() || ask.isPending}>
                {ask.isPending ? 'Asking…' : 'Ask'}
              </Button>
            </form>
            {ask.isError ? (
              <Alert intent="warning" title="Could not answer" className="mt-3">
                Try again shortly.
              </Alert>
            ) : null}
          </Card.Body>
        </Card>

        {answer ? (
          <Card>
            <Card.Header>
              <h2 className="text-base font-semibold">Answer</h2>
            </Card.Header>
            <Card.Body>
              <p className="text-sm">{answer.answer}</p>
            </Card.Body>
          </Card>
        ) : null}
      </div>
    </PageShell>
  );
}
