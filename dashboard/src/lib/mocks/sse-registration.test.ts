// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Todo caminho SSE que a aplicação CONSOME tem um registro em modo mock (B-178).
 *
 * ## O defeito
 *
 * `handlers.ts` registra quatro caminhos. `use-deployments-list-stream.ts` consome
 * `/projects/{name}/builds/stream` e `use-status-stream.ts` consome
 * `/projects/{name}/signals/stream`, e nenhum dos dois está registrado.
 *
 * O item dizia que eles "reconectam para sempre". Isso deixou de ser verdade e a correção importa:
 * o ramo não-registrado de `mocks/sse.ts` dispara um `Event('error')` sem `reason`, que cai no
 * default `network-error` — e até B-173 esse caminho RETORNAVA sem agendar reabertura. O stream
 * morria em silêncio depois de uma falha, em vez de girar. Mesmo desfecho para quem olha a tela,
 * mecanismo oposto, e a jusante de outro item.
 *
 * ## Por que um guarda e não dois registros
 *
 * Acrescentar as duas entradas à mão conserta os dois caminhos medidos e deixa o terceiro nascer
 * do mesmo jeito — que é como estes dois nasceram. O guarda compara o que se consome com o que se
 * registra, então o próximo caminho não-registrado reprova no commit que o introduz.
 *
 * ## Limite honesto
 *
 * O extrator é uma regex sobre o código-fonte dos hooks. Ele encontra os caminhos escritos como
 * template literal com o prefixo `/api/v1/`, que é a forma que os cinco consumidores usam hoje.
 * Um caminho montado de outro jeito escapa — por isso o guarda também RELATA quantos encontrou, e
 * um número que despenca é um sinal de que o extrator parou de enxergar, não de que o problema
 * sumiu.
 */

const RAIZ = resolve(__dirname, '../../..');
const SRC = join(RAIZ, 'src');

function arquivos(dir: string): string[] {
  const achados: string[] = [];
  const pilha = [dir];
  while (pilha.length > 0) {
    const atual = pilha.pop();
    if (atual === undefined) break;
    for (const nome of readdirSync(atual)) {
      const caminho = join(atual, nome);
      if (statSync(caminho).isDirectory()) pilha.push(caminho);
      else if (/\.tsx?$/.test(nome) && !/\.test\./.test(nome)) achados.push(caminho);
    }
  }
  return achados;
}

/**
 * Normaliza um caminho consumido para a forma que os registros usam.
 *
 * Os consumidores escrevem `/engine/api/v1/...` — o `/engine` e o prefixo que `engineFetch`
 * adiciona e que o registro do mock nao carrega — interpolam com `${encodeURIComponent(x)}` e
 * podem levar query string. Os tres somem aqui, porque nenhum deles distingue um caminho de outro.
 */
function normalizar(caminho: string): string {
  return caminho
    .replace(/^\/engine/, '')
    .replace(/\$\{[^}]*\}/g, '{}')
    .replace(/\?.*$/, '');
}

function caminhosConsumidos(): string[] {
  const encontrados = new Set<string>();
  for (const f of arquivos(join(SRC, 'hooks'))) {
    const fonte = readFileSync(f, 'utf-8');
    // Só as linhas que de fato montam um endereço de stream: o sufixo é o que distingue um
    // caminho de stream de qualquer outra URL da API.
    for (const m of fonte.matchAll(/`((?:\/engine)?\/api\/v1\/[^`]*?(?:\/stream|\/timeline)(?:\?[^`]*)?)`/g)) {
      encontrados.add(normalizar(m[1]));
    }
  }
  return [...encontrados].sort();
}

/**
 * Varre TODO o diretório de mocks, e não `handlers.ts` só.
 *
 * As registrações moraram lá até serem extraídas para `stream-handlers.ts`; um guarda apontado
 * para um arquivo teria passado verde no dia da mudança, tendo lido zero registros — e o próprio
 * caso de cobertura abaixo é o que impede isso de acontecer em silêncio.
 */
function caminhosRegistrados(): string[] {
  const registros = new Set<string>();
  for (const f of arquivos(join(SRC, 'lib/mocks'))) {
    for (const m of readFileSync(f, 'utf-8').matchAll(/registerSSE\('([^']+)'/g)) {
      registros.add(m[1].replace(/\{[^}]*\}/g, '{}'));
    }
  }
  return [...registros].sort();
}

describe('B-178 — todo stream consumido tem resposta em modo mock', () => {
  it('nenhum caminho SSE é consumido sem registro', () => {
    const consumidos = caminhosConsumidos();
    const registrados = new Set(caminhosRegistrados());
    const semRegistro = consumidos.filter((c) => !registrados.has(c));

    expect(
      semRegistro,
      `\nCaminho(s) SSE consumidos e NÃO registrados em \`lib/mocks/handlers.ts\`:\n\n` +
        `${semRegistro.map((c) => `  ${c}`).join('\n')}\n\n` +
        'Em modo mock esse stream não recebe resposta: o ramo não-registrado dispara um erro sem\n' +
        'motivo, que vira `network-error`. A tela fica sem eventos e nada diz por quê — é o\n' +
        'ambiente onde as telas são validadas afirmando ausência que não mediu.\n\n' +
        `Conferidos: ${String(consumidos.length)} caminho(s) consumido(s), ` +
        `${String(registrados.size)} registrado(s).\n`,
    ).toEqual([]);
  });

  it('o extrator ainda enxerga os caminhos — um zero silencioso não passa por cobertura', () => {
    // Se a forma de montar um endereço de stream mudar, a regex para de casar e o caso acima
    // passaria verde tendo conferido nada.
    expect(caminhosConsumidos().length).toBeGreaterThanOrEqual(4);
    expect(caminhosRegistrados().length).toBeGreaterThanOrEqual(4);
  });

  // B-237 — a catraca era a única deste ciclo sem AUTO-TESTE. Os dois casos acima verificam o
  // resultado do extrator contra o disco; nenhum verificava que o extrator DISCRIMINA. Um regex
  // que casasse tudo, ou nada, produziria o mesmo verde: `semRegistro` vazio.

  it('o extrator reconhece um caminho de stream e IGNORA uma URL comum', () => {
    const casar = (fonte: string) =>
      [...fonte.matchAll(/`((?:\/engine)?\/api\/v1\/[^`]*?(?:\/stream|\/timeline)(?:\?[^`]*)?)`/g)].map(
        (m) => m[1],
      );

    // A forma que importa: o sufixo `/stream` ou `/timeline` é o que distingue um endereço de
    // stream de qualquer outra chamada da API.
    expect(casar('const u = `/api/v1/deployments/${id}/stream`;')).toEqual(['/api/v1/deployments/${id}/stream']);
    expect(casar('const u = `/engine/api/v1/builds/${id}/timeline?since=1`;')).toHaveLength(1);

    // E o que ele NÃO pode capturar: uma chamada REST comum não é um stream, e tratá-la como tal
    // encheria a lista de "não registrados" com caminhos que nunca precisaram de registro.
    expect(casar('const u = `/api/v1/projects/${id}`;')).toEqual([]);
    expect(casar("const u = '/api/v1/deployments/x/stream';")).toEqual([]);
  });

  it('e um caminho consumido sem registro APARECE na diferença', () => {
    // O auto-teste do predicado do caso principal: a subtração precisa poder produzir item.
    const consumidos = ['/api/v1/a/stream', '/api/v1/b/stream'];
    const registrados = new Set(['/api/v1/a/stream']);
    expect(consumidos.filter((c) => !registrados.has(c))).toEqual(['/api/v1/b/stream']);
  });
});
