// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { searchWithoutResult } from './empty-states';

/**
 * B-237 — `buscaSemResultado` foi extraída PARA ser testável e não foi testada.
 *
 * A extração é metade do trabalho: uma função pura sem teste é a mesma lógica de antes, só que
 * agora com a aparência de coberta.
 */
describe('buscaSemResultado', () => {
  it('não diz nada enquanto carrega', () => {
    // O caso que importa mais: durante a carga a lista está vazia por construção, e afirmar "nada
    // encontrado" aí é dizer o resultado antes de ter o resultado.
    expect(searchWithoutResult(true, 'alpha', 0)).toBeUndefined();
  });

  it('não diz nada quando não há busca', () => {
    // Lista vazia sem busca é "não há projetos", que é outra tela (o hero de onboarding). Este
    // estado é só sobre uma busca que não casou.
    expect(searchWithoutResult(false, '', 0)).toBeUndefined();
  });

  it('não diz nada quando a busca encontrou algo', () => {
    expect(searchWithoutResult(false, 'alpha', 3)).toBeUndefined();
  });

  it('diz que a busca não casou quando ela de fato não casou', () => {
    const estado = searchWithoutResult(false, 'zzz', 0);
    expect(estado?.title).toBe('No matching projects');
    expect(estado?.description).toMatch(/different search term/i);
  });
});
