/**
 * Theme colors for a `<canvas>`, which cannot use Tailwind classes or `var(--token)`.
 *
 * The tokens are complete colors (`#9BA29F`), so they are read as they are.
 */
export function themeColor(token: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** The color at the given opacity, in a form a canvas accepts. */
export function withAlpha(color: string, alpha: number): string {
  const hex = HEX_COLOR.exec(color);
  if (hex) {
    const [red, green, blue] = hex.slice(1).map((channel) => parseInt(channel, 16));
    return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha)})`;
  }
  return `color-mix(in srgb, ${color} ${String(alpha * 100)}%, transparent)`;
}
