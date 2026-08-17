import { Button } from '@usetheo/ui';
import type { EstadoDePaginacao } from '@/lib/pagination';

/**
 * O controle Prev / `Page X / Y` / Next (B-184).
 *
 * A JSX era idêntica em quatro telas, incluindo os predicados de `disabled` — que são a parte
 * fácil de errar: o rótulo é `Previous` nas cinco telas, e o botão desabilita tanto no limite (`page <= 1`) quanto durante uma busca, e
 * esquecer a segunda condição deixa quem clica rápido pular uma página cujo resultado nunca
 * chegou. `settings/audit.tsx` renderizava o mesmo controle com o rótulo escrito de outro jeito.
 *
 * O `testId` continua por tela porque os testes existentes o usam para dizer QUAL paginador estão
 * olhando — uma tela pode ter mais de uma lista.
 */
export function Pager({
  paginacao,
  ocupado,
  testId,
  showPage = true,
}: {
  paginacao: EstadoDePaginacao;
  /** Uma busca em andamento: navegar agora pularia uma página que ainda não chegou. */
  ocupado: boolean;
  testId?: string;
  /**
   * `false` quando a tela já diz em que página está por conta própria — `settings/audit.tsx`
   * mostra `Page X of Y · N records` num rodapé à esquerda, com os botões à direita. Repetir o
   * `Page X / Y` entre eles diria a mesma coisa duas vezes na mesma linha.
   */
  showPage?: boolean;
}) {
  const { page, pageCount, goToPrevious, goToNext } = paginacao;
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={page <= 1 || ocupado}
        onClick={goToPrevious}
      >
        Previous
      </Button>
      {showPage ? (
        <span className="tabular-nums" data-testid={testId}>{`Page ${String(page)} / ${String(pageCount)}`}</span>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={page >= pageCount || ocupado}
        onClick={goToNext}
      >
        Next
      </Button>
    </div>
  );
}
