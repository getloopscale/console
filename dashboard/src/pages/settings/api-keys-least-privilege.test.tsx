import { describe, it, expect, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 'test', traits: { email: 'u@x.com' } },
  }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { ApiKeysPage } from './api-keys';

// #348 — a tela aconselhava menor privilégio e fazia o oposto.
//
// Ela diz "a key with fewer scopes is safer if it leaks" e pré-marcava `memory:read` antes de o
// usuário tocar em nada. Medido: quem seguia a jornada do promptly e marcava promptly:read +
// promptly:write saía com TRÊS escopos — o de outro produto ia junto sem ter sido pedido.
//
// Não é escalação de privilégio (dava para desmarcar). É um default que empurra na direção
// oposta à que a própria tela recomenda, e o custo só aparece no cenário sobre o qual a frase
// adverte: quando a chave vaza.
describe('CreateApiKeyDialog — menor privilégio (#348)', () => {
  async function abrirDialogo() {
    mockCloudFetch.mockResolvedValue({ keys: [] });
    const user = userEvent.setup();
    render(<ApiKeysPage />);
    await user.click(
      (await screen.findAllByRole('button', { name: /create api key/i }))[0],
    );
    return user;
  }

  it('nao pre-marca escopo algum', async () => {
    await abrirDialogo();
    const marcados = screen
      .getAllByRole('checkbox')
      .filter((c) => (c as HTMLInputElement).checked);
    expect(marcados).toHaveLength(0);
  });

  // A metade que impede o defeito OPOSTO: sem default, a tela não pode deixar criar uma chave
  // sem escopo nenhum — seria trocar um default ruim por uma credencial inútil emitida em
  // silêncio. A guarda já existia (`selected.size === 0`); este teste prova que ela cobre o
  // caminho novo, que antes era inalcançável porque sempre havia um escopo marcado.
  it('mantem o submit bloqueado enquanto nenhum escopo for escolhido', async () => {
    const user = await abrirDialogo();

    await user.type(screen.getByLabelText(/name/i), 'minha-chave');
    const submit = screen.getByRole('button', { name: /create key/i });
    expect(submit).toBeDisabled();

    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(submit).toBeEnabled();
  });
});
