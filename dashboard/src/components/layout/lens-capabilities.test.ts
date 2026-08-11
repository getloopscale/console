import { describe, it, expect } from 'vitest';
import { LENS_CAPABILITIES, LENS_EXPLORE_CARDS, LENS_SIDEBAR_GROUPS } from './lens-capabilities';

describe('LENS_CAPABILITIES registry (the single source of truth)', () => {
  it('includes Alerts (routed but historically missing from the sidebar)', () => {
    expect(LENS_CAPABILITIES.some((c) => c.path === '/observability/alerts')).toBe(true);
  });

  it('M86 — includes Webhooks inside observability (alert setup stays in one module)', () => {
    const wh = LENS_CAPABILITIES.find((c) => c.path === '/observability/webhooks');
    expect(wh).toBeDefined();
    expect(wh?.label).toBe('Webhooks');
    expect(wh?.group).toBe('Improve'); // grouped with Alerts (webhooks are the alert delivery target)
  });

  it('the Explore grid excludes the Overview landing but keeps every real destination', () => {
    expect(LENS_EXPLORE_CARDS.some((c) => c.path === '/observability')).toBe(false);
    // Dashboards / Queues / Experiments were missing from the old grid — now present.
    for (const p of ['/observability/dashboards', '/observability/labeling-queue', '/observability/experiments']) {
      expect(LENS_EXPLORE_CARDS.some((c) => c.path === p)).toBe(true);
    }
  });

  it('the sidebar groups and the Explore grid are BOTH derived from the same registry (no drift)', () => {
    const sidebarPaths = LENS_SIDEBAR_GROUPS.flatMap((g) => g.items.map((i) => i.path)).sort();
    const registryPaths = LENS_CAPABILITIES.map((c) => c.path).sort();
    expect(sidebarPaths).toEqual(registryPaths); // sidebar covers every capability
    // every explore card is also a sidebar entry (the two maps agree)
    for (const card of LENS_EXPLORE_CARDS) expect(sidebarPaths).toContain(card.path);
  });

  it('every path is unique (no duplicate/ambiguous nav entry)', () => {
    const paths = LENS_CAPABILITIES.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
