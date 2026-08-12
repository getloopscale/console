import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RAIZ = resolve(__dirname, '../..');
const NGINX = readFileSync(resolve(RAIZ, 'nginx.conf'), 'utf8');
const SNIPPET = 'security-headers.conf';

/**
 * B-100 — a política de cache do nginx, e a armadilha de herança que ela cria.
 *
 * ## O que faltava
 *
 * `nginx.conf` não emitia header de cache NENHUM: sem `expires`, sem
 * `Cache-Control`, sem `immutable`. A única coisa que o servidor mandava era
 * `ETag`/`Last-Modified`, então cada asset com hash no nome pagava uma
 * revalidação condicional por carregamento.
 *
 * Isso foi medido ao responder B-074, e desmentiu uma premissa do `ADR-0004`:
 * ele apresentava a opção de remover o service worker inteiro com o argumento de
 * que *"o `nginx.conf` versionado já emite os headers de cache de assets"*. Não
 * emitia — e enquanto não emitisse, remover o SW pioraria a entrega.
 *
 * ## As duas armadilhas que este teste existe para travar
 *
 * **1. `sw.js` não pode ser imutável.** Os assets do Vite têm hash no nome
 * (`agents-Cawqk4NE.js`), então um ano de cache é seguro: build novo, nome novo.
 * `sw.js` e `__config.js` NÃO têm. Um `location ~ \.js$` com `immutable`
 * congelaria o service worker e o app nunca mais receberia atualização — uma
 * falha que só aparece no deploy SEGUINTE, quando já não é óbvio o que a causou.
 *
 * **2. `add_header` num `location` DESCARTA os do `server`.** É a regra de
 * herança do nginx: as diretivas do nível anterior valem *se e somente se* o
 * nível atual não declarar nenhuma. Pôr `Cache-Control` dentro de `/assets/`
 * derrubaria, em silêncio, o CSP e o `X-Frame-Options` — exatamente nos arquivos
 * JavaScript, que é onde eles mais importam.
 *
 * Por isso os headers de segurança viraram um SNIPPET incluído em cada
 * `location` que declara header próprio. Repetir o CSP em três lugares também
 * funcionaria hoje e divergiria depois; estrutura que impede o erro vale mais
 * que teste que o detecta — e o terceiro caso abaixo trava o que sobra.
 */

/** Cada bloco `location`, com o corpo dele. */
function locations(): { seletor: string; corpo: string }[] {
  const out: { seletor: string; corpo: string }[] = [];
  const re = /location\s+([^{]+?)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(NGINX)) !== null) {
    // Fecha no `}` equilibrado a partir da abertura.
    let nivel = 1;
    let i = re.lastIndex;
    while (i < NGINX.length && nivel > 0) {
      if (NGINX[i] === '{') nivel++;
      else if (NGINX[i] === '}') nivel--;
      i++;
    }
    out.push({ seletor: m[1].trim(), corpo: NGINX.slice(re.lastIndex, i - 1) });
  }
  return out;
}

function blocoDe(seletorParcial: string): string {
  const b = locations().find((l) => l.seletor.includes(seletorParcial));
  if (!b) throw new Error(`location contendo "${seletorParcial}" não existe em nginx.conf`);
  return b.corpo;
}

