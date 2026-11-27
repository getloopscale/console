// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', '..');

/**
 * A class such as `bg-emerald-500` or `text-red-400` paints a color the theme does not know. It
 * stays the same when the brand changes, and it needs a `dark:` twin to work in both modes. The
 * theme has a token for each meaning: `success`, `warning`, `destructive`, `info`, `primary`,
 * `muted`.
 */
const FIXED_PALETTE_CLASS =
  /\b(?:bg|text|border(?:-[trblxy])?|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

/** Files allowed to keep a fixed palette class, each with the reason. */
const EXCEPTIONS: Record<string, string> = {
  'pages/rag/components/tag-color.ts':
    'The eight colors a user picks for a wiki tag (Red, Orange, Purple and so on). The color is ' +
    'the content: the picker names it, and a stored choice is an index into this list.',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('fixed palette classes', () => {
  it('no screen paints a Tailwind palette color', () => {
    const files = sourceFiles(SRC);
    expect(files.length, 'no source file found: the test read the wrong directory').toBeGreaterThan(100);

    const offenders = files.flatMap((file) => {
      const name = relative(SRC, file);
      if (name in EXCEPTIONS) return [];
      const found = readFileSync(file, 'utf8').match(FIXED_PALETTE_CLASS) ?? [];
      return found.length > 0 ? [`${name}: ${[...new Set(found)].join(' ')}`] : [];
    });

    expect(
      offenders,
      'Use a theme token (success, warning, destructive, info, primary, muted) in place of the ' +
        'palette class. A file that cannot goes in EXCEPTIONS with the reason.',
    ).toEqual([]);
  });

  it('matches what it is meant to match', () => {
    const sample = 'bg-emerald-500/70 dark:text-red-400 border-l-blue-500 text-muted-foreground bg-primary/10';
    expect(sample.match(FIXED_PALETTE_CLASS)).toEqual(['bg-emerald-500', 'text-red-400', 'border-l-blue-500']);
  });

  it('every exception points at a file that exists and still needs it', () => {
    for (const name of Object.keys(EXCEPTIONS)) {
      expect(readFileSync(join(SRC, name), 'utf8').match(FIXED_PALETTE_CLASS), name).not.toBeNull();
    }
  });
});
