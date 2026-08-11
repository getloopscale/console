// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import type { FormFields, NavigationSink } from './navigation-sink';
import { WindowNavigationSink } from './navigation-sink';
import { NavigationTarget } from './navigation-target';

/**
 * The one seam through which a server-supplied destination reaches the browser.
 *
 * Every method parses unconditionally, so there is no path through this class that reaches a
 * sink with an unjudged value. Both return a boolean rather than throwing: refusing a
 * destination is something the USER has to be told about, and the copy differs per call site
 * ("the authentication service returned an unexpected target" vs "failed to open the billing
 * portal"). Throwing would have collapsed those into one catch block far from the message.
 */
export class SafeNavigator {
  constructor(private readonly sink: NavigationSink = new WindowNavigationSink()) {}

  /** Same-window navigation. Returns false — having navigated nowhere — if refused. */
  goTo(raw: string | null | undefined): boolean {
    const target = NavigationTarget.parse(raw);
    if (target === null) return false;
    this.sink.assign(target);
    return true;
  }

  /** Browser-level POST. Returns false — having submitted nothing — if refused. */
  submitTo(raw: string | null | undefined, fields: FormFields): boolean {
    const target = NavigationTarget.parse(raw);
    if (target === null) return false;
    this.sink.submitForm(target, fields);
    return true;
  }
}

/**
 * The application-wide instance. A module-level singleton rather than context-injected
 * because navigation is a platform capability, not application state: there is exactly one
 * browser window, and threading a provider through eight call sites would add the ceremony
 * without adding a seam anyone needs. Tests construct their own `SafeNavigator` with a
 * `RecordingNavigationSink`, which is the seam that matters.
 */
export const safeNavigator = new SafeNavigator();
