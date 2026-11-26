import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { usePendingOIDC } from './use-pending-oidc';

// loopscale#140 — the defect this hook exists for: a provider click that lands BEFORE the login flow
// resolved used to be silently discarded. No error, no spinner, no navigation — the user saw the
// page re-render and concluded the button was broken.
//
// These tests exist because the logic was previously inline in login.tsx, where it could not be
// exercised without mounting the whole page and stubbing Kratos. Extracting it to satisfy the LoC
// budget is what made it testable at all.

describe('usePendingOIDC', () => {
  it('submits the remembered provider once the flow lands', () => {
    const submit = vi.fn();
    const { rerender, result } = renderHook(({ flow }) => usePendingOIDC(flow, submit), {
      initialProps: { flow: null as unknown },
    });

    act(() => result.current.remember('github'));
    expect(submit).not.toHaveBeenCalled(); // no flow yet — nothing can be POSTed

    rerender({ flow: { ui: { action: '/x', nodes: [] } } });
    expect(submit).toHaveBeenCalledExactlyOnceWith('github');
  });

  it('does not submit when no provider was remembered', () => {
    const submit = vi.fn();
    const { rerender } = renderHook(({ flow }) => usePendingOIDC(flow, submit), {
      initialProps: { flow: null as unknown },
    });

    rerender({ flow: { ui: { action: '/x', nodes: [] } } });
    expect(submit).not.toHaveBeenCalled();
  });

  // The guard that matters most: a later flow refresh must NOT re-fire a stale provider and bounce
  // the user into an OIDC redirect they never asked for. The ref is cleared BEFORE submitting.
  it('never re-fires a stale provider on a subsequent flow refresh', () => {
    const submit = vi.fn();
    const { rerender, result } = renderHook(({ flow }) => usePendingOIDC(flow, submit), {
      initialProps: { flow: null as unknown },
    });

    act(() => result.current.remember('google'));
    rerender({ flow: { id: 'first' } });
    expect(submit).toHaveBeenCalledTimes(1);

    rerender({ flow: { id: 'second' } }); // flow refreshed — must stay quiet
    rerender({ flow: { id: 'third' } });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  // `submit` is redefined on every render of the page. Depending on it would re-run the effect
  // without the flow having changed; the hook holds it in a ref so the identity churn is invisible.
  it('is not re-triggered by a new submit identity on the same flow', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, result } = renderHook(
      ({ flow, submit }) => usePendingOIDC(flow, submit),
      { initialProps: { flow: null as unknown, submit: first } },
    );

    act(() => result.current.remember('github'));
    rerender({ flow: { id: 'f1' }, submit: first });
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ flow: { id: 'f1' }, submit: second }); // same flow, new closure
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });
});
