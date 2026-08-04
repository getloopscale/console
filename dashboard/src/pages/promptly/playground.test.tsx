import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({ active: true, identity: { id: 't', traits: { email: 'u@x.com' } } }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ promptName: 'saudacao' }) };
});

const mockPrompt = vi.fn();
const mockRun = vi.fn();
const mockCreate = vi.fn();
vi.mock('@/components/promptly/promptly-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/promptly/promptly-api')>();
  return {
    ...actual,
    fetchPrompt: (...a: unknown[]) => mockPrompt(...a),
    runPlayground: (...a: unknown[]) => mockRun(...a),
    createRevision: (...a: unknown[]) => mockCreate(...a),
  };
});

import { PromptlyPlaygroundPage } from './playground';

const SENTINELA = 'sk-SENTINELA-NAO-VAZAR';

beforeEach(() => {
  mockPrompt.mockReset();
  mockRun.mockReset();
  mockCreate.mockReset();
  mockPrompt.mockResolvedValue({
    name: 'saudacao',
    content: 'Escreva sobre {{topico}} citando {{artigo}}',
    version: 3,
    variables: ['topico', 'artigo'],
  });
  mockRun.mockResolvedValue({ text: 'chove muito', latencyMs: 42 });
  mockCreate.mockResolvedValue({ name: 'saudacao', version: 4 });
  localStorage.clear();
  sessionStorage.clear();
});

/** Preenche as duas variáveis e a chave — o estado a partir do qual dá para rodar. */
async function prontoParaRodar() {
  fireEvent.change(await screen.findByLabelText('topico'), { target: { value: 'chuva' } });
  fireEvent.change(screen.getByLabelText('artigo'), { target: { value: 'NYT' } });
  fireEvent.change(screen.getByLabelText('Chave de API do modelo'), {
    target: { value: SENTINELA },
  });
}

