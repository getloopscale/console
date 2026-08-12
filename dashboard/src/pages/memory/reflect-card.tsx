import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Badge, Button, Card } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { cloudFetch } from '@/lib/http/api';
import { ExpandableText } from '@/pages/memory/row-cells';

/**
 * Reflect card for the Memory Playground — split from playground.tsx per the
 * 300-line module budget (UX pass 2026-07-22). Owns the reflect mutation, the
 * elapsed-seconds feedback (a real-scope reflection legitimately runs for tens
 * of seconds — a silent disabled button reads as frozen), and a READABLE result
 * rendering (derived-memory cards, not a raw JSON dump).
 */

interface DerivedMemory {
  id: string;
  text: string;
  derivedFrom?: string[];
}

interface ReflectResult {
  higherOrderMemories?: DerivedMemory[];
  [key: string]: unknown;
}

export function ReflectCard() {
  const reflect = useMutation({
    mutationFn: async () =>
      cloudFetch<ReflectResult>(
        '/v1/dashboard/memory/reflect',
        { method: 'POST', body: '{}' },
        { throwOnError: true },
      ),
  });

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!reflect.isPending) return;
    setElapsed(0);
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [reflect.isPending]);

  const derived = reflect.data?.higherOrderMemories ?? [];

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Reflect</h2>
        </div>
      </Card.Header>
      <Card.Body className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Consolidate this scope&apos;s memories — deduplicate, distill, and resolve
          conflicts. Runs the same pipeline the agent triggers automatically.
        </p>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => reflect.mutate()} disabled={reflect.isPending}>
            {reflect.isPending ? 'Reflecting…' : 'Run reflection'}
          </Button>
          {reflect.isPending ? (
            <span className="text-xs text-muted-foreground tabular-nums" role="status">
              Consolidating your memories… {elapsed}s (large scopes take a minute)
            </span>
          ) : null}
        </div>
        {reflect.isError ? (
          <Alert intent="warning" title="Could not reflect">
            The Memory service rejected the reflection. Try again in a moment.
          </Alert>
        ) : null}
        {reflect.data ? (
          derived.length === 0 ? (
            <Alert intent="success" title="Reflection complete">
              Nothing to consolidate — this scope&apos;s memories are already distinct.
            </Alert>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Reflection complete — {derived.length} consolidated{' '}
                {derived.length === 1 ? 'insight' : 'insights'}:
              </p>
              <ul className="space-y-2">
                {derived.map((m) => (
                  <li key={m.id} className="rounded border p-3 space-y-1 bg-muted/30">
                    <ExpandableText text={m.text} />
                    {m.derivedFrom && m.derivedFrom.length > 0 ? (
                      <Badge variant="outline" className="text-xs">
                        distilled from {m.derivedFrom.length}{' '}
                        {m.derivedFrom.length === 1 ? 'memory' : 'memories'}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}
      </Card.Body>
    </Card>
  );
}
