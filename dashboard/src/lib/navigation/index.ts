// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

/**
 * The barrel exports only what CALL SITES use. Tests import the concrete modules directly,
 * so re-exporting the classes here would be speculative surface — knip flagged exactly that
 * on the first draft, and the parsimony ladder's first rung is whether it needs to exist.
 */
export { safeNavigator } from './safe-navigator';
export { BILLING_REDIRECT, DOCS_SITE, type NavigationPolicy } from './navigation-target';
