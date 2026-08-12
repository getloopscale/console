// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isLoggedOutMessage, readPlanLimitDetail } from './event-payloads';

/**
 * B-234 / B-236 — a TypeScript interface treated as a runtime guarantee across a boundary the
 * compiler does not cross.
 *
 * `MessageEvent<AuthMessage>` and `PlanLimitDetail` are compile-time claims about data that
 * arrives at runtime from somewhere else — another browser tab, and an HTTP response body. The
 * annotation makes the call site LOOK checked while checking nothing.
 *
 * `rules/error-handling.md § 2`: validate at the boundary; past it, data is trusted. These two
 * boundaries were trusting AT the boundary, which is the one place trust is not available.
 *
 * Node environment on purpose: these are pure predicates. Needing a DOM to test them would mean
 * they were in the wrong place.
 */

describe('isLoggedOutMessage', () => {
  it('rejects null', () => {
    // The measured crash: `msg.type` on a null payload throws a TypeError INSIDE the channel
    // handler, where nothing catches it.
    expect(isLoggedOutMessage(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isLoggedOutMessage(undefined)).toBe(false);
  });

  it('rejects a bare string', () => {
    expect(isLoggedOutMessage('logged-out')).toBe(false);
  });

  it('rejects a number', () => {
    expect(isLoggedOutMessage(42)).toBe(false);
  });

  it('rejects an object whose type is not the logout signal', () => {
    expect(isLoggedOutMessage({ type: 'hello' })).toBe(false);
  });

  it('rejects an object with no type at all', () => {
    expect(isLoggedOutMessage({ payload: 'x' })).toBe(false);
  });

  it('rejects a non-string type', () => {
    expect(isLoggedOutMessage({ type: 7 })).toBe(false);
  });

  it('accepts the real message', () => {
    // The guard must not overshoot: the mechanism it protects has to keep working.
    expect(isLoggedOutMessage({ type: 'logged-out' })).toBe(true);
  });

  it('accepts the real message even when the sender adds fields', () => {
    // Permissive about EXTRA fields, strict about the ones it reads — a future sender adding a
    // timestamp must not stop logging this tab out.
    expect(isLoggedOutMessage({ type: 'logged-out', at: 123 })).toBe(true);
  });
});

describe('readPlanLimitDetail', () => {
  it('reads null from a null body', () => {
    // The non-JSON path already dispatches `detail: null`; the modal has copy for it.
    expect(readPlanLimitDetail(null)).toBeNull();
  });

  it('reads null from a non-object body', () => {
    expect(readPlanLimitDetail('PLAN_LIMIT_EXCEEDED')).toBeNull();
  });

  it('drops a non-string current_plan rather than forwarding it', () => {
    // The measured crash: `(detail?.current_plan ?? 'Free').replace(…)` on the number 42 throws
    // inside a React event handler, which takes the modal down.
    const lido = readPlanLimitDetail({ current_plan: 42 });
    expect(lido?.current_plan).toBeUndefined();
  });

  it('drops an empty current_plan', () => {
    // An empty string does not throw — it renders a blank plan name, which is a reading nobody
    // can act on. The fallback copy is better than a hole.
    expect(readPlanLimitDetail({ current_plan: '   ' })?.current_plan).toBeUndefined();
  });

  it('keeps a valid current_plan intact', () => {
    expect(readPlanLimitDetail({ current_plan: 'pro' })?.current_plan).toBe('pro');
  });

  it('keeps the other fields the modal reads', () => {
    const lido = readPlanLimitDetail({ current_plan: 'pro', code: 'PLAN_LIMIT_EXCEEDED', message: 'too many envs' });
    expect(lido).toEqual({ current_plan: 'pro', code: 'PLAN_LIMIT_EXCEEDED', message: 'too many envs' });
  });

  it('drops a non-string message rather than forwarding it', () => {
    expect(readPlanLimitDetail({ message: { nested: true } })?.message).toBeUndefined();
  });

  it('an object with nothing usable still reads as an object, not as null', () => {
    // `null` means "no body". An object whose fields were all unusable is a DIFFERENT fact: the
    // server did answer with a body. Collapsing the two would lose that.
    expect(readPlanLimitDetail({ current_plan: 42 })).toEqual({});
  });
});
