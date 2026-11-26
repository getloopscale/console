// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchRoute, resetRoutes } from './server';
import { registerTrustHandlers } from './trust-handlers';

/**
 * B-127 — every trust path a hook asks for is served by the mock.
 *
 * ## The defect, measured
 *
 * Measured in the browser on 2026-08-11 with `VITE_USE_MOCKS=true`: `/trust` rendered
 * "Could not read the trust layer" and `/violations` listed nothing. The mock registered five
 * routes and none of them was `/policy-violations`, which `hooks/trust/use-trust.ts:85` requests.
 *
 * The screen was right. It refused to compute four zeros over a read that failed, which is the
 * behaviour B-126 had just built — and that refusal is what surfaced the gap in the MOCK rather
 * than letting it look like a gap in the product.
 *
 * ## Why the guard reads the hooks instead of listing paths
 *
 * A hand-written list of expected paths would have to be updated by the same person who forgot to
 * add the route — the omission and its detector share a cause, so the detector never fires. This
 * test derives the paths from the source that actually issues the requests: whatever
 * `hooks/trust/*.ts` passes to `fetchTrust` / `mutateTrust` must resolve against a registered
 * route.
 *
 * The extraction is deliberately literal-only. A path built at runtime from a variable is
 * invisible to it, and the test says so rather than pretending to be exhaustive.
 */

const HOOKS_DIR = resolve(__dirname, '../../hooks/trust');

/**
 * `fetchTrust('/x')` / `mutateTrust('POST', `/y/${id}`)` — the literal path argument.
 *
 * The two delimiter shapes are matched separately on purpose. A single alternation with a
 * backreference has to exclude BOTH quote characters from the body, and a template hole like
 * `${encodeURIComponent(id ?? '')}` contains a quote — which silently truncated
 * `/conversations/...` out of the extraction on the first run of this guard.
 */
const CALL = String.raw`(?:fetchTrust|mutateTrust)\s*(?:<[^>]*>)?\s*\(\s*(?:'[A-Z]+'|"[A-Z]+")?\s*,?\s*`;
const PATH_LITERALS = [
  new RegExp(CALL + String.raw`\x60(\/[^\x60]*)\x60`, 'g'),
  new RegExp(CALL + String.raw`'(\/[^']*)'`, 'g'),
  new RegExp(CALL + String.raw`"(\/[^"]*)"`, 'g'),
];

/** Template holes and query strings are not part of the path the router matches. */
function toRouterPath(raw: string): string {
  return raw.replace(/\$\{[^}]*\}/g, 'x').split('?')[0];
}

function declaredTrustPaths(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
    const src = readFileSync(resolve(HOOKS_DIR, file), 'utf8');
    for (const re of PATH_LITERALS) {
      for (const [, raw] of src.matchAll(re)) found.add(toRouterPath(raw));
    }
  }
  return [...found].sort();
}

describe('the trust mock serves what the hooks ask for', () => {
  beforeEach(() => {
    resetRoutes();
    registerTrustHandlers();
  });
  afterEach(resetRoutes);

  it('finds the paths by reading the hooks, not from a hand-written list', () => {
    // If the extraction silently stopped matching, every assertion below would pass over an empty
    // set — a guard that protects nothing while reporting green.
    const paths = declaredTrustPaths();
    expect(paths.length, 'no trust path extracted — the regex stopped matching').toBeGreaterThanOrEqual(4);
    expect(paths).toContain('/policy-violations');
  });

  it('every declared path resolves against a registered route', () => {
    const base = '/v1/dashboard/trust';
    const unserved = declaredTrustPaths().filter((p) => !matchRoute('GET', `${base}${p}`));

    expect(
      unserved,
      'trust paths a hook requests and the mock does not serve.\n\n' +
        'Mock mode renders these screens as a read failure — correctly, because the read did fail.\n' +
        'That makes a missing route look like a broken product, which is the most expensive kind of\n' +
        'false signal a demo environment can produce.\n\n' +
        `Register them in trust-handlers.ts under \`${base}\`.\n`,
    ).toEqual([]);
  });

  it('is registered under both prefixes, bare and behind the gateway', () => {
    // `window.__LOOPSCALE_CONFIG__.API_URL` is empty in dev and `/api` behind the gateway. A route
    // registered under one prefix works in one configuration and silently does not in the other.
    expect(matchRoute('GET', '/v1/dashboard/trust/policy-violations')).toBeTruthy();
    expect(matchRoute('GET', '/api/v1/dashboard/trust/policy-violations')).toBeTruthy();
  });
});

