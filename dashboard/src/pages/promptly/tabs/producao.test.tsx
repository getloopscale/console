import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/render';
import { ProducaoTab } from './producao';

// M22 DoD-3 — o prompt tem caminho até o seu monitor.
//
// A tela de alerta existe (`/observability/alerts`) e o operador que está olhando o uso por
// revisão não tem como saber disso. Um número na tela sem caminho para agir sobre ele é metade
// da resposta.

const BASE = {
  janelaDias: 7,
  linhas: [],
  dependentes: [],
  dependentesIlegiveis: false,
  dependentesCarregando: false,
} as const;

describe('ProducaoTab — o caminho até o monitor (M22)', () => {
  it('oferece um caminho até o monitor deste prompt', () => {
    render(<ProducaoTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('link', { name: /monitor/i })).toBeInTheDocument();
  });

  it('o caminho carrega o NOME do prompt — não é um link genérico para a lista', () => {
    // Sem o nome, o operador chega numa tela vazia e precisa digitá-lo de novo — que é a fricção
    // que este DoD existe para remover.
    render(<ProducaoTab {...BASE} promptName="saudacao" />);
    const href = screen.getByRole('link', { name: /monitor/i }).getAttribute('href') ?? '';
    expect(href).toContain('saudacao');
  });

  it('segue mostrando o que já mostrava — regressão', () => {
    // A aba é do M15/M20; acrescentar o caminho não pode custar as duas perguntas que ela já
    // respondia.
    render(<ProducaoTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('heading', { name: /Uso por revisão/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Quem referencia este prompt/i })).toBeInTheDocument();
  });
});
