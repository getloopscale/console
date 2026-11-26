// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Globe } from 'lucide-react';
import { estadoDaLista } from './list-state';

const VAZIO = { icon: Globe, title: 'No custom domains yet' };

describe('estadoDaLista — ausência e ignorância não são a mesma tela', () => {
  it('devolve o estado vazio quando a leitura deu certo', () => {
    expect(estadoDaLista({ failure: false, empty: VAZIO }, 'domains')).toBe(VAZIO);
  });

  it('NÃO afirma ausência quando a leitura falhou', () => {
    const s = estadoDaLista({ failure: true, empty: VAZIO }, 'domains')!;
    expect(s.title).not.toMatch(/no custom domains yet/i);
    expect(s.title).toMatch(/could not read domains/i);
  });

  it('diz ao usuário o que a tela NÃO está mostrando', () => {
    // A diferença que importa: "não há nada" é um fato sobre os dados; "não li" é um fato
    // sobre a requisição. A segunda tem de dizer que a lista não representa o que existe.
    const s = estadoDaLista({ failure: true, empty: VAZIO }, 'domains')!;
    expect(s.description).toMatch(/not showing what exists/i);
  });
});

describe('estadoDaLista — quando a lista tem linhas', () => {
  it('não vira estado de erro por cima de dados que existem', () => {
    // `vazio === undefined` é como o PageShell diz "há linhas". Um erro de refetch sobre
    // dados velhos pede uma tarja, não um estado vazio — e essa decisão não é desta função.
    expect(estadoDaLista({ failure: true, empty: undefined }, 'domains')).toBeUndefined();
  });
});

