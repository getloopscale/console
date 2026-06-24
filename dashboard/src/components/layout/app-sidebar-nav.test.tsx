// live-test-gaps-fix F-4 — the Memory/main sub-nav must navigate via react-router
// v7's NATIVE viewTransition option so the panel re-renders on click. Regression
// guard against the prior raw document.startViewTransition wrapper that left the
// panel stale until reload.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';

import { render, screen } from '@/test/render';
import { AppSidebar } from './app-sidebar';
import type { Session } from '@/lib/auth';

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

function makeSession(): Session {
  return { active: true, identity: { id: 'sess-1', traits: { email: 'p@example.com' } } };
}

describe('AppSidebar navigation (F-4)', () => {
  beforeEach(() => navigateSpy.mockClear());

  it('navigates with react-router native viewTransition on sub-nav click', () => {
    render(<AppSidebar session={makeSession()} />);
    fireEvent.click(screen.getByRole('button', { name: /Projects/i }));
    expect(navigateSpy).toHaveBeenCalledWith('/projects', { viewTransition: true });
  });

  it('navigates back with react-router native viewTransition', () => {
    // The `memory` menu has parent 'main', so rendering at /memory surfaces the
    // "Back to TheoCloud" control wired to handleBack (the 2nd F-4 call site).
    render(<AppSidebar session={makeSession()} />, { initialEntries: ['/memory'] });
    const back = screen.getByRole('button', { name: /back to/i });
    navigateSpy.mockClear();
    fireEvent.click(back);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0][1]).toEqual({ viewTransition: true });
  });
});
