import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStatusDetail } from '@/lib/api/types';
import { LiveUrlHero } from './live-url-hero';

/**
 * T1.1 of plan 2026-06-12-dashboard-journey-j25-live-url-discoverability v1.2.
 *
 * RED specs (5) per Implementation Contract + SEPA iter 2 pre-RED decisions:
 *  1. test_project_overview_renders_visit_button_when_status_url_populated
 *  2. test_project_overview_renders_pending_badge_when_status_url_null (ADR D3)
 *  3. test_overview_uses_default_production_env (EC-4)
 *  4. test_overview_renders_skeleton_while_status_loading (EC-6)
 *  5. test_overview_copy_button_writes_to_clipboard_and_shows_toast (EC-7 — ARIA-live)
 *
 * Per SEPA iter 2 CRITICAL fix: canonical URL is `https://teste-production.getloopscale.com`
 * (status.go:252 emits `https://<project>-<env>.<baseDomain>`). NOT `teste.getloopscale.com`
 * (v1.0 fabrication).
 *
 * Per SEPA iter 2 MAJOR: ProjectStatusDetail.url is `url?: string` (optional);
 * tests mock as `undefined` not `null`.
 *
 * Per SEPA iter 2 MAJOR: no Toast primitive in @getloopscale/ui — use ARIA-live
 * transient state ("Copied" message in `<span aria-live="polite">`).
 */

const CANONICAL_URL = 'https://teste-production.getloopscale.com';

function makeStatus(overrides: Partial<ProjectStatusDetail> = {}): ProjectStatusDetail {
  return {
    project: 'teste',
    environment: 'production',
    url: CANONICAL_URL,
    ...overrides,
  };
}

describe('LiveUrlHero', () => {
  let clipboardMock: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    clipboardMock = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboardMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders visit button when status.url is populated', () => {
    render(<LiveUrlHero status={makeStatus()} loading={false} />);
    const link = screen.getByRole('link', { name: /visit/i });
    expect(link).toHaveAttribute('href', CANONICAL_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('draws the visit link as the primary button of the design system, not a lime fill', () => {
    render(<LiveUrlHero status={makeStatus()} loading={false} />);
    const link = screen.getByRole('link', { name: /visit/i });
    // Lime is the accent of the brand; a filled lime action exists nowhere else in the console.
    expect(link.className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
    expect(link.className).not.toMatch(/text-primary-foreground/);
  });

  it('renders pending badge when status.url is absent (ADR D3)', () => {
    render(<LiveUrlHero status={makeStatus({ url: undefined })} loading={false} />);
    expect(screen.getByText(/URL pending/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /visit/i })).toBeNull();
  });

  it('renders skeleton while status is loading (EC-6)', () => {
    render(<LiveUrlHero status={null} loading={true} />);
    expect(screen.getByTestId('live-url-hero-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/URL pending/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /visit/i })).toBeNull();
  });

  it('renders nothing destructive when status is null and not loading (idle fallback)', () => {
    render(<LiveUrlHero status={null} loading={false} />);
    expect(screen.queryByTestId('live-url-hero-skeleton')).toBeNull();
    expect(screen.getByText(/URL pending/i)).toBeInTheDocument();
  });

  it('writes URL to clipboard and shows ARIA-live Copied message on copy click (EC-7)', async () => {
    render(<LiveUrlHero status={makeStatus()} loading={false} />);
    const copyBtn = screen.getByRole('button', { name: /copy/i });

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    await waitFor(() => {
      expect(clipboardMock.writeText).toHaveBeenCalledWith(CANONICAL_URL);
    });

    const live = screen.getByRole('status');
    await waitFor(() => {
      expect(live).toHaveTextContent(/copied/i);
    });
  });

  // Red Team loop-console#41 regression-protector (2026-06-27): when
  // isPreviewOnly=true AND url is absent, the hero MUST render the
  // canonical "Preview only" empty state — NOT the misleading
  // "URL pending" + "appears after first successful deploy" copy that
  // contradicts the user's mental model when ~12 successful preview
  // deploys exist (the exact Red Team scenario).
  it('renders Preview-only empty state when isPreviewOnly=true and url absent (#41)', () => {
    render(
      <LiveUrlHero status={makeStatus({ url: undefined })} loading={false} isPreviewOnly={true} />,
    );
    expect(
      screen.getByText(/Preview deploys only — promote a release to production/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Preview only/i)).toBeInTheDocument();
    // The misleading default copy MUST NOT render.
    expect(screen.queryByText(/URL pending/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No production deploy yet — URL appears after/i),
    ).not.toBeInTheDocument();
  });

  it('renders default URL-pending state when isPreviewOnly=false and url absent', () => {
    render(<LiveUrlHero status={makeStatus({ url: undefined })} loading={false} />);
    expect(screen.getByText(/URL pending/i)).toBeInTheDocument();
    // B-242 — the DESCRIPTION is asserted here, not only the title, because the preview-only case
    // above denies it by name. Without this line that denial could not fail: reword the sentence
    // in `live-url-hero.tsx` and the case above still passes, no longer guarding anything.
    expect(
      screen.getByText(/No production deploy yet — URL appears after/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Preview only/i)).not.toBeInTheDocument();
  });

  // Red Team loop-console#115 closure (2026-06-28): when a preview-only
  // project has an ACTIVE preview release whose URL is serving HTTP 200,
  // the hero MUST show that URL with a Visit button — NOT the misleading
  // "promote a release to production to assign a live URL" copy, which
  // contradicts the running state (`curl <url>` already returns 200).
  // The CTO LIVE-validated 2026-06-28 with loopzero-example deployed to
  // --env preview: build SUCCEEDED, release ACTIVE, Live URL serving 200,
  // yet the dashboard rendered "promote a release" — actively lying.
  //
  // Contract: when `isPreviewOnly && previewStatus?.url` exists, the
  // canonical preview URL is rendered with the same Visit + Copy controls
  // as the production happy path, plus a "Preview" badge to make the
  // environment classification honest.
  it('renders preview URL with Visit button when isPreviewOnly=true and previewStatus.url present (#115)', () => {
    const PREVIEW_URL =
      'https://tn-cbeb584e569d5a20-loopzero-example-app-preview.prod-dev.getloopscale.com';
    render(
      <LiveUrlHero
        status={makeStatus({ url: undefined })}
        loading={false}
        isPreviewOnly={true}
        previewStatus={makeStatus({
          project: 'loopzero-example',
          environment: 'preview',
          url: PREVIEW_URL,
        })}
      />,
    );
    // Visit anchor MUST render and point at the preview URL.
    const link = screen.getByRole('link', { name: /visit/i });
    expect(link).toHaveAttribute('href', PREVIEW_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    // Preview classification badge MUST render.
    expect(screen.getByText(/^preview$/i)).toBeInTheDocument();
    // The misleading "promote to production" copy MUST NOT render.
    expect(
      screen.queryByText(/promote a release to production/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/URL pending/i)).not.toBeInTheDocument();
  });
});
