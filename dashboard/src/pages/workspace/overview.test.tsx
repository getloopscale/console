import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...a: unknown[]) => mockCloudFetch(...a),
  cloudFetchRaw: () => Promise.resolve({ ok: true, text: () => Promise.resolve('# hello'), blob: () => Promise.resolve(new Blob()) }),
}));

import { WorkspacePage, deriveEntries, StorageFile } from './overview';

const USAGE = { used_bytes: 52_428_800, aggregate_limit: 104_857_600, tier: 'starter', unlimited: false };
const FILES = {
  files: [
    { path: 'README.md', size: 142, content_type: 'text/markdown' },
    { path: 'data/report.csv', size: 2048, content_type: 'text/csv' },
    { path: 'notes/todo.md', size: 64, content_type: 'text/markdown' },
    { path: 'images/.keep', size: 0, content_type: 'application/octet-stream' },
  ],
  next_cursor: '',
};

function routeByUrl(url: string) {
  if (url.includes('/usage')) return Promise.resolve(USAGE);
  if (url.includes('/objects')) return Promise.resolve(FILES);
  return Promise.resolve({});
}

describe('deriveEntries (flat keys → folders + files)', () => {
  const all = FILES.files as StorageFile[];

  it('groups root into folders (data, images, notes) + files (README.md)', () => {
    const e = deriveEntries(all, '');
    expect(e.folders).toEqual(['data', 'images', 'notes']); // images visible via its .keep marker
    expect(e.files.map((f) => f.path)).toEqual(['README.md']);
  });

  it('lists the files inside a subfolder prefix', () => {
    const e = deriveEntries(all, 'data/');
    expect(e.folders).toEqual([]);
    expect(e.files.map((f) => f.path)).toEqual(['data/report.csv']);
  });

  it('hides the .keep folder marker from the file list', () => {
    const e = deriveEntries(all, 'images/');
    expect(e.folders).toEqual([]);
    expect(e.files).toEqual([]); // .keep is a marker, not a shown file
  });
});

describe('WorkspacePage (/workspaces)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders folders and files at the root level', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    render(<WorkspacePage />);
    expect(await screen.findByText('data')).toBeInTheDocument();
    expect(screen.getByText('notes')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect((await screen.findAllByTestId('folder-row')).length).toBe(3);
  });

  it('navigates into a folder and shows a breadcrumb', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByText('data'));
    // inside data/: report.csv is shown by its leaf name; README.md (root) is not
    expect(await screen.findByText('report.csv')).toBeInTheDocument();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
  });

  it('uploads into the current folder via presigned PUT (mint → S3 → commit)', async () => {
    // M4: the byte transfer is a direct window.fetch PUT to the signed S3 URL.
    const s3put = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal('fetch', s3put);
    mockCloudFetch.mockImplementation((url: string) => {
      if (url.endsWith('/presign-upload')) return Promise.resolve({ url: 'https://s3.example/put?X-Amz-Signature=x' });
      if (url.endsWith('/presign-commit')) return Promise.resolve({ committed: true });
      return routeByUrl(url);
    });
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByText('data')); // enter data/
    const input = (await screen.findByTestId('file-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['hello'], 'x.txt', { type: 'text/plain' })] } });

    // bytes went straight to the signed S3 URL (not through the BFF)
    await waitFor(() => expect(s3put).toHaveBeenCalled());
    expect((s3put.mock.calls[0] as unknown[])[0]).toBe('https://s3.example/put?X-Amz-Signature=x');
    // the mint request carried the folder-prefixed path
    const mint = mockCloudFetch.mock.calls.find((c) => String(c[0]).endsWith('/presign-upload'));
    expect(JSON.parse((mint![1] as { body: string }).body).path).toBe('data/x.txt');
    // and a commit followed
    await waitFor(() =>
      expect(mockCloudFetch.mock.calls.some((c) => String(c[0]).endsWith('/presign-commit'))).toBe(true),
    );
    vi.unstubAllGlobals();
  });

  it('creates a folder via the in-app dialog — no native window.prompt (.keep marker)', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const put = vi.fn((_url?: string, _init?: unknown) => Promise.resolve({}));
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/objects/') && init?.method === 'PUT') return put(url, init);
      return routeByUrl(url);
    });
    render(<WorkspacePage />);
    await screen.findByText('README.md');
    fireEvent.click(screen.getByRole('button', { name: /new folder/i }));
    const input = await screen.findByLabelText('Folder name');
    fireEvent.change(input, { target: { value: 'drafts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect((put.mock.calls[0] as unknown[])[0]).toBe('/v1/dashboard/storage/objects/drafts/.keep');
    expect(promptSpy).not.toHaveBeenCalled(); // never uses the native dialog
  });

  it('opens a preview side-panel when a file is clicked (with Download + Delete actions)', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByText('README.md'));
    // The Sheet shows the file path (mono) + the action buttons.
    expect(await screen.findByRole('button', { name: /download/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /share link/i })).toBeInTheDocument();
  });

  it('uses product language only (no infra terms)', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    const { container } = render(<WorkspacePage />);
    await screen.findByText('README.md');
    expect(container.textContent).not.toMatch(/\bS3\b|bucket|MinIO/i);
  });
});

