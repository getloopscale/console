// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { canReplay, deliveryStatusVariant } from './delivery';
import type { Delivery } from './delivery';

const TODOS: Delivery['status'][] = ['pending', 'delivering', 'delivered', 'failed', 'dead_letter'];

describe('deliveryStatusVariant', () => {
  it('separa o que está a caminho, o que chegou e o que desistiu', () => {
    expect(deliveryStatusVariant('pending')).toBe('warning');
    expect(deliveryStatusVariant('delivering')).toBe('warning');
    expect(deliveryStatusVariant('delivered')).toBe('success');
    expect(deliveryStatusVariant('dead_letter')).toBe('destructive');
  });

  it('`failed` é neutro, e não destrutivo — ainda há reenvio', () => {
    // A distinção que as duas cópias faziam igual e que vale preservar: `failed` é uma tentativa
    // que não deu certo e pode ser reenviada; `dead_letter` é o fim da linha.
    expect(deliveryStatusVariant('failed')).toBe('default');
  });

  it('todo status da união tem um tom — nenhum cai em silêncio', () => {
    // A cópia de settings fechava com `default: 'default'`. Com ele, um status novo escorrega para
    // o tom neutro sem ninguém decidir; sem ele, o TypeScript reprova a compilação e obriga a
    // decisão. Este caso é o que prova que a forma exaustiva sobreviveu.
    for (const s of TODOS) {
      expect(['default', 'success', 'warning', 'destructive']).toContain(deliveryStatusVariant(s));
    }
  });
});

describe('canReplay', () => {
  it('oferece reenvio só nos dois desfechos em que ele faz sentido', () => {
    expect(canReplay('failed')).toBe(true);
    expect(canReplay('dead_letter')).toBe(true);
  });

  it('não oferece para o que já chegou nem para o que está a caminho', () => {
    // Reenviar um `delivered` cria uma duplicata no destino de quem recebe; reenviar um
    // `pending`/`delivering` é um clique sem efeito sobre algo que já está em trânsito.
    expect(canReplay('delivered')).toBe(false);
    expect(canReplay('pending')).toBe(false);
    expect(canReplay('delivering')).toBe(false);
  });
});
