import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Encontra texto de INTERFACE em português no código de produção.
 *
 * ## Por que árvore sintática e não `grep`
 *
 * Este repositório **comenta em português por convenção** — os comentários longos que
 * explicam decisões são metade do valor de vários arquivos. Um guard que casasse acento no
 * texto do arquivo acusaria cada um deles, e um guard que acusa o que não é defeito é
 * desligado na primeira semana. Um guard desligado é pior que nenhum: ele dá a impressão de
 * cobertura.
 *
 * Então a leitura é sintática. Só entram nós que chegam ao usuário:
 *
 *   - `JsxText` — o texto entre tags
 *   - todo literal de string e todo pedaço literal de template, EM QUALQUER POSIÇÃO
 *
 * E exclui o que comprovadamente não é interface: comentário, especificador de import/export,
 * chave de objeto, `className`, `data-testid`, **posição de tipo**, **operando de comparação**
 * e **identificador interno**.
 *
 * ## Identificador interno não é interface — e a distinção precisa ser mecânica
 *
 * Este código usa discriminantes em português: `estado: 'carregando'`, `tom: 'sucesso'`,
 * `type ModoDeTexto = 'escrito' | 'resolvido'`. São NOMES, e nomes em português são uma
 * convenção deste repositório — a mesma dos comentários. Exigir que virem inglês seria pedir
 * um refactor que nenhum dos três itens pede, e que o usuário não vê.
 *
 * A regra mecânica: **rótulo de interface tem espaço ou começa com maiúscula.** `'Promover'` é
 * botão; `'carregando'` é estado. Limite conhecido: uma palavra minúscula e solta que É exibida
 * — `'nenhum'` como valor de célula — escapa. É o preço de não forçar o refactor errado, e
 * está aqui escrito em vez de descoberto depois.
 *
 * ## Por que "qualquer posição" e não uma lista de lugares
 *
 * A primeira versão listava os lugares onde texto de interface costuma morar — atributo de
 * nome visível, propriedade chamada `title`/`label`/… — e **reportou zero com português ainda
 * na tela**. Três buracos, todos reais, achados ao cruzar o resultado do guard com os
 * localizadores dos testes:
 *
 *   `revision-columns.tsx:177`  aria-label={`Promover ${p.label} …`}   template COM substituição
 *   `projections.ts:276`        texto: 'Nenhuma regra governa …'       propriedade fora da lista
 *   `revision-columns.tsx:166`  label: 'Promover'                      palavra PT SEM acento
 *
 * E um TERCEIRO, achado depois, pelo mesmo cruzamento: `create.tsx:135` rotulava um campo
 * `Texto do prompt` e o guard passava — nem acento, nem palavra na lista. A lição não é
 * "faltou uma palavra": é que um marcador por lista de palavras tem cauda, e a cauda só
 * aparece quando alguém cruza o resultado com outra fonte. Os testes foram essa fonte duas
 * vezes; por isso o guard não é a única rede, e a varredura de tela em navegador continua
 * valendo.
 *
 * Um guard que reporta zero enquanto o defeito existe é pior que nenhum: ele encerra a
 * investigação. A lista de lugares era uma aposta sobre onde o texto estaria, e apostas erram.
 * Marcar por CONTEÚDO e excluir o que não é interface inverte o ônus — o falso negativo exige
 * que a string não tenha marcador, não que ela esteja num lugar que eu não previ.
 *
 * ## Limite conhecido, declarado em vez de escondido
 *
 * String montada em runtime (`` `${n} revisões` ``) só é vista se o pedaço literal contiver
 * marcador — aqui, `revisões` contém. Já `` `${n} itens` `` passaria. A varredura de tela em
 * navegador é a rede complementar para esses casos, e ela não cabe num teste de unidade.
 *
 * ## Por que este arquivo existe
 *
 * O commit `05132088` migrou o domínio Skills de português para inglês e **não deixou guard**.
 * Três meses depois, o mesmo domínio tinha 4 strings novas em português e o repositório
 * inteiro tinha 203. Limpar sem impedir que suje é limpar de novo depois.
 */