describe('WorkspacePage — multi-select + bulk delete (Phase 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selecting a file checkbox reveals the action bar with the count', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByLabelText('Select README.md'));
    expect(await screen.findByTestId('selection-bar')).toHaveTextContent('1 selected');
  });

  it('select-all checks every visible row (3 folders + 1 file)', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    render(<WorkspacePage />);
    await screen.findByText('README.md');
    fireEvent.click(screen.getByLabelText('Select all'));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('4 selected');
  });

  it('a folder Delete opens a confirm with count+size, then POSTs bulk-delete with the prefix', async () => {
    const post = vi.fn((_url?: string, _init?: { method?: string; body?: string }) => Promise.resolve({ deleted: 1, failed: [], truncated: false }));
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (url.includes('/bulk-delete') && init?.method === 'POST') return post(url, init);
      return routeByUrl(url);
    });
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByLabelText('Delete folder data'));
    expect(await screen.findByText(/1 item · 2\.0 KB/)).toBeInTheDocument(); // blast radius (EC-4)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = JSON.parse((post.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.prefixes).toEqual(['data/']);
    expect(body.paths).toEqual([]);
  });

  it('uses product language only in the selection UI (no infra terms)', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    const { container } = render(<WorkspacePage />);
    await screen.findByText('README.md');
    fireEvent.click(screen.getByLabelText('Select all'));
    expect(container.textContent).not.toMatch(/\bS3\b|bucket|object key/i);
  });
});

describe('WorkspacePage — bulk-delete mutation outcomes (Phase 2, D4/EC-5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('surfaces partial failure honestly via a toast (D4)', async () => {
    const post = vi.fn((_url?: string, _init?: unknown) =>
      Promise.resolve({ deleted: 0, failed: [{ path: 'data/report.csv', reason: 'storage_unavailable' }], truncated: false }));
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/bulk-delete') && init?.method === 'POST') return post(url, init);
      return routeByUrl(url);
    });
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByLabelText('Delete folder data'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(await screen.findByText(/could not be deleted/i)).toBeInTheDocument();
  });

  it('shows a "delete again" message when the response is truncated (D3)', async () => {
    const post = vi.fn((_url?: string, _init?: unknown) =>
      Promise.resolve({ deleted: 10000, failed: [], truncated: true }));
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/bulk-delete') && init?.method === 'POST') return post(url, init);
      return routeByUrl(url);
    });
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByLabelText('Delete folder data'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(await screen.findByText(/delete again/i)).toBeInTheDocument();
  });

  it('a network error surfaces an error toast (failure scenario)', async () => {
    const post = vi.fn((_url?: string, _init?: unknown) => Promise.reject(new Error('network')));
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/bulk-delete') && init?.method === 'POST') return post(url, init);
      return routeByUrl(url);
    });
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByLabelText('Delete folder data'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(await screen.findByText(/delete failed/i)).toBeInTheDocument();
  });
});
