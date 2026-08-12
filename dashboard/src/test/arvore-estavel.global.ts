import { assinar, comparar, houveMudanca, relatorio } from './arvore-estavel';

/**
 * B-099 — `globalSetup` do vitest: tira a assinatura de `src/` antes e depois.
 *
 * Vive separado de `arvore-estavel.ts` porque este arquivo é o CONTRATO do
 * vitest (uma função default que devolve o teardown) e aquele é a lógica pura,
 * testável sem subir a suíte inteira.
 */
export default function () {
  const antes = assinar();
  return () => {
    const mudanca = comparar(antes, assinar());
    if (houveMudanca(mudanca)) {
      // `console.error` e não `throw`: a suíte pode ter passado, e derrubá-la
      // por uma edição concorrente transformaria um aviso útil num obstáculo.
      // Quem edita enquanto roda está fazendo trabalho legítimo.
      console.error(relatorio(mudanca));
    }
  };
}
