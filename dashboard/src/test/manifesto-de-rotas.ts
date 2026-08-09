import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * O texto de TODO o manifesto de rotas — `app.tsx` mais os subtrees.
 *
 * ## Por que mora em `src/test/` (B-003)
 *
 * Ele é lido apenas por guards, e `test-only-module-guard` acusou isso no
 * instante em que nasceu — corretamente: um módulo de produção cujo único
 * importador é um teste reporta cobertura verdadeira e irrelevante.
 *
 * A resposta não era isentá-lo, era admitir o que ele é. Isto é infraestrutura
 * de teste, e infraestrutura de teste mora com os testes.
 *
 * ## Por que existe
 *
 * Três guards liam `src/app.tsx` diretamente para perguntar "esta rota
 * existe?": `route-boundary`, `placeholder-honesty` e o teste de redirect de
 * `monitors`. Enquanto todas as 119 rotas moravam num arquivo, ler esse arquivo
 * ERA ler o manifesto.
 *
 * Quando sete domínios saíram para `src/routes/`, os três continuaram medindo
 * um arquivo que passou a ter um terço das rotas. Dois falharam na hora — e
 * essa é a parte boa. O terceiro é o que preocupa: um guard que pergunta "esta
 * rota está no menu e não existe?" passaria a achar rota inexistente por toda
 * parte, ou, pior, a não achar nada e ficar verde por vacuidade.
 *
 * Ler o conjunto pela PASTA, e não por uma lista de arquivos, é o que faz o
 * oitavo subtree entrar sob os mesmos guards no dia em que for criado — a mesma
 * lição que `residence-rule` aprendeu em `lib/` no dia anterior.
 */
export function arquivosDoManifestoDeRotas(): string[] {
  const dirRotas = join(SRC, 'routes');
  const subtrees = readdirSync(dirRotas)
    .filter((f) => f.endsWith('-routes.tsx'))
    .map((f) => readFileSync(join(dirRotas, f), 'utf8'));

  if (subtrees.length === 0) {
    // Nenhum subtree em disco significa ou que a decomposição foi revertida, ou
    // que a leitura falhou. Nos dois casos, seguir em silêncio faria os guards
    // medirem menos do que afirmam medir.
    throw new Error(
      'nenhum `*-routes.tsx` encontrado em src/routes/ — o manifesto de rotas não pode ser lido',
    );
  }

  return [readFileSync(join(SRC, 'app.tsx'), 'utf8'), ...subtrees];
}

/**
 * O mesmo manifesto como UM texto — para quem só pergunta "esta string aparece?".
 *
 * ## Quem faz regex com vizinhança precisa da lista, não desta string
 *
 * `placeholder-honesty` casa `path="…"` seguido de `SubPagePlaceholder` dentro
 * da MESMA rota, com um `(?!path=)` para não atravessar para a rota seguinte.
 *
 * Concatenar os arquivos quebrou essa proteção na primeira tentativa: a última
 * rota de `rag-routes.tsx` passou a "ver" a linha
 * `import { SubPagePlaceholder } …` do arquivo seguinte — um import, sem
 * nenhum `path=` no meio para interromper a busca. O guard acusou
 * `/rag/analytics` de ser um placeholder no menu sem aviso, e ele renderiza uma
 * página real.
 *
 * A fronteira entre arquivos é uma fronteira de verdade. Quem depende de
 * adjacência itera `arquivosDoManifestoDeRotas()`; quem só procura uma string
 * usa esta.
 */
export function textoDoManifestoDeRotas(): string {
  return arquivosDoManifestoDeRotas().join('\n');
}
