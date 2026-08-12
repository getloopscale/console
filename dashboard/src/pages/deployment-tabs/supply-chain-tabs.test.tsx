// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/render';
import { ApiError } from '@/lib/http/api';
import { SBOMTab } from './sbom-tab';
import { AttestationTab } from './attestation-tab';

/**
 * B-244 — these two tabs had no tests at all, and two defects that only a test would name.
 *
 * 1. They fetched with a hand-rolled `useEffect` + `useState` + `cancelled` flag — a second
 *    data-fetching mechanism beside react-query, caching nothing and re-implementing
 *    cancellation per tab.
 *
 * 2. `if (error || !sbom || …) return <EmptyState title="No SBOM for this build" …>` collapsed
 *    a FAILED READ into an ABSENCE claim. The title told the operator this build has no SBOM;
 *    the description, underneath, said it could not be loaded. For a supply-chain artifact the
 *    two are opposite conclusions: "this build shipped without provenance" is a compliance
 *    finding, "I could not read the provenance" is a retry.
 */

const mockEngineFetch = vi.fn();

vi.mock('@/lib/http/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/api')>();
  return { ...actual, engineFetch: (...args: unknown[]) => mockEngineFetch(...args) };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ name: 'my-project', id: 'bld-1' }) };
});

beforeEach(() => {
  mockEngineFetch.mockReset();
});

describe('SBOMTab — a missing SBOM and an unreadable one are different findings', () => {
  it('lists the apps when the read SUCCEEDS', async () => {
    mockEngineFetch.mockResolvedValue({
      apps: [{ app_name: 'web', sbom_format: 'cyclonedx', component_count: 42 }],
    });

    render(<SBOMTab />);

    expect(await screen.findByText('web')).toBeInTheDocument();
  });

  it('says there is no SBOM when the read succeeded and returned none', async () => {
    mockEngineFetch.mockResolvedValue({ apps: [] });

    render(<SBOMTab />);

    expect(await screen.findByText(/no sbom for this build/i)).toBeInTheDocument();
  });

  it('does NOT say there is no SBOM when the read FAILED', async () => {
    mockEngineFetch.mockRejectedValue(new ApiError(502, undefined, 'upstream down'));

    render(<SBOMTab />);

    // Asserted on the title that IS rendered, not on the absence of the other: exactly one
    // empty-state title occupies this slot, so a regression rewrites it rather than removing
    // it — which an absence assertion could not see (src/lib/absence-assertion-ratchet.test.ts).
    expect(await screen.findByText(/could not read the sbom/i)).toBeInTheDocument();
  });
});

describe('AttestationTab — same distinction, same reason', () => {
  it('shows the attestation when the read SUCCEEDS', async () => {
    mockEngineFetch.mockResolvedValue({
      build_id: 'bld-1',
      signed: true,
      image_digest: 'sha256:abc123def456',
      image_signature: 'ghcr.io/usetheo/app:sha256-abc123.sig',
      signed_at: '2026-06-01T00:00:00Z',
    });

    render(<AttestationTab />);

    // The digest is the audit trail the tab exists to show — asserted rather than the tab's
    // chrome, so the test fails if the read stops reaching the screen.
    expect(await screen.findByText(/sha256:abc123def456/)).toBeInTheDocument();
  });

  it('says there is no attestation when the read succeeded and returned none', async () => {
    mockEngineFetch.mockResolvedValue(null);

    render(<AttestationTab />);

    expect(await screen.findByText(/no attestation for this build/i)).toBeInTheDocument();
  });

  it('does NOT say there is no attestation when the read FAILED', async () => {
    mockEngineFetch.mockRejectedValue(new ApiError(502, undefined, 'upstream down'));

    render(<AttestationTab />);

    expect(await screen.findByText(/could not read the attestation/i)).toBeInTheDocument();
  });
});
