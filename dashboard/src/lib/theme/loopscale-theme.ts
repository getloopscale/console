import { defineTheme } from '@getloopscale/loopzero-ui';

/**
 * The dashboard's theme, and its only owner.
 *
 * The app (`main.tsx`) and the test tree (`test/render.tsx`) both import this object. They used to
 * build the theme separately and drifted in color and in mode without anything failing, so the
 * suite measured a product nobody saw.
 *
 * The palette is the LoopScale brand: ink and paper in place of pure black and white, one brand
 * color (a muted lime), Hanken Grotesk and JetBrains Mono. `@getloopscale/ui` ships the same values
 * as its default tokens, which is what paints the page before React mounts;
 * `brand-theme.test.ts` fails when the two disagree.
 *
 * Lime on paper has no contrast as text or as a mark, so in light mode `primary` is the brand's
 * dark lime.
 */
const INK = '#111415';
const BONE = '#E7E6E0';
const PAPER = '#FBFAF7';
const INK_ON_PAPER = '#16191A';

/** The brand color per mode. A contrast value: `brand-theme.test.ts` measures it. */
export const BRAND_PRIMARY = { dark: '#C4E34F', light: '#556B00' } as const;

const loopscale = defineTheme({
  name: 'loopscale',
  label: 'LoopScale',
  description: 'Ink, paper and one lime.',
  fonts: {
    display: '"Hanken Grotesk", ui-sans-serif, system-ui, "Segoe UI", sans-serif',
    body: '"Hanken Grotesk", ui-sans-serif, system-ui, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
  dark: {
    background: INK,
    foreground: BONE,
    card: '#181C1D',
    'card-foreground': BONE,
    popover: '#1D2223',
    'popover-foreground': BONE,
    primary: BRAND_PRIMARY.dark,
    'primary-foreground': INK,
    secondary: '#232829',
    'secondary-foreground': BONE,
    accent: '#2A3032',
    'accent-foreground': BONE,
    muted: '#1F2425',
    'muted-foreground': '#9BA29F',
    border: '#2A3032',
    input: '#2A3032',
    ring: BRAND_PRIMARY.dark,
    success: '#5DB98A',
    'success-foreground': INK,
    warning: '#E6C84F',
    'warning-foreground': INK,
    destructive: '#E8705F',
    'destructive-foreground': INK,
    info: '#7FA8D9',
    'info-foreground': INK,
  },
  light: {
    background: '#F4F3EF',
    foreground: INK_ON_PAPER,
    card: PAPER,
    'card-foreground': INK_ON_PAPER,
    popover: PAPER,
    'popover-foreground': INK_ON_PAPER,
    primary: BRAND_PRIMARY.light,
    'primary-foreground': PAPER,
    secondary: '#E9E7E0',
    'secondary-foreground': INK_ON_PAPER,
    accent: '#E3E1D9',
    'accent-foreground': INK_ON_PAPER,
    muted: '#ECEAE4',
    'muted-foreground': '#5A615F',
    border: '#DCDAD3',
    input: '#DCDAD3',
    ring: BRAND_PRIMARY.light,
    success: '#1F7A4F',
    'success-foreground': PAPER,
    warning: '#7A6200',
    'warning-foreground': PAPER,
    destructive: '#B3372A',
    'destructive-foreground': PAPER,
    info: '#2C5E99',
    'info-foreground': PAPER,
  },
  radius: { sm: '4px', md: '7px', lg: '10px', xl: '12px', DEFAULT: '7px' },
});

// No `as const`: it would make `themes` readonly, and `ThemeProvider` asks for a mutable `Theme[]`.
export const TEMA_LOOPSCALE = {
  themes: [loopscale],
  defaultTheme: loopscale.name,
  defaultMode: 'dark' as const,
  // The dashboard is dark only and offers no theme picker. Both settings are part of the theme:
  // without `respectSystemMode: false` the provider follows `prefers-color-scheme`, and without
  // `storageKey: null` a stored `mode=light` overrides `defaultMode`.
  respectSystemMode: false,
  storageKey: null,
};
