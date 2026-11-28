/**
 * The colors that tell chart series and graph clusters apart, in a fixed order.
 *
 * Six hues, none of them purple, stepped for the dark surface of the brand (`#111415`). Measured
 * with the dataviz palette validator (`--mode dark --surface "#111415"`): every color sits in the
 * lightness band, clears 3:1 against the surface, and the closest adjacent pair is 8.4 apart under
 * protanopia, above the target of 8. A seventh hue drops that to 7.1, so a seventh series folds
 * into "Others" or reuses the order.
 *
 * Dark only: the console has no light mode yet. A light mode needs its own steps, validated
 * against the light surface.
 */
const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c'] as const;

/** The color of the series at `index`, reusing the order past the sixth. */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}
