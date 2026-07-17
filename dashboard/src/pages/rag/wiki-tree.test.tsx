import { describe, it, expect, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

import { WikiTree, buildTree, type WikiTreePage } from './wiki-tree';

const pages: WikiTreePage[] = [
  { id: 'p1', name: 'tables/customers.md' },
  { id: 'p2', name: 'tables/orders.md' },
  { id: 'p3', name: 'api/auth.md' },
  { id: 'p4', name: 'Overview.md' },
];

describe('buildTree (KB2 folder tree)', () => {
  it('groups pages by their path folders', () => {
    const root = buildTree(pages);
    expect([...root.folders.keys()].sort()).toEqual(['Ungrouped', 'api', 'tables']);
    expect(root.folders.get('tables')?.pages.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(root.folders.get('api')?.pages.map((p) => p.id)).toEqual(['p3']);
  });

  it('buckets folderless pages under Ungrouped', () => {
    const root = buildTree(pages);
    expect(root.folders.get('Ungrouped')?.pages.map((p) => p.id)).toEqual(['p4']);
  });
});

describe('WikiTree (render)', () => {
  it('renders folders and page leaves; clicking a page calls onOpen with its id', async () => {
    const onOpen = vi.fn();
    render(<WikiTree pages={pages} onOpen={onOpen} />);
    expect(screen.getByLabelText('Folder tables')).toBeInTheDocument();
    expect(screen.getByLabelText('Folder api')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Open tables/customers.md'));
    expect(onOpen).toHaveBeenCalledWith('p1');
  });

  it('renders nothing when there are no pages', () => {
    const { container } = render(<WikiTree pages={[]} onOpen={vi.fn()} />);
    expect(container.querySelector('[data-testid="wiki-tree"]')).toBeNull();
  });
});