/**
 * Marcadores INEQUÍVOCOS: acento, ou palavra que não existe em inglês.
 *
 * EXPORTADO desde 2026-08-12 (B-241) porque esta lista já é a decisão que faltava. Ao medir os
 * identificadores em português eu produzi 314 e depois 329, ambos inflados — o primeiro casava
 * `error` contra o prefixo "erro", e o segundo casava COGNATOS: `total`, `item`, `texto`, `atual`
 * são palavra válida nas duas línguas ou diferem por uma letra. Uma lista de palavras não separa
 * as duas línguas sem alguém decidir cognato a cognato.
 *
 * Esta lista já decidiu. Ela contém `nome`, `chave`, `linha`, `janela`, `busca` — nenhuma das
 * quais é inglês — e NÃO contém `total`, `item`, `atual`. Reusá-la em vez de escrever uma segunda
 * é o degrau 4 da parsimony ladder, e evita o defeito óbvio de duas listas divergindo.
 *
 * NÃO exportado: cheguei a exportá-lo para que o docblock acima fosse legível de fora, e o knip
 * apontou que ninguém importava. Documentar não é motivo para alargar superfície — quem precisa da
 * decisão lê daqui, e `ehIdentificadorPT` é a porta.
 */
const MARCADOR =
  /[áàâãéêíóôõúüç]|\b(nao|sao|nenhum|nenhuma|voce|apenas|todos|todas|criar|excluir|salvar|adicionar|voltar|carregando|falhou|sucesso|nova|novo|agora|aqui|ainda|revisao|revisoes|ambiente|ambientes|pagina|paginas|usuario|usuarios|configuracao|configuracoes|promover|promocao|reverter|comparar|afinacao|conteudo|descricao|servico|politica|avaliacao|execucao|proximo|proxima|anterior|seguinte|escrito|escrita|servindo|nome|nomes|texto|textos|campo|campos|valor|valores|chave|chaves|arquivo|arquivos|pasta|pastas|linha|linhas|senha|senhas|mensagem|mensagens|janela|prazo|limite|dia|dias|hoje|ontem|semana|semanas|mes|meses|ano|anos|uso|custo|busca|inicio|fim|para|que|uma|ao|aos|pelo|pela|seu|sua|este|esta|esse|essa|isso|isto|onde|quando|porque|entre|sobre|sem|foi|tem|pode|deve|fica|vem|vai|muito|ali|antes|depois|sempre|nunca|termos|bloquear|bloqueado|bloqueada|bloqueados|reescrito|reescrita|liberado|liberada|desconhecido|desconhecida|exemplo|testar|remover|editar|abrir|fechar|enviar|buscar|filtrar|ordenar|copiar|colar|produto|entrar|sair|revisar|escolha|diga|conversa|conversas|rodar|rodando|resolvido|resolvida|catalogo|producao|consumo|recorte|decisao|acao|acoes)\b/i;

export interface AchadoI18n {
  readonly arquivo: string;
  readonly linha: number;
  readonly trecho: string;
}

/**
 * EXPORTED since 2026-08-13 (B-241) so the guard can assert a floor on its own corpus.
 *
 * Review blinded this traversal and the guard stayed green while scanning 4 files instead of 492 —
 * a guard that cannot tell "clean" from "stopped looking" is a number. The floor lives in
 * `identifier-language-ratchet.test.ts`, which is the only consumer.
 */
export function arquivosDeProducao(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    // `src/test/` é o ARNÊS da suíte — helpers, setup, o detector de árvore instável. As
    // mensagens de lá vão para o console de quem desenvolve, não para a tela de quem usa o
    // produto, e os três itens falam do produto. Mesma categoria de `*.test.ts`.
    if (entrada === 'node_modules' || entrada === 'vendor' || entrada === 'test') continue;
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) arquivosDeProducao(caminho, out);
    else if (/\.tsx?$/.test(entrada) && !/\.(test|spec)\.tsx?$/.test(entrada)) out.push(caminho);
  }
  return out;
}

