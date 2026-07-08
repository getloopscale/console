/**
 * M75 — pick a unique default dashboard name so "New from template" never produces two
 * indistinguishable boards (audit D-1). Returns the bare `base` when it is free, otherwise the
 * smallest `${base} N` (N ≥ 2) not already taken — filling the lowest gap, not just max+1.
 * Soft-uniqueness only: the user may still rename a board to any value, including a duplicate.
 */
export function nextBoardName(existing: string[], base = 'Tracing Overview'): string {
  const root = base.trim();
  const taken = new Set(existing.map((n) => n.trim()));
  if (!taken.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
