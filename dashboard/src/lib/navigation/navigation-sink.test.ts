// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NavigationTarget } from './navigation-target';
import { RecordingNavigationSink, WindowNavigationSink } from './navigation-sink';

/**
 * B-138 · T2 — the sink is an interface so the negative assertion is direct.
 *
 * The headline test of this slice is "the password was NOT submitted". Asserting that
 * against the real `window.location` in jsdom needs property redefinition that leaks
 * between tests; asserting it against a recording double is one line and cannot leak.
 * That is the concrete payoff of the DIP boundary, not a ceremonial one.
 */
describe('RecordingNavigationSink — the test double', () => {
  it('captures an assignment without navigating', () => {
    const sink = new RecordingNavigationSink();
    sink.assign(NavigationTarget.parse('/billing')!);
    expect(sink.assignments).toEqual(['/billing']);
    expect(sink.submissions).toEqual([]);
  });

  it('captures a form submission with its fields', () => {
    const sink = new RecordingNavigationSink();
    sink.submitForm(NavigationTarget.parse('/login')!, { method: 'password', identifier: 'a@b.c' });
    expect(sink.submissions).toEqual([
      { action: '/login', fields: { method: 'password', identifier: 'a@b.c' } },
    ]);
  });
});

describe('WindowNavigationSink — the production binding', () => {
  let assigned: string[];

  beforeEach(() => {
    assigned = [];
    vi.spyOn(document.body, 'appendChild');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('assigns the destination through the injected locator', () => {
    const sink = new WindowNavigationSink({
      navigate: (url) => assigned.push(url),
      document,
    });
    sink.assign(NavigationTarget.parse('/device-success')!);
    expect(assigned).toEqual(['/device-success']);
  });

  it('builds a POST form carrying every field as a hidden input, then submits it', () => {
    const submit = vi.fn();
    const created: HTMLFormElement[] = [];
    const fakeDoc = {
      createElement: (tag: string) => {
        const el = document.createElement(tag) as HTMLFormElement;
        if (tag === 'form') {
          el.submit = submit;
          created.push(el);
        }
        return el;
      },
      body: document.createElement('div'),
    } as unknown as Document;

    const sink = new WindowNavigationSink({ navigate: () => {}, document: fakeDoc });
    sink.submitForm(NavigationTarget.parse('/login')!, {
      csrf_token: 'tok',
      method: 'password',
      password: 'hunter2',
    });

    expect(created).toHaveLength(1);
    const form = created[0];
    expect(form.method.toLowerCase()).toBe('post');
    expect(form.action).toContain('/login');
    const inputs = Array.from(form.querySelectorAll('input'));
    expect(inputs.map((i) => [i.name, i.value])).toEqual([
      ['csrf_token', 'tok'],
      ['method', 'password'],
      ['password', 'hunter2'],
    ]);
    expect(inputs.every((i) => i.type === 'hidden')).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });
});
