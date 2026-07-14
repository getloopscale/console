import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { StoragePage } from './storage';

const USAGE = { used_bytes: 52_428_800, aggregate_limit: 104_857_600, per_file_limit: 26_214_400, tier: 'starter', unlimited: false };
const FILES = { files: [{ path: 'avatars/user1.png', size: 2048, content_type: 'image/png' }], next_cursor: '' };

function routeByUrl(url: string) {
  if (url.includes('/usage')) return Promise.resolve(USAGE);
  if (url.includes('/objects')) return Promise.resolve(FILES);
  return Promise.resolve({});
}

describe('StoragePage (/storage)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the usage bar + file list on success', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    render(<StoragePage />);

    // Usage bar shows used-of-limit with the tier + product language
    expect(await screen.findByText(/of 100.0 MB \(starter\)/)).toBeInTheDocument();
    expect(screen.getByText('Usage')).toBeInTheDocument();

    // File list row
    expect(await screen.findByText('avatars/user1.png')).toBeInTheDocument();
    expect(screen.getByText(/2.0 KB · image\/png/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no files', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url.includes('/usage')) return Promise.resolve(USAGE);
      return Promise.resolve({ files: [], next_cursor: '' });
    });
    render(<StoragePage />);
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
  });

  it('share button posts and shows the copied link', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/share') && init?.method === 'POST') {
        return Promise.resolve({ url: '/v1/storage/shared/tok123', expires_at: '2026-07-14T00:00:00Z' });
      }
      return routeByUrl(url);
    });
    render(<StoragePage />);

    const shareBtn = await screen.findByLabelText('Share avatars/user1.png');
    shareBtn.click();

    expect(await screen.findByTestId('share-link')).toHaveTextContent('/v1/storage/shared/tok123');
  });

  it('uses product language only (no infra terms)', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    const { container } = render(<StoragePage />);
    await screen.findByText('avatars/user1.png');
    expect(container.textContent).not.toMatch(/\bS3\b|bucket|MinIO/i);
  });
});
