import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { WorkspacePage, deriveEntries, StorageFile } from './workspace';

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

  it('uploads into the current folder (PUT to {prefix}{name})', async () => {
    const put = vi.fn((_url?: string, _init?: unknown) => Promise.resolve({ path: 'data/x.txt', size: 5 }));
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/objects/') && init?.method === 'PUT') return put(url, init);
      return routeByUrl(url);
    });
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByText('data')); // enter data/
    const input = (await screen.findByTestId('file-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['hello'], 'x.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect((put.mock.calls[0] as unknown[])[0]).toBe('/v1/dashboard/storage/objects/data/x.txt');
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

  it('opens a preview side-panel when a file is clicked (with a download link)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('# hello') })));
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByText('README.md'));
    // The Sheet shows the file path + a Download action pointing at the object route.
    const download = await screen.findByRole('link', { name: /download/i });
    expect(download).toHaveAttribute('href', '/v1/dashboard/storage/objects/README.md');
    vi.unstubAllGlobals();
  });

  it('uses product language only (no infra terms)', async () => {
    mockCloudFetch.mockImplementation((url: string) => routeByUrl(url));
    const { container } = render(<WorkspacePage />);
    await screen.findByText('README.md');
    expect(container.textContent).not.toMatch(/\bS3\b|bucket|MinIO/i);
  });
});
