// M14 — a lógica do playground, fora do React.
//
// O que vive aqui decide duas coisas caras: se um botão FATURÁVEL está
// habilitado, e o que o operador lê quando a invocação falha. Dentro de um
// componente as duas só seriam alcançáveis por render; aqui rodam em
// milissegundos e sem browser, como nas cinco irmãs (`projections`, `diff`,
// `preview`, `rollback`, `create-form`).

import { ApiError } from '@/lib/api';

/** Um campo de variável na tela: o nome que a API declarou e o que foi digitado. */
export interface CampoVariavel {
  readonly nome: string;
  readonly valor: string;
}

/**
 * Por que a falha é um tipo somado e não uma string.
 *
 * O peer que serviu de referência (`langfuse`) colapsa recusa do provider e queda
 * de rede em `err.message` dentro de um toast: a área de saída volta a ficar
 * vazia, indistinguível de "ainda não rodei". Um tipo somado obriga a tela a
 * escolher uma afordância por caso — e obriga esta função a admitir quando não
 * sabe, em vez de inventar um motivo.
 */
export type Falha =
  | { readonly tipo: 'validacao'; readonly variavelFaltante?: string; readonly motivo?: string }
  | { readonly tipo: 'provider'; readonly mensagem?: string; readonly providerStatus?: number }
  | { readonly tipo: 'sessao' }
  | { readonly tipo: 'transporte' };

/**
 * Os campos da tela, derivados das variáveis que a API DECLARA (DoD-2).
 *
 * A ordem é a da declaração, não a do que já estava digitado: o operador lê o
 * prompt de cima para baixo e espera os campos na mesma sequência. O valor já
 * digitado sobrevive quando a variável sobrevive — trocar de prompt não deve
 * apagar o que ainda serve —, e a variável que sumiu é descartada, para que um
 * valor órfão não viaje no corpo da invocação.
 */
export function camposDeVariaveis(
  declaradas: readonly string[],
  atuais: readonly CampoVariavel[],
): CampoVariavel[] {
  const porNome = new Map(atuais.map((c) => [c.nome, c.valor]));
  return declaradas.map((nome) => ({ nome, valor: porNome.get(nome) ?? '' }));
}

/**
 * Se dá para rodar — a guarda pré-gasto no cliente (DoD-5).
 *
 * `trim()` porque só-espaços é vazio, e porque é o mesmo julgamento que o serviço
 * faz. Os dois lados concordando evita o pior desfecho: botão habilitado, chamada
 * saindo, serviço recusando — e o operador achando que gastou.
 *
 * Esta é a AFORDÂNCIA; o contrato é do servidor, que revalida. Não é duplicação
 * de conhecimento: um desabilita um botão, o outro recusa uma requisição que pode
 * chegar sem passar por botão nenhum.
 */
export function podeRodar(campos: readonly CampoVariavel[], credencial: string): boolean {
  if (credencial.trim() === '') return false;
  return campos.every((c) => c.valor.trim() !== '');
}

/** Extrai `{error, message, variable, providerStatus, reason}` de um corpo desconhecido. */
function corpoDe(erro: ApiError): Record<string, unknown> {
  return typeof erro.body === 'object' && erro.body !== null
    ? (erro.body as Record<string, unknown>)
    : {};
}

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * Classifica a falha para a tela poder escolher a afordância certa.
 *
 * Os status são os que `cloudFetch` DE FATO produz — medidos em `src/lib/api.ts`,
 * não supostos. Ele nunca deixa passar um `TypeError`: rede caída sai como
 * `ApiError(0)`, excesso como `ApiError(429)` e sessão expirada como
 * `ApiError(401)`.
 *
 * O `429` merece a separação explícita abaixo: é rate limit do NOSSO plano de
 * controle. A quota do provider chega como `422` com `providerStatus: 429` —
 * confundir os dois mandaria o operador trocar uma chave que está boa.
 */
export function classificarFalha(erro: unknown): Falha {
  if (!(erro instanceof ApiError)) return { tipo: 'transporte' };

  const corpo = corpoDe(erro);
  const code = texto(corpo.error);

  if (erro.status === 401) return { tipo: 'sessao' };

  if (erro.status === 422 && code === 'model_refused') {
    const status = typeof corpo.providerStatus === 'number' ? corpo.providerStatus : undefined;
    return {
      tipo: 'provider',
      // Nada é inventado: sem mensagem no corpo, a tela usa o texto dela e diz
      // apenas o que sabe — que o provider recusou.
      ...(texto(corpo.message) !== undefined ? { mensagem: texto(corpo.message) } : {}),
      ...(status !== undefined ? { providerStatus: status } : {}),
    };
  }

  /**
   * 413 é o teto de corpo do BFF (`lerCorpoLimitado`), e ele NÃO é transporte: o
   * operador precisa saber que o prompt é grande demais, não que a rede caiu.
   * Cair no genérico dava um diagnóstico falso para um problema de tamanho.
   */
  if (erro.status === 413) {
    return { tipo: 'validacao', motivo: 'O prompt é grande demais para ser enviado. Reduza o texto e tente de novo.' };
  }

  if (erro.status === 400) {
    if (code === 'missing_variable') {
      const variavel = texto(corpo.variable);
      return { tipo: 'validacao', ...(variavel !== undefined ? { variavelFaltante: variavel } : {}) };
    }
    const motivo = texto(corpo.reason) ?? texto(corpo.message);
    return { tipo: 'validacao', ...(motivo !== undefined ? { motivo } : {}) };
  }

  // Tudo o mais é transporte: rede, serviço fora, bug nosso, rate limit nosso.
  // Colapsar aqui é deliberado — a tela não tem afordância diferente para cada um
  // deles, e fingir precisão seria pior que o genérico honesto.
  return { tipo: 'transporte' };
}
