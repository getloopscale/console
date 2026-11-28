import { useEffect, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { Badge, Button, Card, Skeleton } from '@getloopscale/ui';
import type { ProjectStatusDetail } from '@/lib/api/types';
import { copyToClipboard } from '@/lib/export/clipboard';

/**
 * LiveUrlHero — T1.1 of plan 2026-06-12-dashboard-journey-j25-live-url-discoverability v1.2.
 *
 * Renders the production deploy URL prominently at the top of the Project
 * Overview page. Three states:
 *   - loading: Skeleton
 *   - status.url populated: hero card with Visit link (new tab, noopener) + Copy button
 *   - status.url absent: gray "URL pending" badge (per ADR D3 — never silent hide)
 *
 * Canonical data path:
 *   useProjectStatus(name).status.url is emitted by `api/internal/routes/status.go:252`
 *   as `https://<project>-<env>.<baseDomain>` (e.g., https://teste-production.getloopscale.com
 *   for dev-public). Per ADR D1, this is the single source of truth — zero backend change.
 *
 * Copy affordance uses `copyToClipboard` (secure-context aware, com fallback) + uma regiao ARIA-live transitoria
 * ("Copied" message announced to AT for 2s). Avoids introducing a Toaster scaffolding
 * dependency for test setup; accessibility canonical.
 */

interface LiveUrlHeroProps {
  status: ProjectStatusDetail | null;
  loading: boolean;
  /**
   * Red Team loop-console#41 absorption (2026-06-27): when the parent
   * project is preview-only (`last_deploy_status === 'preview'`), the
   * hero renders a Preview-specific empty state — NEVER "URL pending"
   * with the misleading "appears after the first successful deploy"
   * subtitle, which contradicts the user's mental model when ~12
   * successful preview deploys exist. Optional + default false; legacy
   * call sites are untouched.
   */
  isPreviewOnly?: boolean;
  /**
   * Red Team loop-console#115 absorption (2026-06-28): the production
   * `status` for a preview-only project has no URL — but the preview env
   * DOES have an active release serving a real Live URL. The parent
   * (project-detail) queries the sibling preview env from
   * `status.other_envs_with_releases` and passes its status here so the
   * hero can show the real URL with a "Preview" badge instead of the
   * misleading "promote a release to production to assign a live URL"
   * copy, which actively lied while `curl <url>` already returned 200.
   * Optional; only consulted when `isPreviewOnly=true && !status.url`.
   */
  previewStatus?: ProjectStatusDetail | null;
}

export function LiveUrlHero({
  status,
  loading,
  isPreviewOnly = false,
  previewStatus = null,
}: LiveUrlHeroProps) {
  const [copyMessage, setCopyMessage] = useState<string>('');

  useEffect(() => {
    if (!copyMessage) return;
    const t = setTimeout(() => setCopyMessage(''), 2000);
    return () => clearTimeout(t);
  }, [copyMessage]);

  if (loading) {
    return (
      <Card>
        <Card.Body className="py-4">
          <Skeleton data-testid="live-url-hero-skeleton" className="h-8 w-2/3" />
        </Card.Body>
      </Card>
    );
  }

  // Red Team loop-console#115 closure: when production has no URL but the
  // sibling preview env has an active release serving HTTP 200, render
  // THAT URL with a "Preview" badge. Resolution order: production URL
  // (canonical) → preview URL (preview-only project) → empty states.
  const url = status?.url || (isPreviewOnly ? previewStatus?.url : undefined);
  const isShowingPreview = !status?.url && Boolean(url);

  if (!url) {
    if (isPreviewOnly) {
      return (
        <Card>
          <Card.Body className="flex items-center justify-between py-4">
            <div>
              <div className="text-label text-muted-foreground uppercase">Live URL</div>
              <div className="mt-1 text-body-sm text-muted-foreground">
                Preview deploys only — promote a release to production to assign a live URL.
              </div>
            </div>
            <Badge variant="outline">Preview only</Badge>
          </Card.Body>
        </Card>
      );
    }
    return (
      <Card>
        <Card.Body className="flex items-center justify-between py-4">
          <div>
            <div className="text-label text-muted-foreground uppercase">Live URL</div>
            <div className="mt-1 text-body-sm text-muted-foreground">
              No production deploy yet — URL appears after the first successful deploy.
            </div>
          </div>
          <Badge variant="outline">URL pending</Badge>
        </Card.Body>
      </Card>
    );
  }

  const handleCopy = async () => {
    // B-031 — usa `copyToClipboard` em vez de `navigator.clipboard` cru.
    //
    // O helper existia, testado, sem NENHUM consumidor. E ele resolve um caso
    // real: `navigator.clipboard` exige contexto seguro (W3C), entao em
    // `http://192.168.x.x:5173` — o pareamento de dev em LAN — o objeto e
    // `undefined`, a chamada lanca, e o operador via "Copy failed" mesmo com o
    // fallback de `document.execCommand` disponivel e funcionando.
    const ok = await copyToClipboard(url);
    setCopyMessage(ok ? 'Copied' : 'Copy failed');
  };

  return (
    <Card>
      <Card.Body className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-label text-muted-foreground uppercase">Live URL</div>
            {/* Red Team loop-console#115 closure: when serving from the
                preview env (no production URL yet), label the badge
                honestly so the user knows which environment is live. */}
            {isShowingPreview && <Badge variant="outline">Preview</Badge>}
          </div>
          <div className="mt-1 truncate text-body font-mono text-foreground">{url}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy live URL"
            title="Copy"
            className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <Copy className="size-4" aria-hidden="true" />
          </button>
          <Button asChild size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" aria-hidden="true" />
              Visit
            </a>
          </Button>
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {copyMessage}
        </span>
      </Card.Body>
    </Card>
  );
}
