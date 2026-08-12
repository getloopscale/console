import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/render';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * B-113 — o seletor de projeto lê pela chave que a invalidação alcança.
 *
 * ## O defeito, medido em 2026-08-10
 *
 * A lista de projetos era lida por DOIS caminhos, sob DUAS chaves que não se falam:
 *
 *     hooks/projects/use-projects.ts    ['projects','list',{limit}]     /engine/api/v1/projects
 *     add-domain-sheet.tsx              ['engine','/api/v1/projects']   /api/v1/projects
 *     create-environment-sheet.tsx      ['engine','/api/v1/projects']   /api/v1/projects
 *
 * E as duas são a MESMA requisição: `engineFetch(p)` é literalmente
 * `cloudFetch('/engine' + p)` (`lib/http/api.ts:315`). Mesma URL, mesmo backend, mesma resposta —
 * só a chave de cache diverge.
 *
 * `use-bulk-delete-projects.ts:52` invalida `queryKeys.projects.all`, que é `['projects']`, e não
 * alcança `['engine', …]`. Com `staleTime: 60_000` (`lib/http/query-client.ts:41`), apagar um
 * projeto e abrir "Add domain" no minuto seguinte oferece o projeto apagado no seletor — e o
 * usuário pode apontar um domínio para um projeto que não existe mais.
 *
 * ## O que este teste afirma, e por que assim
 *
 * Ele monta a folha ao lado de um consumidor de `useProjects()` e **conta as requisições**. Duas
 * chaves para o mesmo dado produzem DUAS buscas; uma chave produz uma.
 *
 * A primeira versão deste arquivo afirmava outra coisa — que a folha renderiza o projeto — e
 * passou verde ANTES do conserto. Ela mockava os dois clientes com a mesma resposta, então os dois
 * caminhos davam no mesmo lugar e nada discriminava. Um teste que não distingue o estado defeituoso
 * do consertado não é um teste; é uma afirmação com sintaxe de teste.
 *
 * Contar requisições é o que discrimina, e não é detalhe de implementação: é o custo visível ao
 * usuário — a segunda busca é a que traz a lista velha para o seletor.
 */

const mockEngineFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({
  cloudFetch: (...args: unknown[]) => mockEngineFetch(...args),
  engineFetch: (...args: unknown[]) => mockEngineFetch(...args),
}));

import { useProjects } from '@/hooks/projects/use-projects';
import { AddDomainSheet } from './add-domain-sheet';
import { CreateEnvironmentSheet } from './create-environment-sheet';

beforeEach(() => {
  vi.clearAllMocks();
  mockEngineFetch.mockResolvedValue({ projects: [{ name: 'acme-web', apps: [] }], total: 1 });
});

/** Um consumidor da lista canônica, montado ao lado da folha — como a tela real faz. */
function ListaCanonica() {
  const { projects } = useProjects();
  return <div data-testid="lista-canonica">{projects.length}</div>;
}

/** Quantas vezes a lista de projetos foi buscada, seja por qual caminho for. */
function buscasDaLista(): number {
  return mockEngineFetch.mock.calls.filter((c) => String(c[0]).includes('/api/v1/projects')).length;
}

describe('o seletor de projeto lê pela chave canônica (B-113)', () => {
  it('a folha de domínio NÃO abre uma segunda busca da mesma lista', async () => {
    render(
      <>
        <ListaCanonica />
        <AddDomainSheet open={true} onOpenChange={() => {}} />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('lista-canonica')).toHaveTextContent('1');
    });

    expect(
      buscasDaLista(),
      'A lista de projetos foi buscada mais de uma vez na mesma árvore.\n' +
        'Duas buscas = duas chaves de cache, e a invalidação alcança só uma delas.\n',
    ).toBe(1);
  });

  it('a folha de ambiente NÃO abre uma segunda busca da mesma lista', async () => {
    render(
      <>
        <ListaCanonica />
        <CreateEnvironmentSheet open={true} onOpenChange={() => {}} />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('lista-canonica')).toHaveTextContent('1');
    });

    expect(buscasDaLista(), 'segunda busca da mesma lista').toBe(1);
  });

  it('a chave que a exclusão invalida é a chave que o seletor usa', () => {
    // A asserção estrutural que fecha o buraco: `use-bulk-delete-projects` invalida
    // `queryKeys.projects.all` (`['projects']`), e a chave da lista precisa cair DENTRO dele —
    // TanStack casa por prefixo. `['engine','/api/v1/projects']` não cai, e era esse o defeito.
    const listagem = queryKeys.projects.list();
    const invalidada = queryKeys.projects.all;

    expect(
      listagem.slice(0, invalidada.length),
      'a chave da lista de projetos saiu de baixo do prefixo que a exclusão invalida',
    ).toEqual([...invalidada]);
  });
});
