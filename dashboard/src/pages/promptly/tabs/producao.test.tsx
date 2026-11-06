import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/render';
import { ProductionTab } from './producao';
import { linkToPromptTraces } from '../traces-link';

// M22 DoD-3 — o prompt tem caminho até o seu monitor.
//
// A tela de alerta existe (`/observability/alerts`) e o operador que está olhando o uso por
// revisão não tem como saber disso. Um número na tela sem caminho para agir sobre ele é metade
// da resposta.

const BASE = {
  windowDays: 7,
  rows: [],
  dependentes: [],
  dependentesIlegiveis: false,
  dependentsLoading: false,
} as const;

describe('ProducaoTab — o caminho até o monitor (M22)', () => {
  it('oferece um caminho até o monitor deste prompt', () => {
    render(<ProductionTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('link', { name: /monitor/i })).toBeInTheDocument();
  });

  it('o caminho aponta para o DESTINO exato, não só contém o nome', () => {
    // `toContain('saudacao')` tolerava `/observability/alertz?prompt=saudacao` — um 404 entregue
    // ao operador com o teste verde. O destino é parte do contrato, não detalhe.
    render(<ProductionTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('link', { name: /monitor/i })).toHaveAttribute(
      'href',
      '/observability/alerts?prompt=saudacao',
    );
  });

  it('codifica um nome que precisa de encoding', () => {
    // O serviço aceita `z.string().min(1)` — sem restrição de caractere. Um nome com `&` injetaria
    // um segundo parâmetro e um com `#` truncaria a query: o operador cairia no formulário com o
    // prompt ERRADO, sem erro nenhum. `encodeURIComponent` existia e nunca era exercitado.
    render(<ProductionTab {...BASE} promptName="time/greeting&x#y" />);
    expect(screen.getByRole('link', { name: /monitor/i })).toHaveAttribute(
      'href',
      `/observability/alerts?prompt=${encodeURIComponent('time/greeting&x#y')}`,
    );
  });

  it('segue mostrando o que já mostrava — regressão', () => {
    // A aba é do M15/M20; acrescentar o caminho não pode custar as duas perguntas que ela já
    // respondia.
    render(<ProductionTab {...BASE} promptName="saudacao" />);
    expect(screen.getByRole('heading', { name: /Usage by revision/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /What references this prompt/i })).toBeInTheDocument();
  });
});

// M23 — o caminho até as resoluções individuais.
//
// A aba levantava metade de uma pergunta: o M22 respondeu "quer ser avisado quando este número
// mudar?". A outra metade — "o que aconteceu nessas resoluções?" — não tinha resposta, e os traces
// já existiam, indexados, a um filtro de distância.

const COM_USO = [
  { revision: 1, estado: 'com-uso' as const, chamadas: 9, tokens: 0, latenciaP50Ms: 9 },
];

describe('ProducaoTab — o caminho até as resoluções (M23)', () => {
  it('oferece o caminho quando houve chamada medida', () => {
    render(<ProductionTab {...BASE} rows={COM_USO} promptName="saudacao" />);
    expect(screen.getByRole('link', { name: /runs in traces/i })).toBeInTheDocument();
  });

  it('o caminho aponta para o DESTINO exato, construído pelo helper', () => {
    // Comparação da string INTEIRA. `toContain('saudacao')` toleraria `/observability/tracez?…` —
    // um 404 entregue ao operador com o teste verde, que foi o defeito do M22. O `pathname`
    // literal é fixado em `traces-link.test.ts`, então esta comparação não é circular.
    render(<ProductionTab {...BASE} rows={COM_USO} promptName="saudacao" />);
    expect(screen.getByRole('link', { name: /runs in traces/i })).toHaveAttribute(
      'href',
      linkToPromptTraces('saudacao'),
    );
  });

  it('um nome hostil chega íntegro ao destino', () => {
    render(<ProductionTab {...BASE} rows={COM_USO} promptName="time/greeting&x#y" />);
    const href = screen.getByRole('link', { name: /runs in traces/i }).getAttribute('href') ?? '';
    expect(new URL(href, 'https://x').searchParams.get('span_query')).toBe(
      'attr:prompt.id=time/greeting&x#y',
    );
  });

  it('o nome acessível diz DE QUAL prompt são as execuções', () => {
    // Um leitor de tela que tabula por links ouviria "deste prompt" sem antecedente.
    render(<ProductionTab {...BASE} rows={COM_USO} promptName="saudacao" />);
    expect(screen.getByRole('link', { name: /saudacao runs in traces/i })).toBeInTheDocument();
  });

  it('um nome em branco NÃO derruba a aba — o caminho apenas não é oferecido', () => {
    // A primeira versão lançava dentro do JSX: o ErrorBoundary substituía a tela de detalhe
    // inteira por "This page crashed", com um Retry que re-renderiza o mesmo estado e estoura de
    // novo. `/promptly/%20/production` entrega exatamente este valor.
    expect(() =>
      render(<ProductionTab {...BASE} rows={COM_USO} promptName="   " />),
    ).not.toThrow();
    expect(screen.queryByRole('link', { name: /runs in traces/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Usage by revision/i })).toBeInTheDocument();
  });

  it('não convida a ver "cada uma delas" quando NÃO houve chamada', () => {
    // O convite era incondicional e aparecia logo abaixo de "Nenhuma revisão para reportar".
    render(<ProductionTab {...BASE} rows={[]} promptName="saudacao" />);
    expect(screen.queryByRole('link', { name: /runs in traces/i })).not.toBeInTheDocument();
    expect(screen.getByText(/No revisions to report/i)).toBeInTheDocument();
  });

  it('não convida quando a leitura do uso FALHOU — ausência de leitura não é ausência de uso', () => {
    // O estado que este arquivo defende em dois outros lugares, e que o convite apagava.
    render(
      <ProductionTab
        {...BASE}
        rows={[{ revision: 1, estado: 'nao-lido' as const, rationale: 'upstream 502' }]}
        promptName="saudacao"
      />,
    );
    expect(screen.queryByRole('link', { name: /runs in traces/i })).not.toBeInTheDocument();
    expect(screen.getByText(/upstream 502/i)).toBeInTheDocument();
  });

  it('a aba segue respondendo o que já respondia — regressão', () => {
    render(<ProductionTab {...BASE} rows={COM_USO} promptName="saudacao" />);
    expect(screen.getByRole('heading', { name: /Usage by revision/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /What references this prompt/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /monitor/i })).toBeInTheDocument();
  });
});
