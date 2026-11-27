import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';
import { BrandLockup } from './brand-lockup';

describe('BrandLockup', () => {
  it('shows the brand mark and names the product once', () => {
    const { container } = render(<BrandLockup />);
    const mark = container.querySelector('img');
    expect(mark).toHaveAttribute('src', '/logo-128.png');
    // Decorative: the wordmark beside it is the accessible name.
    expect(mark).toHaveAttribute('alt', '');
    expect(screen.getAllByText('LoopScale')).toHaveLength(1);
  });
});
