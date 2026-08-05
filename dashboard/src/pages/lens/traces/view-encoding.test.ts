import { describe, it, expect, vi } from 'vitest';

import {
  DEFAULT_COLUMN_STATE,
  decodeColumns,
  encodeColumns,
  isColumnVisible,
  type ColumnState,
} from './view-encoding';

/**
 * M59 P3 T3.1 — the versioned column encoder. Round-trip identity is the load-bearing invariant; an
 * old/unknown/malformed payload must migrate to the default WITHOUT throwing (R3), so a saved view
 * from a future or legacy build degrades gracefully instead of breaking the traces table.
 */

const custom: ColumnState = {
  visibility: { model: false, latency: false, tokens: true, cost: false, evals: true },
  density: 'compact',
};

describe('M59 view-encoding', () => {
  it('round-trips: decodeColumns(encodeColumns(s)) deep-equals s', () => {
    expect(decodeColumns(encodeColumns(custom))).toEqual(custom);
    expect(decodeColumns(encodeColumns(DEFAULT_COLUMN_STATE))).toEqual(DEFAULT_COLUMN_STATE);
  });

  it('um token v1 ANTIGO, sem a chave `model`, decodifica com model visível — sem quebrar', () => {
    // M23 acrescentou `model` ao conjunto ocultável. Toda visão salva antes disso carrega um token
    // sem essa chave. O merge sobre `DEFAULT_COLUMN_STATE` é o que impede aquelas visões de mudarem
    // de comportamento — e sem este teste, nada trava esse mecanismo.
    const antigo = `v1:${btoa(JSON.stringify({ visibility: { latency: true, tokens: true, cost: true, evals: true }, density: 'comfortable' }))}`;
    expect(decodeColumns(antigo).visibility.model).toBe(true);
  });

  it('produces a version-prefixed token', () => {
    expect(encodeColumns(custom)).toMatch(/^v1:/);
  });

  it('migrates an old/unknown version to the default (warn, no throw)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeColumns('v0:legacy')).toEqual(DEFAULT_COLUMN_STATE);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns the default for an absent param (no throw)', () => {
    expect(decodeColumns(null)).toEqual(DEFAULT_COLUMN_STATE);
    expect(decodeColumns(undefined)).toEqual(DEFAULT_COLUMN_STATE);
    expect(decodeColumns('')).toEqual(DEFAULT_COLUMN_STATE);
  });

  it('returns the default for a malformed v1 payload (warn, no throw)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeColumns('v1:not-base64-@@@')).toEqual(DEFAULT_COLUMN_STATE);
    warn.mockRestore();
  });

  it('isColumnVisible reflects the state (unknown column → visible)', () => {
    expect(isColumnVisible(custom, 'latency')).toBe(false);
    expect(isColumnVisible(custom, 'tokens')).toBe(true);
    expect(isColumnVisible(custom, 'unknown')).toBe(true);
  });
});
