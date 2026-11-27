import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@/test/render';
import { StatusBar } from './status-bar';

describe('StatusBar', () => {
  it('is the footer of the shell and carries the platform status', () => {
    render(<StatusBar />);
    const footer = screen.getByRole('contentinfo', { name: 'Platform status' });
    const indicator = within(footer).getByTestId('system-status-indicator');
    // The status is read from the services, never a fixed "all systems operational".
    expect(within(indicator).getByRole('status').getAttribute('aria-label')).not.toBe(
      'System status: all systems operational',
    );
  });

  it('is a thin bar in the mono typeface', () => {
    render(<StatusBar />);
    const footer = screen.getByRole('contentinfo', { name: 'Platform status' });
    expect(footer.className).toMatch(/(^|\s)h-7(\s|$)/);
    expect(footer.className).toMatch(/font-mono/);
  });
});
