/**
 * Hermetic tests for formatPromoteError — mirror of the Rollback
 * formatter tests (rollback-dialog-format.test.ts). Surfaces TheoError
 * bodies into actionable copy without exposing internal terms
 * (Cross-Project Rule 9). Locks the canonical error-to-copy mapping
 * so a backend code rename does not silently regress UI messaging.
 */
import { describe, expect, it } from 'vitest';
import { formatPromoteError } from './promote-to-production-dialog';

describe('formatPromoteError', () => {
  it('surfaces sync timeout actionably without internal terms', () => {
    const msg = formatPromoteError(500, {
      message:
        'promote: sync wait failed for tn-x-production: argocd wait: context cancelled',
    });
    expect(msg).toMatch(/deployment infrastructure did not finish in time/);
    expect(msg).toMatch(/retry/i);
    expect(msg).not.toMatch(/ArgoCD/);
    expect(msg).not.toMatch(/argocd/);
  });

  it('handles no-active-release with a clear next step', () => {
    const msg = formatPromoteError(409, {
      code: 'NO_ACTIVE_RELEASE',
      message: 'no active release in preview-pr-1',
    });
    expect(msg).toMatch(/No active release in the source environment/);
    expect(msg).toMatch(/Wait for the build to finish/);
  });

  it('handles same-environment with a redirecting hint', () => {
    const msg = formatPromoteError(409, {
      code: 'SAME_ENVIRONMENT',
      message: 'cannot promote production to production',
    });
    expect(msg).toMatch(/already on production/);
    expect(msg).toMatch(/preview deploy/);
  });

  it('handles 401 with re-auth instruction', () => {
    const msg = formatPromoteError(401, { message: 'unauthorized' });
    expect(msg).toMatch(/Session expired/);
    expect(msg).toMatch(/Sign in again/);
  });

  it('handles 404 with a refresh hint', () => {
    const msg = formatPromoteError(404, { message: 'project not found' });
    expect(msg).toMatch(/not found/);
    expect(msg).toMatch(/Refresh/i);
  });

  it('handles 409 concurrent promote with a wait hint', () => {
    const msg = formatPromoteError(409, {
      message: 'another deploy in progress',
    });
    expect(msg).toMatch(/Another deploy is already in progress/);
    expect(msg).toMatch(/retry/i);
  });

  it('falls back to detail message when status is generic 5xx', () => {
    const msg = formatPromoteError(503, { message: 'service unavailable' });
    expect(msg).toMatch(/503/);
    expect(msg).toMatch(/service unavailable/);
    expect(msg).toMatch(/current production release remains active/);
  });

  it('never exposes ArgoCD / Kubernetes / kubectl / sync internal terms', () => {
    const samples = [
      formatPromoteError(500, { message: 'sync wait failed' }),
      formatPromoteError(500, { message: 'sync trigger failed' }),
      formatPromoteError(500, { message: 'unknown' }),
      formatPromoteError(404, null),
      formatPromoteError(409, { message: 'concurrent' }),
    ];
    for (const msg of samples) {
      for (const term of ['ArgoCD', 'argocd', 'Kubernetes', 'kubectl', 'pod']) {
        expect(msg).not.toContain(term);
      }
    }
  });
});
