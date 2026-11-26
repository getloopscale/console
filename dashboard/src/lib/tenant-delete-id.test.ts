// @vitest-environment node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-265 — two screens sent DIFFERENT ids to the same DELETE, so at most one was right.
 *
 * ## Which one, decided by reading the handler rather than guessing
 *
 * `useDeleteTenant` issues `DELETE /api/v1/tenants/{id}` against the ENGINE, and the engine's
 * handler (`api/internal/routes/tenants/tenants.go`, `TenantHandler.Delete`) does:
 *
 *     tenantID := chi.URLParam(r, "id")
 *     if !isAdmin && uc.TenantID != tenantID { ErrForbidden }
 *
 * The path parameter is compared against the TENANT id on the auth context, so the tenant id is
 * the only value a non-admin caller can succeed with.
 *
 *   settings/overview.tsx   whoami.team_id       — the tenant id. The engine logs `uc.TenantID`
 *                                                  under exactly that name. CORRECT.
 *   settings/profile.tsx    session.identity.id  — the KRATOS identity id, which is the INPUT to
 *                                                  EnsureTenant and not what it returns. It could
 *                                                  only ever have produced 403 Forbidden.
 *
 * "Delete Account" is the most destructive button in the product and it was wired to an id the
 * server refuses. It surfaced at all only because B-264 had just given the call a real error
 * branch — before that a refusal resolved `null`, closed the dialog and signed the user out over
 * a request the server had rejected.
 *
 * ## Why a source guard rather than a render test
 *
 * The DoD asks for a test that fails "if the two screens ever pass different values again". That
 * is a claim about the two call sites together; a render test on either screen stays green while
 * the other drifts. This reads both.
 */
function callSite(file: string): string {
  const source = readFileSync(resolve(SRC, file), 'utf8');
  const match = /deleteTenant\.mutateAsync\(([^)]*)\)/.exec(source);
  if (match === null) throw new Error(`no deleteTenant.mutateAsync(...) call in ${file}`);
  return match[1].trim();
}

const PROFILE = 'pages/settings/profile.tsx';
const OVERVIEW = 'pages/settings/overview.tsx';

describe('the tenant DELETE is keyed on the tenant id (B-265)', () => {
  it('both screens pass the same expression, and it names the tenant', () => {
    expect(callSite(PROFILE)).toBe(callSite(OVERVIEW));
    expect(callSite(PROFILE)).toContain('team_id');
  });

  it('neither screen passes a Kratos identity id', () => {
    // The specific wrong value, named, so a revert is caught by what it IS and not only by the
    // two sites disagreeing — they could drift back together onto the wrong id.
    for (const file of [PROFILE, OVERVIEW]) {
      expect(callSite(file), `${file} passes the Kratos identity id`).not.toContain('identity.id');
    }
  });
});
