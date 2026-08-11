// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import type { NavigationTarget } from './navigation-target';

/** The fields of a browser-level POST, in insertion order. */
export type FormFields = Readonly<Record<string, string>>;

/**
 * The two browser primitives this codebase uses to leave the current page.
 *
 * Both take a {@link NavigationTarget} rather than a string, so an implementation cannot be
 * handed a destination that was never judged.
 */
export interface NavigationSink {
  /** Same-window navigation — the `window.location.href = …` shape. */
  assign(target: NavigationTarget): void;
  /**
   * A real browser-level form POST — NOT `fetch`. Kratos requires a navigation-level POST
   * so the redirect to the identity provider is followed; with `fetch` the 302 comes back
   * and the browser never navigates, which breaks OIDC login silently. This constraint is
   * recorded at `pages/auth/oidc-form.ts` and is why the sink owns form submission at all
   * instead of exposing only `assign`.
   */
  submitForm(target: NavigationTarget, fields: FormFields): void;
}

/** What {@link WindowNavigationSink} needs from the platform, injected so tests can bind fakes. */
export interface BrowserBindings {
  navigate(url: string): void;
  document: Document;
}

/** The production binding. */
export class WindowNavigationSink implements NavigationSink {
  private readonly bindings: BrowserBindings;

  constructor(bindings?: Partial<BrowserBindings>) {
    this.bindings = {
      navigate: bindings?.navigate ?? ((url: string) => { window.location.href = url; }),
      document: bindings?.document ?? document,
    };
  }

  assign(target: NavigationTarget): void {
    this.bindings.navigate(target.value);
  }

  submitForm(target: NavigationTarget, fields: FormFields): void {
    const doc = this.bindings.document;
    const form = doc.createElement('form');
    form.method = 'POST';
    form.action = target.value;
    for (const [name, value] of Object.entries(fields)) {
      const input = doc.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    doc.body.appendChild(form);
    form.submit();
  }
}

/** A recording double. Captures intent without leaving the page. */
export class RecordingNavigationSink implements NavigationSink {
  readonly assignments: string[] = [];
  readonly submissions: { action: string; fields: FormFields }[] = [];

  assign(target: NavigationTarget): void {
    this.assignments.push(target.value);
  }

  submitForm(target: NavigationTarget, fields: FormFields): void {
    this.submissions.push({ action: target.value, fields });
  }
}