describe('M14 — o playground', () => {
  /** DoD-2 — os campos vêm de `variables`, que a API declara. */
  it('DoD2_um_campo_por_variavel_declarada_com_o_nome_dela', async () => {
    render(<PromptlyPlaygroundPage />);

    expect(await screen.findByLabelText('topico')).toBeInTheDocument();
    expect(screen.getByLabelText('artigo')).toBeInTheDocument();
    // Um terceiro campo aqui significaria derivação do texto em vez de leitura do
    // que o serviço declarou — o defeito que o DoD-2 nomeia.
    expect(screen.queryByLabelText('inexistente')).toBeNull();
  });

  /**
   * DoD-3 — o aviso PRECEDE o botão. A ordem é o que se assere, não a presença:
   * um aviso depois do botão é lido depois do clique, que é tarde.
   */
  it('DoD3_o_aviso_de_custo_precede_o_botao_Rodar', async () => {
    render(<PromptlyPlaygroundPage />);

    const aviso = await screen.findByTestId('playground-aviso-custo');
    const botao = screen.getByRole('button', { name: 'Rodar' });

    expect(aviso.textContent).toMatch(/consome a quota da sua chave/i);
    expect(aviso.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /** DoD-4 — o campo é `password`. */
  it('DoD4_o_campo_de_credencial_e_type_password', async () => {
    render(<PromptlyPlaygroundPage />);

    expect(await screen.findByLabelText('Chave de API do modelo')).toHaveAttribute(
      'type',
      'password',
    );
  });

  /**
   * DoD-4, o controle negativo — DEPOIS de uma execução bem-sucedida. Rodar antes
   * de asserir é o que torna o teste discriminante: um `useState` puro passaria
   * mesmo sem execução, e um `localStorage.setItem` no `onSuccess` não.
   */
  it('DoD4_depois_de_rodar_a_credencial_nao_esta_em_storage_nem_na_URL', async () => {
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();

    await userEvent.click(screen.getByRole('button', { name: 'Rodar' }));
    await screen.findByText('chove muito');

    expect(JSON.stringify(localStorage)).not.toContain(SENTINELA);
    expect(JSON.stringify(sessionStorage)).not.toContain(SENTINELA);
    expect(window.location.search).not.toContain(SENTINELA);
    expect(window.location.hash).not.toContain(SENTINELA);
  });

  /** A credencial chega ao cliente de API — sem isto o teste acima passaria por não enviar nada. */
  it('a_credencial_digitada_e_a_que_vai_para_a_invocacao', async () => {
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();

    await userEvent.click(screen.getByRole('button', { name: 'Rodar' }));
    await screen.findByText('chove muito');

    // M17 acrescentou um 5º argumento (a config). `null` aqui é o caso "não afinei".
    expect(mockRun).toHaveBeenCalledWith(
      'saudacao',
      'Escreva sobre {{topico}} citando {{artigo}}',
      { topico: 'chuva', artigo: 'NYT' },
      SENTINELA,
      null,
    );
  });

  /** DoD-5 — a recusa do provider aparece NA ÁREA DE SAÍDA, com o motivo dele. */
  it('DoD5_recusa_do_provider_renderiza_a_mensagem_tipada_na_area_de_saida', async () => {
    mockRun.mockRejectedValue(
      new ApiError(422, {
        error: 'model_refused',
        providerStatus: 401,
        message: 'Incorrect API key provided',
      }),
    );
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();

    await userEvent.click(screen.getByRole('button', { name: 'Rodar' }));

    const saida = await screen.findByTestId('playground-saida');
    expect(within(saida).getByText(/Incorrect API key provided/)).toBeInTheDocument();
  });

  /**
   * O controle negativo do teste acima: transporte continua genérico. Se o repasse
   * fosse cego, um 5xx viraria "o provedor recusou" e mandaria o operador trocar
   * uma chave que está boa.
   */
  it('DoD5_falha_de_transporte_e_generica_e_nao_inventa_status_de_provider', async () => {
    mockRun.mockRejectedValue(new ApiError(0, undefined));
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();

    await userEvent.click(screen.getByRole('button', { name: 'Rodar' }));

    const saida = await screen.findByTestId('playground-saida');
    expect(within(saida).getByText(/não foi possível falar com o serviço/i)).toBeInTheDocument();
    expect(within(saida).queryByText(/provedor do modelo recusou/i)).toBeNull();
  });

  /**
   * O estado vazio não se confunde com falha — é exatamente o defeito medido no
   * peer, cuja área de saída volta a ficar em branco depois de um erro em toast.
   */
  it('antes_de_rodar_a_area_de_saida_diz_que_ainda_nao_rodou', async () => {
    render(<PromptlyPlaygroundPage />);

    const saida = await screen.findByTestId('playground-saida');
    expect(within(saida).getByText(/Nada foi executado ainda/i)).toBeInTheDocument();
  });

  /** DoD-5, a metade barata: sem preencher, não dá nem para tentar. */
  it('DoD5_Rodar_fica_desabilitado_enquanto_uma_variavel_estiver_vazia', async () => {
    render(<PromptlyPlaygroundPage />);

    fireEvent.change(await screen.findByLabelText('topico'), { target: { value: 'chuva' } });
    fireEvent.change(screen.getByLabelText('Chave de API do modelo'), {
      target: { value: SENTINELA },
    });

    // `artigo` continua vazia.
    expect(screen.getByRole('button', { name: 'Rodar' })).toBeDisabled();
  });

  it('DoD5_Rodar_fica_desabilitado_sem_credencial', async () => {
    render(<PromptlyPlaygroundPage />);

    fireEvent.change(await screen.findByLabelText('topico'), { target: { value: 'chuva' } });
    fireEvent.change(screen.getByLabelText('artigo'), { target: { value: 'NYT' } });

    expect(screen.getByRole('button', { name: 'Rodar' })).toBeDisabled();
  });

  /** DoD-6 — salvar manda o texto DA TELA, que é o mesmo que foi rodado. */
  it('DoD6_salvar_envia_o_conteudo_que_esta_na_tela', async () => {
    render(<PromptlyPlaygroundPage />);
    fireEvent.change(await screen.findByLabelText('Conteúdo do prompt'), {
      target: { value: 'TEXTO EDITADO {{topico}}' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Salvar como nova revisão' }));

    // M17 acrescentou os extras. A descrição vai vazia aqui porque este teste mede o
    // CONTEÚDO; a obrigatoriedade da descrição é da tela de criação (ADR-3), e o
    // playground não a impõe — salvar dali é um atalho de quem acabou de testar.
    expect(mockCreate).toHaveBeenCalledWith('saudacao', 'TEXTO EDITADO {{topico}}', {
      changeDescription: '',
      modelConfig: null,
    });
  });

  /** O mesmo texto que foi rodado é o que se salva — o par que dá sentido ao DoD-6. */
  it('DoD6_o_texto_rodado_e_o_texto_salvo_sao_o_mesmo', async () => {
    render(<PromptlyPlaygroundPage />);
    fireEvent.change(await screen.findByLabelText('Conteúdo do prompt'), {
      target: { value: 'EDITADO {{topico}}' },
    });
    // O texto editado declara SÓ `topico` — `artigo` deixou de existir, e o campo
    // dele some junto (é o regime editado; ver o segundo `describe` abaixo).
    fireEvent.change(screen.getByLabelText('topico'), { target: { value: 'chuva' } });
    fireEvent.change(screen.getByLabelText('Chave de API do modelo'), {
      target: { value: SENTINELA },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Rodar' }));
    await screen.findByText('chove muito');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar como nova revisão' }));

    expect(mockRun.mock.calls[0]?.[1]).toBe('EDITADO {{topico}}');
    expect(mockCreate.mock.calls[0]?.[1]).toBe('EDITADO {{topico}}');
  });

  /**
   * Concorrência observável num botão FATURÁVEL: dois cliques rápidos não podem
   * virar duas invocações. É a única corrida que esta tela tem, e ela custa
   * dinheiro do operador.
   */
  it('clicar_Rodar_duas_vezes_rapido_nao_dispara_duas_invocacoes', async () => {
    let resolver: (v: unknown) => void = () => {};
    mockRun.mockImplementation(() => new Promise((r) => (resolver = r)));
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();

    const botao = screen.getByRole('button', { name: 'Rodar' });
    await userEvent.click(botao);
    await userEvent.click(botao); // o segundo cai num botão já desabilitado

    expect(mockRun).toHaveBeenCalledTimes(1);
    resolver({ text: 'ok' });
  });

  /**
   * Falha de leitura NÃO é renderizada como "não há nada" — são fatos diferentes,
   * e a diferença é a que importa para quem está olhando.
   */
  it('falha_ao_carregar_o_prompt_e_dita_como_falha_e_nao_como_vazio', async () => {
    mockPrompt.mockRejectedValue(new ApiError(500, { error: 'internal_error' }));
    render(<PromptlyPlaygroundPage />);

    expect(await screen.findByText(/Não foi possível carregar este prompt/i)).toBeInTheDocument();
  });

  /** Todo formulário tem saída explícita — o checklist de navegação da casa. */
  it('existe_caminho_de_volta_ao_detalhe_do_prompt', async () => {
    render(<PromptlyPlaygroundPage />);

    expect(await screen.findByRole('link', { name: /Voltar ao prompt/i })).toHaveAttribute(
      'href',
      '/promptly/saudacao',
    );
  });
});

/**
 * M14 pós-review (H3) — o beco sem saída que a revisão encontrou.
 *
 * O fluxo central do milestone é editar → rodar → salvar. Enquanto os campos vinham
 * SÓ de `variables` (a lista do conteúdo armazenado), acrescentar uma variável ao
 * texto produzia: "Rodar" habilitado (o cliente só validava o declarado), servidor
 * recusando com `missing_variable`, e **nenhum campo na tela para preencher**.
 * Recusa em laço, sem saída — e nenhum teste em camada alguma cobria.
 */
describe('M14 — os campos acompanham o conteúdo EDITADO', () => {
  it('acrescentar uma variavel ao texto cria o campo dela', async () => {
    render(<PromptlyPlaygroundPage />);
    await screen.findByLabelText('topico');

    fireEvent.change(screen.getByLabelText('Conteúdo do prompt'), {
      target: { value: 'Sobre {{topico}} citando {{artigo}} e a {{fonte}}' },
    });

    expect(await screen.findByLabelText('fonte')).toBeInTheDocument();
  });

  it('remover uma variavel do texto remove o campo dela', async () => {
    render(<PromptlyPlaygroundPage />);
    await screen.findByLabelText('artigo');

    fireEvent.change(screen.getByLabelText('Conteúdo do prompt'), {
      target: { value: 'Só sobre {{topico}}' },
    });

    await waitFor(() => {
      expect(screen.queryByLabelText('artigo')).toBeNull();
    });
    expect(screen.getByLabelText('topico')).toBeInTheDocument();
  });

  it('o valor ja digitado sobrevive a edicao que preserva a variavel', async () => {
    render(<PromptlyPlaygroundPage />);
    fireEvent.change(await screen.findByLabelText('topico'), { target: { value: 'chuva' } });

    fireEvent.change(screen.getByLabelText('Conteúdo do prompt'), {
      target: { value: 'Reescrito, mas ainda com {{topico}}' },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('topico')).toHaveValue('chuva');
    });
  });

  /** O fecho do beco: com o campo novo preenchido, dá para rodar. */
  it('depois de criar o campo novo e preenche-lo, Rodar habilita', async () => {
    render(<PromptlyPlaygroundPage />);
    await screen.findByLabelText('topico');

    fireEvent.change(screen.getByLabelText('Conteúdo do prompt'), {
      target: { value: 'Sobre {{topico}} e {{fonte}}' },
    });
    fireEvent.change(await screen.findByLabelText('fonte'), { target: { value: 'IBGE' } });
    fireEvent.change(screen.getByLabelText('topico'), { target: { value: 'chuva' } });
    fireEvent.change(screen.getByLabelText('Chave de API do modelo'), {
      target: { value: SENTINELA },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Rodar' })).toBeEnabled();
    });
  });

  /**
   * DoD-2 continua verdadeiro no regime que ele descreve: enquanto o conteúdo é o
   * armazenado, a lista é a que a API declara — não uma derivação local.
   */
  it('sem edicao, a lista continua vindo de `variables` e nao do texto', async () => {
    // O mock declara ['topico','artigo'] para um conteúdo que também tem os dois;
    // aqui o serviço declara MENOS do que o texto contém, e a tela obedece ao serviço.
    mockPrompt.mockResolvedValue({
      name: 'saudacao',
      content: 'Sobre {{topico}} e {{artigo}}',
      version: 3,
      variables: ['topico'],
    });
    render(<PromptlyPlaygroundPage />);

    expect(await screen.findByLabelText('topico')).toBeInTheDocument();
    expect(screen.queryByLabelText('artigo')).toBeNull();
  });
});

/**
 * M14 pós-review (H2) — a fixture da recusa usava um `message` que o serviço nunca
 * emite. A rota devolve apenas `{error, providerStatus}`, então quem renderiza em
 * produção é o FALLBACK — e ele não tinha teste, enquanto o caminho testado era
 * inalcançável.
 */
describe('M14 — a recusa do provider como o serviço realmente a emite', () => {
  it('sem `message`, o fallback nomeia o status do provider', async () => {
    mockRun.mockRejectedValue(new ApiError(422, { error: 'model_refused', providerStatus: 401 }));
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();

    await userEvent.click(screen.getByRole('button', { name: 'Rodar' }));

    const saida = await screen.findByTestId('playground-saida');
    expect(within(saida).getByText(/provedor respondeu 401/i)).toBeInTheDocument();
    // E não deixa o número sumir — o defeito seria "O provedor respondeu  e recusou".
    expect(within(saida).queryByText(/respondeu\s+e recusou/i)).toBeNull();
  });

  it('quota estourada chega com 429, distinta da chave invalida', async () => {
    mockRun.mockRejectedValue(new ApiError(422, { error: 'model_refused', providerStatus: 429 }));
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();

    await userEvent.click(screen.getByRole('button', { name: 'Rodar' }));

    const saida = await screen.findByTestId('playground-saida');
    expect(within(saida).getByText(/provedor respondeu 429/i)).toBeInTheDocument();
  });
});

describe('M17 — a config que se testa é a que se salva (ADR-2)', () => {
  it('a temperatura digitada CHEGA a invocacao', async () => {
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();
    fireEvent.change(screen.getByLabelText(/temperatura/i), { target: { value: '0.2' } });

    await userEvent.click(screen.getByRole('button', { name: /rodar/i }));

    await vi.waitFor(() => expect(mockRun).toHaveBeenCalled());
    const [, , , , config] = mockRun.mock.calls[0] as unknown[];
    expect(config).toEqual({ temperature: 0.2 });
  });

  it('temperatura ZERO chega — nao e tratada como ausente', async () => {
    // `0` é falsy, e o campo é string: `Number('') === 0` também. O discriminante é a
    // string vazia, nunca a veracidade do número.
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();
    fireEvent.change(screen.getByLabelText(/temperatura/i), { target: { value: '0' } });

    await userEvent.click(screen.getByRole('button', { name: /rodar/i }));

    await vi.waitFor(() => expect(mockRun).toHaveBeenCalled());
    const [, , , , config] = mockRun.mock.calls[0] as unknown[];
    expect(config).toEqual({ temperature: 0 });
  });

  it('sem temperatura, NADA e enviado — nao um default que ninguem escolheu', async () => {
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();

    await userEvent.click(screen.getByRole('button', { name: /rodar/i }));

    await vi.waitFor(() => expect(mockRun).toHaveBeenCalled());
    const [, , , , config] = mockRun.mock.calls[0] as unknown[];
    expect(config).toBeNull();
  });

  it('salvar grava a config da EXECUCAO, nao a que estiver no campo depois', async () => {
    // O laço do ADR-2 na sua forma mais afiada: mexer na temperatura DEPOIS de rodar
    // não pode virar uma afinação "testada" que ninguém testou.
    render(<PromptlyPlaygroundPage />);
    await prontoParaRodar();
    fireEvent.change(screen.getByLabelText(/temperatura/i), { target: { value: '0.2' } });
    await userEvent.click(screen.getByRole('button', { name: /rodar/i }));
    await screen.findByText(/chove muito/);

    fireEvent.change(screen.getByLabelText(/temperatura/i), { target: { value: '1.9' } });
    fireEvent.change(screen.getByLabelText(/por que esta revisão/i), {
      target: { value: 'afinei para extração' },
    });
    await userEvent.click(screen.getByRole('button', { name: /salvar como nova revisão/i }));

    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const [, , extras] = mockCreate.mock.calls[0] as unknown[];
    expect((extras as { modelConfig: unknown }).modelConfig).toEqual({ temperature: 0.2 });
    expect((extras as { changeDescription: string }).changeDescription).toBe('afinei para extração');
  });
});