describe('B-167 — nenhuma página afirma ausência sem consultar um sinal de erro', () => {
  const SRC = resolve(__dirname, '..');

  /** Todos os `.tsx` de página, sem testes. */
  function paginas(): string[] {
    const achados: string[] = [];
    const pilha = [join(SRC, 'pages')];
    while (pilha.length > 0) {
      const atual = pilha.pop();
      if (atual === undefined) break;
      for (const nome of readdirSync(atual)) {
        const caminho = join(atual, nome);
        if (statSync(caminho).isDirectory()) pilha.push(caminho);
        else if (nome.endsWith('.tsx') && !nome.includes('.test.')) achados.push(caminho);
      }
    }
    return achados;
  }

  /**
   * ZERO desde 2026-08-12 (B-243). A catraca deixa de congelar uma população e passa a ser o
   * que sempre quis ser: nenhuma tela nova pode afirmar ausência sem consultar erro.
   *
   * A PRIMEIRA versão deste número, escrita horas antes, era falsa e a revisão a derrubou.
   * Ela atribuía 7 -> 0 a "2 correções + 4 vocabulário + 1 sem leitura". Medido, o
   * `consultaErro` alargado removia ZERO arquivos: todos os quatro já saíam antes, pelo
   * `iniciaLeitura` — que naquela versão casava sete grafias literais e por isso classificava
   * `useProjects()`, `useApiKeys()`, `useTrustViolations()` como "componente que recebe a
   * lista". O revisor provou o buraco removendo TODO o tratamento de erro de cinco páginas
   * que buscam de verdade: a catraca seguiu verde.
   *
   * Ou seja: eu havia baixado a catraca estreitando o próprio detector — exatamente o que o
   * B-238 diagnosticou e este arquivo existe para não repetir.
   *
   * Com o `iniciaLeitura` corrigido (hooks de domínio contam como leitura), a decomposição
   * medida é:
   *
   *   59  páginas afirmam ausência
   *   45  dessas FAZEM leitura — as outras 14 recebem a lista pronta ou a mantêm em estado
   *       local, e não têm erro nenhum para consultar
   *    3  eram culpadas antes desta fatia
   *    2  CORRIGIDAS em código: `memory/scope-switcher.tsx` lia `.data` e descartava `.error`;
   *       `projects/project-detail.tsx` desestruturava `builds` e jogava fora o `error`
   *    1  `overview/status.tsx`, que JÁ era conforme — renderiza role="alert" "Could not read
   *       service status" e o guarda procurava "Could not load". Um verbo.
   *    0  culpadas agora
   *
   * Dois terços por correção, um terço por medição consertada — e agora o número diz o que
   * afirma, porque a atribuição foi conferida contra o que o código produz, e não contra o
   * que eu quis que ele produzisse.
   */
  const TETO_SEM_ERRO = 0;

  /**
   * Os dois predicados do guarda, nomeados (B-237).
   *
   * O auto-teste lá embaixo REESCREVIA a regra numa constante local e verificava a cópia — provava
   * que a expressão que ele mesmo acabara de escrever funcionava, e nada sobre o guarda. Um
   * predicado que parasse de discriminar deixava tudo verde, que é o defeito que este arquivo
   * inteiro existe para pegar em outras telas.
   */
  const afirmaAusencia = (fonte: string) =>
    /\bempty=\{/.test(fonte) ||
    /(?:length === 0|length !== 0)[\s\S]{0,400}?(?:No |Nenhum|Nada|não há|nao ha)/i.test(fonte);

  /**
   * B-238 — a versão anterior reconhecia TRÊS formas (`estadoDaLista(`, `error={`, `isError`) e
   * contava como culpada toda tela que consultasse o erro de outro jeito. Medido: das 23 da
   * população, 16 já consultavam — por uma variável local (`const falhou = query.error`), por um
   * `error` desestruturado de um hook e usado num ternário, por uma frase que diz "the read
   * failed". A catraca estava contando o vocabulário do guarda, não o defeito.
   *
   * Baixar um teto assim seria afrouxar; o que houve foi o oposto — o número passou a significar
   * o que sempre afirmou.
   *
   * LIMITE QUE SEGUE DE PÉ: a checagem é por ARQUIVO. Uma tela que consulte o erro de UMA lista
   * e afirme ausência cega em OUTRA passa. Isso NÃO foi o que produziu o resíduo do B-243 —
   * medido, o limite que produzia era outro (por tipo de arquivo, resolvido em `iniciaLeitura`)
   * — então a análise por bloco segue aberta e sem evidência que a justifique hoje. Construí-la
   * agora seria resolver o problema para o qual a medição não aponta.
   */
  const consultaErro = (fonte: string) =>
    /estadoDaLista\(|\berror=\{|\bisError\b/.test(fonte) ||
    // Um sinal de LEITURA que falhou — e não um status de domínio como `step.status === 'failed'`,
    // que foi o que uma primeira tentativa de alargamento capturou por engano.
    /\.error\b|\berroDe\w*|\bfalhou\b|\bfalharam\b/.test(fonte) ||
    /read failed|failed to load|Could not load|setError\(/i.test(fonte) ||
    // B-243 — três formas que telas JÁ CONFORMES usavam e o guarda não reconhecia. Medido
    // 2026-08-12: das 5 que restavam, 4 estavam corretas e foram acusadas por vocabulário.
    //
    //   "Could not read …"   overview/status.tsx:46, com role="alert"
    //   ilegivel / ilegiveis promptly/tabs/config.tsx:37 (`if (ilegivel) return …`),
    //                        promptly/tabs/producao.tsx:174 (Alert dos dependentes)
    //   'nao-lido'           promptly/revision-columns.tsx:110
    //
    // O guarda procurava "Could not load" e a tela dizia "Could not read": um verbo de
    // diferença. É o mesmo defeito que o B-238 corrigiu uma camada acima — a catraca contando
    // o vocabulário do guarda em vez do defeito.
    //
    // DEPENDÊNCIA COM O B-241: `ilegivel` e `nao-lido` são identificadores em português. Quando
    // aquela migração os renomear, ESTES padrões têm de acompanhar no mesmo lote, ou o guarda
    // volta a ficar cego — e desta vez sem ninguém procurando.
    // `ilegiv` sem `\b`: em `dependentesIlegiveis` o radical vem colado a uma palavra,
    // e a âncora o perdia — o auto-teste abaixo pegou isso.
    /Could not read|could not be (?:read|loaded)|ilegiv\w*|\bnao-lido\b|\bnaoLido\b/i.test(
      fonte,
    ) ||
    // O valor de erro USADO numa condicional: é a consulta, escrita sem prop nem hook.
    /\b(?:error|erro)\b\s*(?:\?|&&|\|\|)|if\s*\(\s*!?\s*(?:error|erro)\b/.test(fonte);

  /**
   * B-243 — só é culpada a tela que FAZ a leitura.
   *
   * Um componente apresentacional recebe a lista pronta (`readonly variaveis: readonly
   * string[]`) ou a mantém em estado local (o menu de slash do `kb-editor`). Não há requisição
   * nele que possa falhar, e exigir que consulte um erro é exigir que invente um: quem sabe se
   * a leitura falhou é quem a fez, e é lá que a distinção pertence — como `config.tsx` e
   * `producao.tsx` já fazem, recebendo a flag do pai.
   *
   * Este é o limite que o item registrou como "checagem por ARQUIVO". Medido, o limite que
   * produzia o resíduo não era esse: era por TIPO de arquivo — página que lê versus componente
   * que recebe.
   */
  /**
   * Hooks que NÃO são leitura. Tudo o mais que se chame `useAlgo(` numa página é hook de
   * domínio, e hook de domínio lê.
   *
   * A lista cresce quando aparece um hook novo de UI. Errar para MAIS aqui é seguro — o
   * arquivo apenas passa a ser cobrado —; errar para MENOS é o defeito que a primeira versão
   * deste predicado tinha, e ele é silencioso.
   */
  const HOOKS_QUE_NAO_LEEM =
    /^use(State|Effect|Memo|Callback|Ref|Context|Reducer|Id|Transition|DeferredValue|LayoutEffect|ImperativeHandle|SyncExternalStore|Params|Navigate|Location|SearchParams|Navigation|PageMeta|SetPageTitle|RequireAuth|Auth|Toast|Theme|Form|Debounce|Interval|Media|QueryClient|Editor|Mutation)$/;

  const iniciaLeitura = (fonte: string) => {
    if (/cloudFetch\w*\(|engineFetch\(|\bfetch\(|\buseQuery\(/.test(fonte)) return true;
    for (const m of fonte.matchAll(/\b(use[A-Z]\w*)\s*\(/g)) {
      if (!HOOKS_QUE_NAO_LEEM.test(m[1])) return true;
    }
    return false;
  };

  function paginasSemConsultaDeErro(): string[] {
    const sem: string[] = [];
    for (const f of paginas()) {
      const fonte = readFileSync(f, 'utf-8');
      if (!afirmaAusencia(fonte)) continue;
      if (!iniciaLeitura(fonte)) continue; // B-243 — nada a consultar; ver `iniciaLeitura`
      if (!consultaErro(fonte)) sem.push(relative(SRC, f));
    }
    return sem;
  }

  it('nenhuma tela NOVA afirma ausência sem consultar um sinal de erro', () => {
    const sem = paginasSemConsultaDeErro();

    expect(
      sem.length,
      `\nTelas que afirmam ausência sem consultar erro: ${String(sem.length)} (teto ${String(TETO_SEM_ERRO)}).\n\n` +
        `${sem.map((p) => `  ${p}`).join('\n')}\n\n` +
        'Se SUBIU: uma tela nova afirma que não há nada quando o que houve foi não conseguir ler.\n' +
        'As duas coisas pedem ações diferentes de quem está olhando. Use\n' +
        '`estadoDaLista({ erro, vazio }, recurso)` ou a prop `error=` do PageShell.\n\n' +
        'Se DESCEU: é progresso, e o teto acima deve acompanhar.\n',
    ).toBeLessThanOrEqual(TETO_SEM_ERRO);
  });

  it('o teto bate com o disco — sem folga onde crescer', () => {
    expect(paginasSemConsultaDeErro().length).toBe(TETO_SEM_ERRO);
  });

  it('o guarda ainda encontra páginas com `empty=` — um zero silencioso não passa por cobertura', () => {
    const comEmpty = paginas().filter((f) => /\bempty=\{/.test(readFileSync(f, 'utf-8')));
    expect(comEmpty.length).toBeGreaterThanOrEqual(5);
  });

  it('DETECTA uma página que monta `empty=` sem consultar erro', () => {
    // B-237 — este auto-teste declarava uma cópia da regra (`const consulta = …`) e verificava a
    // cópia. Agora chama OS MESMOS predicados que o guarda usa: se um deles parar de discriminar,
    // este caso fica vermelho junto.
    const ruim = '<PageShell loading={loading} empty={{ title: "nada aqui" }} />';
    const bom = '<PageShell loading={loading} empty={estadoDaLista({ erro, vazio }, "x")} />';

    expect(afirmaAusencia(ruim)).toBe(true);
    expect(consultaErro(ruim)).toBe(false);
    expect(consultaErro(bom)).toBe(true);
  });

  it('DETECTA a forma sem `empty=` — a que tornou o guarda cego à nona tela', () => {
    // O B-167 foi marcado shipped com uma nona tela viva porque o guarda pulava qualquer arquivo
    // sem `empty={`. A afirmação de ausência por ternário inline é a forma que faltava.
    const ternario = 'return items.length === 0 ? <p>No webhooks yet</p> : <Table />;';
    expect(afirmaAusencia(ternario)).toBe(true);
    expect(consultaErro(ternario)).toBe(false);
  });

  it('B-243 — reconhece as formas que telas conformes usavam e o guarda não via', () => {
    // Uma asserção POR FORMA: se uma delas parar de casar, este caso diz qual.
    // Sem isto, alargar o vocabulário seria indistinguível de afrouxar a catraca.
    expect(consultaErro('<p role="alert">Could not read service status.</p>')).toBe(true);
    expect(consultaErro('if (ilegivel) { return <Alert />; }')).toBe(true);
    expect(consultaErro('{dependentesIlegiveis ? <Alert /> : null}')).toBe(true);
    expect(consultaErro("if (u.estado === 'nao-lido') return null;")).toBe(true);
  });

  it('B-243 — o vocabulário novo NÃO transforma qualquer prosa em consulta de erro', () => {
    // A primeira versão deste caso usava espantalhos — "Read the docs", `const legible` —
    // que não contêm NENHUMA das frases adicionadas. Ele passava sem exercitar o alargamento,
    // e a revisão apontou: um teste que anuncia uma garantia que não dá é pior que um teste
    // redundante. Estes espantalhos contêm quase a frase, e têm de continuar não casando.
    expect(consultaErro('<p>Could not reduce the list to a single row.</p>')).toBe(false);
    expect(consultaErro('const ilegal = true;')).toBe(false);
    expect(consultaErro("const status = 'nao-lidos-ainda';")).toBe(false);
  });

  it('B-241 — uma MUTAÇÃO não é leitura: quem só escreve não tem erro de leitura a consultar', () => {
    // 2026-08-13. A migração de identificadores renomeou `erroDescricao` para `descriptionError`
    // em `promptly/create.tsx` e o guarda acusou a página. A primeira correção que escrevi foi
    // alargar `consultaErro` com `\b[a-z]\w*Error\b` — e a revisão mediu que aquilo isentava 93
    // arquivos de uma vez, entre eles `throwOnError` (uma OPÇÃO de fetch), `onError` (callback de
    // mutação) e `formatDeployError` (nome de função). Baixar o número alargando o vocabulário do
    // guarda é precisamente o que o B-238 registrou neste arquivo.
    //
    // O predicado errado era o outro. `create.tsx` afirma ausência sobre `declaradas.length === 0`
    // — uma conta LOCAL sobre o texto digitado, sem leitura nenhuma — e entrava na população por
    // causa de `useMutation(`. Uma mutação é escrita: não existe leitura falha para ela consultar.
    //
    // As duas metades, e a segunda é o que faltava no alargamento revertido:
    const soMutacao =
      'const criar = useMutation({ mutationFn: postar });\n' +
      'return vars.length === 0 ? <p>No variables in the text</p> : <List />;';
    expect(afirmaAusencia(soMutacao)).toBe(true);
    expect(iniciaLeitura(soMutacao), 'uma mutação foi contada como leitura').toBe(false);

    // …e a página que LÊ de verdade continua na população, senão isto seria afrouxar.
    const leEAfirma =
      "const q = useQuery({ queryKey: ['x'] });\n" +
      'return q.data.length === 0 ? <p>No items yet</p> : <List />;';
    expect(afirmaAusencia(leEAfirma)).toBe(true);
    expect(iniciaLeitura(leEAfirma)).toBe(true);
    expect(consultaErro(leEAfirma), 'esta tela é culpada e tem de continuar sendo').toBe(false);
  });

  it('B-241 — o vocabulário do guarda NÃO foi alargado: um nome que termina em `Error` não isenta', () => {
    // O contra-teste do alargamento revertido. Cada uma destas linhas contém um identificador
    // terminado em `Error` e NENHUMA delas é a consulta de uma leitura que falhou. Se alguém
    // reintroduzir `\b[a-z]\w*Error\b` em `consultaErro`, este caso fica vermelho.
    expect(consultaErro('cloudFetch(url, {}, { throwOnError: true });')).toBe(false);
    expect(consultaErro('useMutation({ mutationFn: f, onError: toast });')).toBe(false);
    expect(consultaErro('const copy = formatDeployError(step);')).toBe(false);
    expect(consultaErro('{validacao.nameError !== null ? <FormField.Error /> : null}')).toBe(false);
  });

  it('B-243 — LIMITE DECLARADO: a frase em PROSA excusa o arquivo, e isso é sabido', () => {
    // O guarda é textual. Um arquivo que afirme ausência, faça leitura, não consulte erro
    // nenhum e mencione "Could not read" num COMENTÁRIO passa — a revisão construiu esse
    // arquivo e ele passou.
    //
    // Não é um descuido escondido: é o mesmo limite que a checagem por ARQUIVO já tem, e
    // fechá-lo pede analisar em que contexto sintático a frase aparece. Fica DECLARADO e com
    // teste, para que quem o encontrar saiba que foi visto, e não que ninguém olhou.
    const soEmComentario =
      "// Docs: if the manifest is malformed the CLI prints \"Could not read manifest\".\n" +
      "const q = useQuery({ queryKey: ['x'] });\n" +
      "return <PageShell empty={{ title: 'No items yet' }} />;";

    expect(afirmaAusencia(soEmComentario)).toBe(true);
    expect(iniciaLeitura(soEmComentario)).toBe(true);
    expect(consultaErro(soEmComentario)).toBe(true); // <- o falso negativo, provado
  });

  it('B-243 — `iniciaLeitura` reconhece hook de DOMÍNIO, não só sete grafias literais', () => {
    // O buraco que a revisão mediu: `useProjects()`, `useApiKeys()`, `useTrustViolations()`
    // são leituras, e a primeira versão do predicado dizia que não. Trinta e uma de 59
    // páginas ficavam fora da checagem — incluindo cinco de onde o revisor removeu TODO o
    // tratamento de erro sem que a catraca piscasse.
    expect(iniciaLeitura('const { projects } = useProjects();')).toBe(true);
    expect(iniciaLeitura('const keys = useApiKeys();')).toBe(true);
    expect(iniciaLeitura('const v = useTrustViolations({ limit: 20 });')).toBe(true);
    expect(iniciaLeitura('const s = useServiceVersions();')).toBe(true);

    // E os hooks de UI continuam não sendo leitura.
    expect(iniciaLeitura('const [x, setX] = useState(0);')).toBe(false);
    expect(iniciaLeitura('useEffect(() => { setOpen(true); }, []);')).toBe(false);
    expect(iniciaLeitura('const editor = useEditor({ extensions: [] });')).toBe(false);
    expect(iniciaLeitura('const { name } = useParams();')).toBe(false);
  });

  it('B-243 — `iniciaLeitura` separa quem FAZ a leitura de quem recebe a lista', () => {
    expect(iniciaLeitura('const q = useQuery({ queryKey: [] });')).toBe(true);
    expect(iniciaLeitura('const s = useSessionsQuery();')).toBe(true);
    expect(iniciaLeitura("cloudFetch('/v1/x')")).toBe(true);

    // Componente apresentacional: a lista chega por prop, e não há requisição para falhar.
    expect(iniciaLeitura('function Tab({ variaveis }: { variaveis: string[] }) { return null; }')).toBe(
      false,
    );
    // Estado local: o menu de slash do editor é filtrado no cliente.
    expect(iniciaLeitura('const [slash, setSlash] = useState<SlashState | null>(null);')).toBe(false);
    // `useEffect`/`useCallback` são hooks, mas não leituras — a distinção que importa aqui.
    expect(iniciaLeitura('useEffect(() => { setOpen(true); }, []);')).toBe(false);
  });

  it('e NÃO acusa uma tela que consulta o erro por `isError`', () => {
    const comIsError = '<PageShell empty={{ title: "x" }} />\nif (query.isError) return <Alert />;';
    expect(afirmaAusencia(comIsError)).toBe(true);
    expect(consultaErro(comIsError)).toBe(true);
  });
});