describe('política de cache do nginx (B-100)', () => {
  it('assets com hash no nome são imutáveis por um ano', () => {
    const bloco = blocoDe('/assets/');
    expect(
      bloco,
      'O bloco de `/assets/` não declara cache longo.\n\n' +
        'O Vite emite nome com hash de conteúdo, então build novo produz nome novo\n' +
        'e uma entrada velha JAMAIS é servida no lugar de uma nova. É a condição\n' +
        'que torna `immutable` seguro — e sem ele cada asset paga uma revalidação\n' +
        'condicional por carregamento.\n',
    ).toMatch(/max-age=31536000/);
    expect(bloco, 'falta `immutable` — sem ele o navegador revalida a cada F5').toMatch(
      /immutable/,
    );
  });

  it('o service worker e a config de runtime NUNCA recebem cache longo', () => {
    // A armadilha nº 1. `sw.js` sem hash no nome + cache longo = app congelado
    // na versão do dia em que a regra entrou, e o sintoma aparece só no deploy
    // seguinte.
    for (const alvo of ['/sw.js', '/__config.js']) {
      const bloco = blocoDe(alvo);
      expect(bloco, `${alvo} não declara Cache-Control`).toMatch(/Cache-Control/);
      expect(
        bloco,
        `${alvo} recebeu cache longo. Ele NÃO tem hash no nome: congelá-lo\n` +
          'impede o app de atualizar, e o efeito só aparece no deploy seguinte.\n',
      ).not.toMatch(/max-age=(?!0)\d{3,}/);
    }
  });

  it('todo location que declara header próprio TAMBÉM inclui os de segurança', () => {
    // A armadilha nº 2, e a razão de este caso existir: no nginx, `add_header`
    // num nível descarta os do nível anterior. Um `Cache-Control` acrescentado
    // sem o include derruba o CSP naquele caminho, sem erro e sem aviso.
    const ofensores = locations()
      .filter((l) => /add_header/.test(l.corpo))
      .filter((l) => !l.corpo.includes(SNIPPET))
      .map((l) => `location ${l.seletor}`);

    expect(
      ofensores,
      'Location com `add_header` próprio e SEM os headers de segurança.\n\n' +
        'No nginx as diretivas `add_header` do nível anterior valem se e somente\n' +
        'se o nível atual não declarar nenhuma. Este bloco declara — então o CSP,\n' +
        'o `X-Frame-Options` e o `X-Content-Type-Options` do `server` NÃO chegam\n' +
        'nas respostas dele.\n\n' +
        'O CSP é a mitigação primária de XSS deste dashboard (find_infra_012), e\n' +
        'perdê-lo num caminho que serve JavaScript é o pior lugar possível.\n\n' +
        `Acrescente \`include .../${SNIPPET};\` ao bloco.\n`,
    ).toEqual([]);
  });

  it('`Cache-Control` NÃO usa `always`, e os de segurança usam', () => {
    // A distinção é o oposto uma da outra, e as duas importam.
    //
    // `always` faz o nginx emitir o header também em 4xx/5xx. Para os headers de
    // segurança isso é o que se quer: uma página de erro é exatamente onde
    // conteúdo do atacante pode ser refletido.
    //
    // Para o `Cache-Control` é o contrário. Com `always`, um 404 de asset sairia
    // com `max-age=31536000, immutable` — e num deploy rolling o cliente carrega
    // o `index.html` novo de um pod, pede o asset a outro que ainda não o tem,
    // recebe 404 e o guarda POR UM ANO. É o modo de falha clássico de asset com
    // hash, e ele foi introduzido e removido durante a própria implementação
    // desta política, verificado com `curl` contra o container.
    for (const l of locations().filter((x) => /add_header\s+Cache-Control/.test(x.corpo))) {
      const linha = l.corpo.match(/add_header\s+Cache-Control[^;]*;/)![0];
      expect(
        linha,
        `location ${l.seletor}: \`Cache-Control\` com \`always\`.\n\n` +
          'Isso faz o header valer em 4xx também, e um 404 de asset passa a ser\n' +
          'cacheado. Tire o `always` — o nginx então só emite em 2xx/3xx.\n',
      ).not.toMatch(/always/);
    }

    const snippet = readFileSync(resolve(RAIZ, 'nginx-security-headers.conf'), 'utf8');
    // Até o FIM DA LINHA, e não até o primeiro `;`: o valor do CSP contém
    // ponto-e-vírgula (`default-src 'self'; script-src 'self'; …`), então parar
    // no primeiro cortaria a diretiva antes do `always` e acusaria um header
    // correto. Foi o que aconteceu na primeira versão deste caso.
    const semAlways = [...snippet.matchAll(/^\s*add_header\s+([\w-]+).*$/gm)]
      .filter((m) => !m[0].includes('always'))
      .map((m) => m[1]);
    expect(
      semAlways,
      'Header de segurança sem `always` — ele some justamente nas respostas de erro.\n',
    ).toEqual([]);
  });

  it('o snippet de segurança carrega mesmo o CSP — não é um arquivo vazio', () => {
    // Sem este caso, um snippet vazio (ou um include para um caminho que não
    // existe) passaria nos três acima: eles verificam que o include ESTÁ ALI,
    // não que ele traz alguma coisa. É a mesma armadilha do `dist` vazio.
    const snippet = readFileSync(resolve(RAIZ, 'nginx-security-headers.conf'), 'utf8');
    expect(snippet).toMatch(/Content-Security-Policy/);
    expect(snippet).toMatch(/X-Frame-Options/);
    expect(snippet).toMatch(/X-Content-Type-Options/);

  });
});
