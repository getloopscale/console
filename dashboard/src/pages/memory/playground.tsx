import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Brain, Search } from 'lucide-react';
import { Badge, Button, Card, Input, PageShell, Textarea } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { ReflectCard } from '@/pages/memory/reflect-card';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/http/api';

/**
 * Plan theo-memory-dashboard-full-integration, T3.1 (ADR D5).
 *
 * /memory/playground — the live remember / recall / reflect surface.
 * Fulfills the "Try Playground — remember and recall live, no code required"
 * promise from the Memory overview Explore card. All three verbs go through
 * the dashboard BFF (`/v1/dashboard/memory/{remember,recall,reflect}`), which
 * mints a server-side key per session; the subject is derived from the session,
 * never sent by the browser.
 *
 *  - Remember: textarea + optional category → POST remember → shows created ids
 *  - Recall: query + topK → POST recall → scored result list
 *  - Reflect: button → POST reflect → passes through the provider result
 */

interface RememberedItem {
  id: string;
  content: string;
}
interface RememberResult {
  items: RememberedItem[];
}
interface RecallHit {
  id: string;
  content: string;
  score: number;
}
interface RecallResult {
  results: RecallHit[];
}

/**
 * Widen a `datetime-local` value (minute precision, no zone) to an RFC3339 UTC
 * instant the provider's `asOf` (z.string().datetime()) accepts. EC-1: the
 * input is minute-precision (no `step` attribute), so a 16-char value gets
 * `:00Z`; a 19-char value (seconds present) gets `Z`. Treated as UTC.
 */
function toRfc3339Utc(local: string): string {
  if (local.length === 16) return `${local}:00Z`; // YYYY-MM-DDTHH:mm
  if (local.length === 19) return `${local}Z`; // YYYY-MM-DDTHH:mm:ss
  return local; // already zoned or unexpected — let the gateway 400 it
}

