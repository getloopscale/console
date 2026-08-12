import { Button, Card } from '@usetheo/ui';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

/**
 * O cartão "Explore" das visões gerais de domínio (B-192).
 *
 * ## Por que deixou de ser inline
 *
 * Era o mesmo corpo em `lens/overview.tsx`, `memory/overview.tsx` e `rag/overview.tsx`. Duas das
 * três cópias traziam um comentário justificando a permanência inline pela "Regra de 3 / YAGNI" —
 * escrito quando já existiam três. A regra dizia o contrário do que a nota afirmava.
 *
 * ## O que a triplicação custou antes
 *
 * A navegação já divergiu uma vez: `lens` foi corrigida para `<Link>` (navegação de SPA) enquanto
 * as outras duas continuaram atribuindo `window.location.href`, forçando recarga inteira da
 * página. Aquilo foi consertado nas três desde então — o que sobrou, e é o que este módulo fecha,
 * é a possibilidade de acontecer de novo.
 *
 * A tipagem do ícone também tinha divergido: `LucideIcon` numa cópia, `typeof Brain` e
 * `typeof Boxes` nas outras. As duas últimas amarram o tipo a UM ícone concreto — passar outro
 * compila por coincidência, porque todos os ícones do lucide têm a mesma assinatura.
 */
export interface ExploreCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Rota interna. `<Link>` e não `window.location`: recarregar a página perde o estado do app. */
  href: string;
}

export function ExploreCard({ icon: Icon, title, description, href }: ExploreCardProps) {
  return (
    <Card>
      <Card.Body className="space-y-2">
        <Icon className="size-5 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Button asChild variant="ghost" size="sm">
          <Link to={href}>Open →</Link>
        </Button>
      </Card.Body>
    </Card>
  );
}
