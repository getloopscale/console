// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
const mockCloudFetchRaw = vi.fn();
const mockTriggerBlobDownload = vi.fn();

vi.mock('@/lib/http/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/api')>();
  return {
    ...actual,
    engineFetch: (...args: unknown[]) => mockEngineFetch(...args),
    cloudFetchRaw: (...args: unknown[]) => mockCloudFetchRaw(...args),
  };
});

vi.mock('@/lib/export/download', () => ({
  triggerBlobDownload: (...args: unknown[]) => mockTriggerBlobDownload(...args),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ name: 'my-project', id: 'bld-1' }) };
});

beforeEach(() => {
  mockEngineFetch.mockReset();
  mockCloudFetchRaw.mockReset();
  mockTriggerBlobDownload.mockReset();
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

  it('says the build has no SBOM when the API answers 404 for it', async () => {
    // A build that failed before the SBOM step has none, and the API says so with a 404. Telling
    // the user to retry would send them after something that will never exist.
    mockEngineFetch.mockRejectedValue(new ApiError(404, undefined, 'not found'));

    render(<SBOMTab />);

    expect(await screen.findByText(/no sbom for this build/i)).toBeInTheDocument();
    expect(screen.getByText(/failed before the sbom step/i)).toBeInTheDocument();
  });

  it('keeps the retry message for a network failure', async () => {
    mockEngineFetch.mockRejectedValue(new ApiError(0, undefined, 'network request failed'));

    render(<SBOMTab />);

    expect(await screen.findByText(/could not read the sbom/i)).toBeInTheDocument();
  });
});

describe('SBOMTab — the file is downloaded through the API', () => {
  // The link was a presigned URL to the storage endpoint, which on staging is an address no
  // browser reaches (getloopscale/loopzero#104). The API now serves the file at `download_path`.
  const withDownload = {
    apps: [
      {
        app_name: 'web',
        sbom_format: 'cyclonedx-json',
        download_path: '/api/v1/builds/bld-1/sbom/web/download',
      },
    ],
  };

  it('fetches download_path with the session and saves the file', async () => {
    mockEngineFetch.mockResolvedValue(withDownload);
    const file = new Blob(['{"bomFormat":"CycloneDX"}'], { type: 'application/json' });
    mockCloudFetchRaw.mockResolvedValue({ ok: true, status: 200, blob: async () => file });

    render(<SBOMTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    await waitFor(() => expect(mockTriggerBlobDownload).toHaveBeenCalledTimes(1));
    expect(mockCloudFetchRaw).toHaveBeenCalledWith('/engine/api/v1/builds/bld-1/sbom/web/download');
    expect(mockTriggerBlobDownload).toHaveBeenCalledWith('bld-1-web.cdx.json', file);
  });

  it('says the download failed, and saves nothing, when the API refuses it', async () => {
    mockEngineFetch.mockResolvedValue(withDownload);
    mockCloudFetchRaw.mockResolvedValue({ ok: false, status: 502, blob: async () => new Blob() });

    render(<SBOMTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    expect(await screen.findByText('Could not download the SBOM. Try again in a moment.')).toBeInTheDocument();
    expect(mockTriggerBlobDownload).not.toHaveBeenCalled();
  });

  it('offers no download for an app whose file the API cannot serve', async () => {
    mockEngineFetch.mockResolvedValue({ apps: [{ app_name: 'web' }, withDownload.apps[0]] });

    render(<SBOMTab />);
    await screen.findAllByText('web');

    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1);
  });
});

describe('AttestationTab — same distinction, same reason', () => {
  it('shows the attestation when the read SUCCEEDS', async () => {
    mockEngineFetch.mockResolvedValue({
      build_id: 'bld-1',
      signed: true,
      image_digest: 'sha256:abc123def456',
      image_signature: 'ghcr.io/getloopscale/app:sha256-abc123.sig',
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

  it('says the build has no attestation when the API answers 404 for it', async () => {
    mockEngineFetch.mockRejectedValue(new ApiError(404, undefined, 'not found'));

    render(<AttestationTab />);

    expect(await screen.findByText(/no attestation for this build/i)).toBeInTheDocument();
  });
});
