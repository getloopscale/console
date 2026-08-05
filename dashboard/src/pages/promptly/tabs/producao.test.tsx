import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/render';
import { ProducaoTab } from './producao';
import { linkParaTracesDoPrompt } from '../traces-link';

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

  it('o caminho aponta para o DESTINO exato, não só contém o nome', () => {
    // `toContain('saudacao')` tolerava `/observability/alertz?prompt=saudacao` — um 404 entregue
    // ao operador com o teste verde. O destino é parte do contrato, não detalhe.
    render(<ProducaoTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('link', { name: /monitor/i })).toHaveAttribute(
      'href',
      '/observability/alerts?prompt=saudacao',
    );
  });

  it('codifica um nome que precisa de encoding', () => {
    // O serviço aceita `z.string().min(1)` — sem restrição de caractere. Um nome com `&` injetaria
    // um segundo parâmetro e um com `#` truncaria a query: o operador cairia no formulário com o
    // prompt ERRADO, sem erro nenhum. `encodeURIComponent` existia e nunca era exercitado.
    render(<ProducaoTab {...BASE} promptName="time/greeting&x#y" />);
    expect(screen.getByRole('link', { name: /monitor/i })).toHaveAttribute(
      'href',
      `/observability/alerts?prompt=${encodeURIComponent('time/greeting&x#y')}`,
    );
  });

  it('segue mostrando o que já mostrava — regressão', () => {
    // A aba é do M15/M20; acrescentar o caminho não pode custar as duas perguntas que ela já
    // respondia.
    render(<ProducaoTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('heading', { name: /Uso por revisão/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Quem referencia este prompt/i })).toBeInTheDocument();
  });
});

// M23 — o caminho até as resoluções individuais.
//
// A aba levantava metade de uma pergunta: o M22 respondeu "quer ser avisado quando este número
// mudar?". A outra metade — "o que aconteceu nessas resoluções?" — não tinha resposta, e os traces
// já existiam, indexados, a um filtro de distância.

describe('ProducaoTab — o caminho até as resoluções (M23)', () => {
  it('oferece um caminho até as resoluções deste prompt', () => {
    render(<ProducaoTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('link', { name: /resolu/i })).toBeInTheDocument();
  });

  it('o caminho aponta para o DESTINO exato, construído pelo helper', () => {
    // Comparação da string INTEIRA. `toContain('saudacao')` toleraria `/observability/tracez?…` —
    // um 404 entregue ao operador com o teste verde, que foi o defeito do M22.
    render(<ProducaoTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('link', { name: /resolu/i })).toHaveAttribute(
      'href',
      linkParaTracesDoPrompt('saudacao'),
    );
  });

  it('um nome hostil chega íntegro ao destino', () => {
    render(<ProducaoTab {...BASE} promptName="time/greeting&x#y" />);
    const href = screen.getByRole('link', { name: /resolu/i }).getAttribute('href') ?? '';
    expect(new URL(href, 'https://x').searchParams.get('span_query')).toBe(
      'attr:prompt.id=time/greeting&x#y',
    );
  });

  it('a aba segue respondendo o que já respondia — regressão', () => {
    render(<ProducaoTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('heading', { name: /Uso por revisão/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Quem referencia este prompt/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /monitor/i })).toBeInTheDocument();
  });
});
