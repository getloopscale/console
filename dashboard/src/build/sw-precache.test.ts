// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getManifest } from 'workbox-build';
import { SW_PRECACHE_GLOB_IGNORES } from './sw-precache';

/**
 * `public/` is copied verbatim into `dist/`, so its files reach the precache manifest unless
 * `globIgnores` drops them. `getManifest` is the generator `generateSW` uses, run with the same
 * default `globPatterns` the build uses.
 */
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

async function precachedUrls(globIgnores: readonly string[]): Promise<string[]> {
  const { manifestEntries } = await getManifest({
    globDirectory: PUBLIC_DIR,
    globIgnores: [...globIgnores],
  });
  return (manifestEntries ?? []).map((entry) => entry.url);
}

describe('service worker precache manifest', () => {
  it('leaves out the runtime config, so a returning user never gets the build-time copy', async () => {
    // The container writes /__config.js at start-up. A precached copy answers before any runtime
    // rule and lacks OAUTH_URL/AUTH_URL, which broke password login and device-flow approval.
    expect(await precachedUrls(SW_PRECACHE_GLOB_IGNORES)).not.toContain('__config.js');
  });

  it('would precache the runtime config without the ignore list', async () => {
    // Proves the assertion above looks at a manifest that could hold the file.
    expect(await precachedUrls([])).toContain('__config.js');
  });
});