describe('what the violations route answers', () => {
  beforeEach(() => {
    resetRoutes();
    registerTrustHandlers();
  });
  afterEach(resetRoutes);

  it('answers the shape the screen reads, with more than one policy', async () => {
    // One policy would make `/trust`'s coverage KPIs read `1 policy / 1 blocked` — a state in which
    // a bug that ignores the enforced flag looks identical to correct behaviour. The seed carries
    // both an enforced and an unenforced policy so the verdict above the KPIs has something to say.
    const matched = matchRoute('GET', '/v1/dashboard/trust/policy-violations');
    const res = await matched!.route.handler(
      new Request('https://test/v1/dashboard/trust/policy-violations?limit=200'),
      matched!.params,
    );
    const body = (await res.json()) as { violations?: { policy?: string }[] };

    expect(Array.isArray(body.violations)).toBe(true);
    const policies = new Set((body.violations ?? []).map((v) => v.policy));
    expect(policies.size, 'a single policy hides coverage bugs behind a full-coverage reading').toBeGreaterThanOrEqual(2);
  });

  it('declares whether it truncated, as the contract requires', async () => {
    // `loopguardrails/openapi.yaml:365` makes `has_more` REQUIRED on this response — the discipline
    // B-114/B-120 established, because a list that truncates in silence is read as complete. A mock
    // that omits it lets the screen be developed against a shape the service does not send.
    const matched = matchRoute('GET', '/v1/dashboard/trust/policy-violations');
    const res = await matched!.route.handler(
      new Request('https://test/v1/dashboard/trust/policy-violations?limit=1'),
      matched!.params,
    );
    const body = (await res.json()) as { violations?: unknown[]; has_more?: boolean };

    expect(body.violations).toHaveLength(1);
    expect(body.has_more, 'asked for 1 of 3 and did not say there were more').toBe(true);
  });
});

describe('the catalogue carries the field coverage is matched on', () => {
  beforeEach(() => {
    resetRoutes();
    registerTrustHandlers();
  });
  afterEach(resetRoutes);

  it('every platform validator declares a category', async () => {
    // Measured in the browser on 2026-08-11: `/trust` read `3 policies / 0 blocked` with a
    // catalogue that covers one of them. `coverageGap` matches on `policy` OR `category`
    // (`pages/trust/components/trust-series.ts:162-172`), and the mock's validators carried
    // neither — so the "blocked" column was structurally blind and every policy read as uncovered.
    //
    // `category` is REQUIRED (nullable) on the canonical entry — see
    // `loopguardrails/packages/guardrails-client/src/types.ts:10`. Omitting it is the mock diverging
    // from the contract, not a seed choice.
    const matched = matchRoute('GET', '/v1/dashboard/trust/validators');
    const res = await matched!.route.handler(
      new Request('https://test/v1/dashboard/trust/validators'),
      matched!.params,
    );
    const body = (await res.json()) as { validators?: { source?: string; category?: unknown }[] };

    const platform = (body.validators ?? []).filter((v) => v.source === 'platform');
    expect(platform.length).toBeGreaterThan(0);
    for (const v of platform) {
      expect(Object.prototype.hasOwnProperty.call(v, 'category'), 'validator with no `category`').toBe(true);
    }
  });

  it('the seed produces BOTH a covered and an uncovered policy', async () => {
    // Coverage that reads `3 of 3 uncovered` looks identical whether the matching works or is
    // broken — which is exactly how the blind column above survived. The asymmetry is what makes
    // the reading falsifiable, and it is why the seed is worth asserting rather than just writing.
    const cat = matchRoute('GET', '/v1/dashboard/trust/validators')!;
    const vio = matchRoute('GET', '/v1/dashboard/trust/policy-violations')!;
    const catalogue = (await (
      await cat.route.handler(new Request('https://test/v1/dashboard/trust/validators'), cat.params)
    ).json()) as { validators?: { category?: string | null }[] };
    const violations = (await (
      await vio.route.handler(
        new Request('https://test/v1/dashboard/trust/policy-violations?limit=200'),
        vio.params,
      )
    ).json()) as { violations?: { policy?: string }[] };

    const covered = new Set(
      (catalogue.validators ?? []).map((v) => v.category).filter((c): c is string => !!c),
    );
    const observed = [...new Set((violations.violations ?? []).map((v) => v.policy))];

    expect(observed.filter((p) => p && covered.has(p)).length, 'no observed policy is covered').toBeGreaterThanOrEqual(1);
    expect(observed.filter((p) => p && !covered.has(p)).length, 'every observed policy is covered').toBeGreaterThanOrEqual(1);
  });
});
