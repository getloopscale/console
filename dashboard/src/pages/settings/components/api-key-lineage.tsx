import { History } from 'lucide-react';
import { Badge, Card, Timestamp } from '@getloopscale/ui';
import { Alert } from '@/components/ui/alert-guard';
import { AppModal } from '@/components/ui/app-modal';
import { useApiKeyLineage } from '@/hooks/settings/use-api-keys';
import type { APIKeyView, LineageItem } from '@/hooks/settings/api-keys-api';

/**
 * O painel de linhagem de uma chave de API.
 *
 * ## Por que saiu (B-009)
 *
 * `settings/api-keys.tsx` estava em 575 linhas — 75 acima do orçamento de 500 do
 * `ADR-0002` — depois de os quatro diálogos saírem. Este painel é o que faltava,
 * e a extração leva o arquivo para BAIXO do orçamento pela primeira vez desde
 * que ele entrou na lista de dívida.
 *
 * ## Por que não veio junto com os diálogos
 *
 * Porque não é um diálogo. `LineageSheet` **exibe** a procedência de uma chave —
 * quem a criou, quando, a partir de qual outra. Não confirma nem cria nada.
 *
 * Juntar os dois teria produzido um arquivo "componentes que estavam no
 * api-keys", que é o balde genérico que o `ADR-0001` existe para impedir. A
 * separação por natureza custa um arquivo a mais e evita um balde.
 *
 * ## Os tipos vêm junto
 *
 * `LineageItem`, `LineageResult` e `LineageSheetProps` são exclusivos deste
 * painel — medido antes de mover. Deixá-los na origem obrigaria a página a
 * exportar tipos que ela não usa, e inverteria a direção da dependência: a tela
 * passaria a existir para servir o painel.
 */

// B-012/B-053 — `LineageItem` e `LineageResult` mudaram de casa junto com a
// consulta que os produz (`hooks/settings/api-keys-api.ts`). Este arquivo
// desenha; ele não busca.
interface LineageSheetProps {
  target: APIKeyView | null;
  onClose: () => void;
}

/**
 * API Key Lineage View plan T7.4 — modal showing the rotation chain
 * as a vertical timeline. Each item: prefix + name + status badge.
 * Current key highlighted with a "Current" badge.
 */
export function LineageSheet({ target, onClose }: LineageSheetProps) {
  const open = target !== null;
  const query = useApiKeyLineage(target?.id);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="Rotation history"
      description={target ? `Lineage of "${target.name}" — root key first, current key last.` : undefined}
      icon={<History className="size-4" aria-hidden="true" />}
    >
      <div className="space-y-3" data-testid="lineage-timeline">
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading lineage…</p>
        ) : query.isError ? (
          <Alert
            intent="warning"
            title="Could not load lineage"
            description="Try again in a moment."
          />
        ) : (
          (query.data?.lineage ?? []).map((item) => (
            <LineageRow key={item.id} item={item} />
          ))
        )}
      </div>
    </AppModal>
  );
}

function LineageRow({ item }: { item: LineageItem }) {
  let statusLabel = 'Active';
  let statusVariant: 'default' | 'success' | 'warning' | 'destructive' =
    'default';
  if (item.revoked_at) {
    statusLabel = 'Revoked';
    statusVariant = 'destructive';
  } else if (item.expires_at && new Date(item.expires_at) < new Date()) {
    statusLabel = 'Expired';
    statusVariant = 'warning';
  } else if (item.is_current) {
    statusLabel = 'Active';
    statusVariant = 'success';
  }

  return (
    <Card
      className={item.is_current ? 'border-primary' : undefined}
      data-testid={`lineage-row-${item.id}`}
    >
      <div className="p-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <code className="font-mono text-xs text-muted-foreground">
            {item.key_prefix}…
          </code>
          <div className="flex gap-1">
            {item.is_current ? (
              <Badge
                variant="success"
                data-testid={`lineage-current-${item.id}`}
              >
                Current
              </Badge>
            ) : null}
            <Badge variant={statusVariant}>{statusLabel}</Badge>
          </div>
        </div>
        <p className="text-sm font-medium">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          Created <Timestamp value={item.created_at} />
        </p>
      </div>
    </Card>
  );
}
