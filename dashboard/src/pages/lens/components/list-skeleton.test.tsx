import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';

import { ListSkeleton } from './list-skeleton';

describe('ListSkeleton', () => {
  it('is a labelled status region (not a bare unlabeled box)', () => {
    render(<ListSkeleton label="sessions" />);
    expect(screen.getByRole('status', { name: /loading sessions/i })).toBeInTheDocument();
  });

  it('renders a table-shaped block of rows', () => {
    const { container } = render(<ListSkeleton label="traces" rows={4} />);
    expect(container.querySelectorAll('.h-9').length).toBe(4);
  });
});