/** Varre um diretório e devolve todo texto de interface que casa um marcador de português. */
export function varrerInterface(raiz: string): AchadoI18n[] {
  const achados: AchadoI18n[] = [];

  for (const arquivo of arquivosDeProducao(raiz)) {
    const fonte = readFileSync(arquivo, 'utf8');
    const sf = ts.createSourceFile(
      arquivo,
      fonte,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      arquivo.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const registrar = (no: ts.Node, texto: string) => {
      const limpo = texto.trim().replace(/\s+/g, ' ');
      if (limpo.length <= 2 || !MARCADOR.test(limpo)) return;
      // Identificador interno: uma palavra só, minúscula. Ver o docblock.
      if (!/\s/.test(limpo) && !/^[A-ZÀ-Ú]/.test(limpo)) return;
      const { line } = sf.getLineAndCharacterOfPosition(no.getStart(sf));
      achados.push({
        arquivo: relative(raiz, arquivo).replace(/\\/g, '/'),
        linha: line + 1,
        trecho: limpo.slice(0, 72),
      });
    };

    /** Posições que comprovadamente não chegam ao usuário. */
    const naoEInterface = (no: ts.Node): boolean => {
      const pai = no.parent;
      if (!pai) return false;
      // especificador de módulo: `from './x'`
      if (ts.isImportDeclaration(pai) || ts.isExportDeclaration(pai)) return true;
      // chave de objeto, não valor
      if (ts.isPropertyAssignment(pai) && pai.name === no) return true;
      // atributos de estilo e de gancho de teste
      if (ts.isJsxAttribute(pai)) {
        const nome = pai.name.getText();
        if (nome === 'className' || nome === 'data-testid' || nome === 'key' || nome === 'id') return true;
      }
      // posição de TIPO: `type X = 'escrito' | 'resolvido'`
      if (ts.isLiteralTypeNode(pai)) return true;
      // operando de comparação: `if (modo === 'escrito')`
      if (
        ts.isBinaryExpression(pai) &&
        (pai.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          pai.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
      ) {
        return true;
      }
      return false;
    };

    const visitar = (no: ts.Node): void => {
      if (ts.isJsxText(no)) registrar(no, no.text);

      if (
        (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) &&
        !naoEInterface(no)
      ) {
        registrar(no, no.text);
      }

      // Template COM substituição: cada pedaço literal é texto de interface por si.
      if (ts.isTemplateExpression(no)) {
        if (no.head.text.trim()) registrar(no, no.head.text);
        for (const span of no.templateSpans) {
          if (span.literal.text.trim()) registrar(span.literal, span.literal.text);
        }
      }

      ts.forEachChild(no, visitar);
    };

    visitar(sf);
  }

  return achados;
}

/** Um identificador em forma portuguesa, e onde ele é declarado. */
export interface IdentificadorPT {
  readonly arquivo: string;
  readonly linha: number;
  readonly nome: string;
  /** `true` quando é declarado e usado num arquivo só — o lote seguro para renomear primeiro. */
  readonly local: boolean;
}

/** Quebra `nomeDoCampo` / `nome_do_campo` nas suas palavras, em minúsculas. */
function palavras(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .map((p) => p.toLowerCase())
    .filter(Boolean);
}

const SUPLEMENTO_IDENTIFICADORES = new Set([
  // Palavras que são inequívocas num IDENTIFICADOR e que o `MARCADOR` não lista, porque ele foi
  // escrito para texto de INTERFACE e essas nunca aparecem como rótulo na tela.
  //
  // Cada uma aqui passa o mesmo teste do MARCADOR — não existe em inglês, ou difere por mais que
  // um acento. `erro` está aqui e `error` não: é essa distinção que a primeira medição perdeu ao
  // casar por prefixo, arrastando 55 arquivos de uma vez.
  //
  // NÃO entram cognatos. `total`, `item` e `atual` continuam fora, de propósito: eles são o motivo
  // de a terceira medição ter dado 329 em vez de um número utilizável.
  'erro', 'erros', 'vazio', 'vazia', 'achado', 'achados', 'catraca', 'catracas',
  'seletor', 'seletores', 'ancora', 'ancoras', 'ancorada', 'ancoradas',
  'assercao', 'assercoes', 'medicao', 'medicoes', 'teto', 'tetos', 'piso',
  'trecho', 'trechos', 'raiz', 'alvo', 'alvos', 'origem', 'destino',
  'motivo', 'motivos', 'razao', 'razoes', 'passo', 'passos', 'ordem',
  'tamanho', 'contagem', 'nucleo', 'fonte', 'fontes', 'corpo', 'cabecalho',
  // B-279, 2026-08-13 — a cauda, medida depois que o corpo saiu.
  //
  // O zero que o guard reportava era um zero POR ESTE DETECTOR, e estas dezesseis palavras eram o
  // que ele nao via. Foram dimensionadas primeiro por `grep -rlw`, que conta ARQUIVOS QUE CITAM a
  // palavra — prosa em comentario inclusa, que a convencao permite — e deu `inteiro` 84 e
  // `mostrar` 37. Contadas como DECLARACOES, pelas mesmas regras que `varrerIdentificadores` usa,
  // sao 1 e 1. As dezesseis juntas revelam **43** declaracoes pelas regras DESTE detector.
  //
  // CORRECAO 2026-08-13, no /review: esta linha dizia 46, sem qualificar, a seis linhas de um
  // detector que reporta 43. Os dois numeros sao reais e medem coisas diferentes — 46 e do scanner
  // do `rename-identifiers.mjs`, que conta tambem `BindingElement`; 43 e do `varrerIdentificadores`,
  // que nao conta. A diferenca esta pinada em `identifier-language-ratchet.test.ts`
  // (`BINDING_ELEMENT_CEILING`). Numero sem o instrumento ao lado e numero que a proxima pessoa
  // nao consegue reproduzir.
  //
  // Cada uma passa o mesmo teste de admissao do docblock acima: nao existe em ingles, e nao e
  // cognato de uma letra. Nenhuma entra no `MARCADOR` — ele e lido tambem pelo `varrerInterface`,
  // o guard ATIVO sobre texto de tela, e alargar aquela lista apertaria os dois consumidores de
  // uma vez. Esta lista alimenta so o `ehIdentificadorPT`.
  'rotulo', 'rotulos', 'linguagem', 'variavel', 'variaveis',
  'ultima', 'ultimo', 'resolucao', 'intencao', 'normalizar',
  'bruto', 'bruta', 'vistas', 'endereco', 'mostrar', 'inteiro',
]);

/**
 * `true` quando ALGUMA palavra do identificador é inequivocamente portuguesa.
 *
 * Casa por PALAVRA, nunca por prefixo: foi casar prefixo que fez `error` (55 arquivos) entrar como
 * `erro` na primeira medição — o mesmo defeito que o próprio B-241 já registrava ter cometido
 * antes, e que eu repeti.
 */
export function ehIdentificadorPT(id: string): boolean {
  const inequivoco = new RegExp(`^(?:${MARCADOR.source})$`, 'i');
  return palavras(id).some(
    (p) => SUPLEMENTO_IDENTIFICADORES.has(p) || inequivoco.test(p) || /[áàâãéêíóôõúüç]/.test(p),
  );
}

/**
 * Varre `BindingElement` — os nomes que a desestruturação introduz — e devolve os que estão em
 * português.
 *
 * Um scanner SEPARADO, e não mais um `ts.is…` dentro do `varrerIdentificadores`, por duas razões.
 * A primeira é que aquele guard exige ZERO e este não pode: há 40 na árvore hoje, e alargar o
 * predicado deixaria o guard vermelho sem que ninguém pudesse fechá-lo no mesmo commit. A segunda
 * é que as duas populações se migram de formas diferentes — `const [erro, setErro] = useState()`
 * renomeia-se pelo compilador sem risco, enquanto `const { nome } = resposta` lê a CHAVE de uma
 * forma de fio e renomeá-la corrompe a leitura (é o `ShorthandGuard` de `rename-identifiers.mjs`,
 * e é o BLOCKER que o /review do B-241 encontrou).
 *
 * Só o nome LOCAL conta. Em `const { nome: promptName } = wire` o `nome` é a chave da resposta,
 * não é nossa, e o local já está em inglês — o TypeScript põe a chave em `propertyName` e o local
 * em `name`, então ler apenas `name` dá a resposta certa sem nenhum caso especial.
 */
export function varrerBindingElementsPT(raiz: string): IdentificadorPT[] {
  const porNome = new Map<string, Set<string>>();
  const achados: Omit<IdentificadorPT, 'local'>[] = [];

  for (const arquivo of arquivosDeProducao(raiz)) {
    const sf = ts.createSourceFile(
      arquivo,
      readFileSync(arquivo, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      arquivo.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const rel = relative(raiz, arquivo).replace(/\\/g, '/');

    const visit = (no: ts.Node): void => {
      if (ts.isBindingElement(no) && ts.isIdentifier(no.name) && ehIdentificadorPT(no.name.text)) {
        const nome = no.name.text;
        achados.push({
          arquivo: rel,
          linha: sf.getLineAndCharacterOfPosition(no.name.getStart(sf)).line + 1,
          nome,
        });
        const onde = porNome.get(nome) ?? new Set<string>();
        onde.add(rel);
        porNome.set(nome, onde);
      }
      ts.forEachChild(no, visit);
    };
    ts.forEachChild(sf, visit);
  }

  return achados.map((a) => ({ ...a, local: (porNome.get(a.nome)?.size ?? 0) === 1 }));
}

/** Varre declarações e devolve os identificadores em português, com escopo. */
export function varrerIdentificadores(raiz: string): IdentificadorPT[] {
  const porNome = new Map<string, Set<string>>();
  const achados: Omit<IdentificadorPT, 'local'>[] = [];

  for (const arquivo of arquivosDeProducao(raiz)) {
    const fonte = readFileSync(arquivo, 'utf8');
    const sf = ts.createSourceFile(
      arquivo,
      fonte,
      ts.ScriptTarget.Latest,
      true,
      arquivo.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const rel = relative(raiz, arquivo).replace(/\\/g, '/');

    const visit = (no: ts.Node): void => {
      const declara =
        ts.isVariableDeclaration(no) ||
        ts.isFunctionDeclaration(no) ||
        ts.isParameter(no) ||
        ts.isInterfaceDeclaration(no) ||
        ts.isTypeAliasDeclaration(no) ||
        ts.isPropertySignature(no) ||
        ts.isMethodDeclaration(no);
      if (declara && no.name !== undefined && ts.isIdentifier(no.name) && ehIdentificadorPT(no.name.text)) {
        const nome = no.name.text;
        achados.push({
          arquivo: rel,
          linha: sf.getLineAndCharacterOfPosition(no.name.getStart(sf)).line + 1,
          nome,
        });
        const onde = porNome.get(nome) ?? new Set<string>();
        onde.add(rel);
        porNome.set(nome, onde);
      }
      ts.forEachChild(no, visit);
    };
    ts.forEachChild(sf, visit);
  }

  return achados.map((a) => ({ ...a, local: (porNome.get(a.nome)?.size ?? 0) === 1 }));
}