export function PlaygroundPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Playground'), [setPageTitle]);
  useRequireAuth();

  // --- Remember panel ---
  const [rememberText, setRememberText] = useState('');
  const [rememberCategory, setRememberCategory] = useState('');
  const [rememberPeer, setRememberPeer] = useState(''); // attributedTo (v1.1)
  const remember = useMutation({
    mutationFn: async () => {
      const peer = rememberPeer.trim(); // EC-2: whitespace-only is omitted
      return cloudFetch<RememberResult>('/v1/dashboard/memory/remember', {
        method: 'POST',
        body: JSON.stringify({
          text: rememberText,
          ...(rememberCategory ? { category: rememberCategory } : {}),
          ...(peer ? { attributedTo: peer } : {}),
        }),
      }, { throwOnError: true });
    },
    onSuccess: () => setRememberText(''),
  });

  // --- Recall panel ---
  const [recallQuery, setRecallQuery] = useState('');
  const [recallAsOf, setRecallAsOf] = useState(''); // datetime-local; widened to RFC3339 (asOf, v1.1)
  // graphExpand (EG-1, theo-memory v0.20.0): opt-in entity-graph recall. Default
  // OFF so a normal recall body is byte-unchanged; when on, surface memories
  // connected by a shared entity (1 hop) or relation edge (2 hops).
  const [graphExpandOn, setGraphExpandOn] = useState(false);
  const [graphExpandHops, setGraphExpandHops] = useState(1);
  const recall = useMutation({
    mutationFn: async () =>
      cloudFetch<RecallResult>('/v1/dashboard/memory/recall', {
        method: 'POST',
        body: JSON.stringify({
          query: recallQuery,
          topK: 10,
          // EC-1: <input type="datetime-local"> yields minute precision
          // (YYYY-MM-DDTHH:mm, no step set) → append ":00Z"; if it ever carries
          // seconds (length 19), append "Z". Treated as UTC (label says UTC).
          ...(recallAsOf ? { asOf: toRfc3339Utc(recallAsOf) } : {}),
          ...(graphExpandOn ? { graphExpand: { hops: graphExpandHops } } : {}),
        }),
      }, { throwOnError: true }),
  });

  // --- Reflect panel ---

  return (
    <PageShell
      title="Playground"
      description="Try the memory engine live — remember a fact, recall it semantically, and run a reflection. No code required."
    >
      <div className="space-y-6">
        {/* Remember */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-2">
              <Brain className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Remember</h2>
            </div>
          </Card.Header>
          <Card.Body className="space-y-3">
            <Textarea
              value={rememberText}
              onChange={(e) => setRememberText(e.target.value)}
              placeholder="e.g. Paulo prefers oat milk in his coffee."
              rows={3}
              aria-label="Memory text to remember"
            />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="pg-category" className="text-xs text-muted-foreground block mb-1">
                  Category (optional)
                </label>
                <Input
                  id="pg-category"
                  value={rememberCategory}
                  onChange={(e) => setRememberCategory(e.target.value)}
                  placeholder="preferences"
                  className="w-48"
                />
              </div>
              <div>
                <label htmlFor="pg-peer" className="text-xs text-muted-foreground block mb-1">
                  Attributed to (peer, optional)
                </label>
                <Input
                  id="pg-peer"
                  value={rememberPeer}
                  onChange={(e) => setRememberPeer(e.target.value)}
                  placeholder="e.g. maria"
                  className="w-48"
                  aria-describedby="pg-peer-hint"
                />
              </div>
              <Button
                onClick={() => remember.mutate()}
                disabled={remember.isPending || rememberText.trim() === ''}
              >
                Remember
              </Button>
            </div>
            {/* UX 2026-07-22: the peer hint lived INSIDE the items-end flex row, so the
                one field with text below it pushed its input off the shared baseline.
                Full-width note under the row keeps all three controls aligned; the
                aria-describedby link to the field is preserved. */}
            <p id="pg-peer-hint" className="text-xs text-muted-foreground">
              Attributed to: when set, the fact is stored verbatim as that peer&apos;s statement
              (skips auto fact-extraction).
            </p>
            {remember.isError ? (
              <Alert intent="warning" title="Could not remember">
                The Memory service rejected the write. Try again in a moment.
              </Alert>
            ) : null}
            {remember.data && remember.data.items.length > 0 ? (
              <Alert intent="success" title={`Stored ${remember.data.items.length} memory(ies)`}>
                <ul className="mt-1 space-y-1 text-xs font-mono">
                  {remember.data.items.map((it) => (
                    <li key={it.id}>{it.id.slice(0, 18)}… — {it.content}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
          </Card.Body>
        </Card>

        {/* Recall */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-2">
              <Search className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Recall</h2>
            </div>
          </Card.Header>
          <Card.Body className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-64">
                <label htmlFor="pg-query" className="text-xs text-muted-foreground block mb-1">
                  Query
                </label>
                <Input
                  id="pg-query"
                  value={recallQuery}
                  onChange={(e) => setRecallQuery(e.target.value)}
                  placeholder="What does Paulo like to drink?"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && recallQuery.trim() !== '') recall.mutate();
                  }}
                />
              </div>
              <div>
                <label htmlFor="pg-asof" className="text-xs text-muted-foreground block mb-1">
                  As of (UTC, optional)
                </label>
                <Input
                  id="pg-asof"
                  type="datetime-local"
                  value={recallAsOf}
                  onChange={(e) => setRecallAsOf(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="pg-graph-expand" className="text-xs text-muted-foreground block mb-1">
                  Graph expand (surface connected memories)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="pg-graph-expand"
                    type="checkbox"
                    checked={graphExpandOn}
                    onChange={(e) => setGraphExpandOn(e.target.checked)}
                    aria-label="Graph expand"
                  />
                  <select
                    aria-label="Graph expand hops"
                    className="text-sm bg-transparent border rounded px-1 py-0.5 disabled:opacity-50"
                    value={graphExpandHops}
                    onChange={(e) => setGraphExpandHops(Number(e.target.value))}
                    disabled={!graphExpandOn}
                  >
                    <option value={1}>1 hop</option>
                    <option value={2}>2 hops</option>
                  </select>
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={() => recall.mutate()}
                disabled={recall.isPending || recallQuery.trim() === ''}
              >
                Recall
              </Button>
            </div>
            {recall.isError ? (
              <Alert intent="warning" title="Could not recall">
                The Memory service is not reachable right now. Try again in a moment.
              </Alert>
            ) : null}
            {recall.data ? (
              recall.data.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matches for that query.</p>
              ) : (
                <ul className="space-y-2">
                  {recall.data.results.map((hit) => (
                    <li key={hit.id} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0">
                      <span className="text-sm">{hit.content}</span>
                      <Badge variant="outline" className="shrink-0">
                        {hit.score.toFixed(3)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </Card.Body>
        </Card>

        {/* Reflect — extracted to its own module (300-line budget); owns the
            mutation, elapsed feedback, and readable derived-memory rendering. */}
        <ReflectCard />
      </div>
    </PageShell>
  );
}
