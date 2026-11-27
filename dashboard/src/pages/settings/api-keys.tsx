import {useEffect, useState} from 'react';
import {
  useApiKeys,
  useCreateApiKey,
  useRevogarApiKey,
  useRotacionarApiKey,
} from '@/hooks/settings/use-api-keys';
import type { APIKeyView, CreateKeyResponse } from '@/hooks/settings/api-keys-api';
import {History, Key, Plus, Recycle, Trash2} from 'lucide-react';
import { Badge, Button, Card, DataTable, type DataTableColumn, EmptyState, Timestamp } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import {Alert} from '@/components/ui/alert-guard';
import { ListTruncationNotice } from '@/components/ui/list-truncation-notice';
import {usePageMeta} from '@/hooks/use-page-meta';
import {useRequireAuth} from '@/hooks/use-auth';
import { LineageSheet } from '@/pages/settings/components/api-key-lineage';
import {
  ConfirmRotateDialog,
  CreateApiKeyDialog,
  RevealedSecretDialog,
  ConfirmDeleteDialog,
} from '@/pages/settings/components/api-key-dialogs';

/**
 * Plan 0 of dashboard-memory-section-roadmap.md, T0.1.
 * Platform unified API keys management page.
 *
 * Consumes the backend ADRs locked in 2026-06-06-platform-api-keys-with-scopes-plan.md v1.2:
 *  - D1 single theo_live_* key, multi-scope
 *  - D2 scope enum v0.1 (memory:*) + reserved (rag:*|traces:*|agents:*|deploys:*)
 *  - D3 secret displayed ONCE post-create; masked thereafter via key_prefix
 *  - D7 trash performs soft-delete via DELETE /v1/api-keys/{id}
 *  - DESIGN.md v1.0 5Q-3s + danger zone choreography per Memory Section mandate
 */

// B-012/B-053 — a forma dos dados mora com quem os busca
// (`hooks/settings/api-keys-api.ts`). Reexportados aqui porque os diálogos e o
// painel de linhagem já importavam desta página, e mover o tipo não é motivo
// para tocar em cinco arquivos.
export type { APIKeyView, CreateKeyResponse } from '@/hooks/settings/api-keys-api';

// Exportado para que `api-keys-scope-catalog.test.ts` confronte esta lista com o enum
// `validScopes` do backend. Enquanto cada lado tinha só o SEU teste, as duas divergiram
// nos dois sentidos — `trust:*` faltava aqui E lá, `storage:*` existia lá e não aqui.
export const ACTIVE_SCOPES = [
  {
    id: 'memory:read',
    label: 'memory:read',
    description: 'Recall memories and read history',
  },
  {
    id: 'memory:write',
    label: 'memory:write',
    description: 'Remember new facts and reflect',
  },
  {
    id: 'memory:delete',
    label: 'memory:delete',
    description: 'Forget specific memories',
  },
  {
    id: 'memory:admin',
    label: 'memory:admin',
    description: 'Settings, webhooks, exports',
  },
  {
    id: 'observability:read',
    label: 'observability:read',
    description: 'Read traces, sessions, analytics',
  },
  {
    id: 'observability:write',
    label: 'observability:write',
    description: 'Ingest spans; manage datasets/evaluators/guards',
  },
  {
    id: 'observability:delete',
    label: 'observability:delete',
    description: 'Delete dataset items, evaluators, guards, tags',
  },
  {
    id: 'observability:admin',
    label: 'observability:admin',
    description: 'Observability key lifecycle',
  },
  // RAG vertical (looprag, M12-M20) — customer-issuable (#168). rag:admin is intentionally
  // omitted: it is looprag's broker-held key-lifecycle scope, never minted to a consumer.
  {
    id: 'rag:read',
    label: 'rag:read',
    description: 'Retrieve chunks and answer questions',
  },
  {
    id: 'rag:write',
    label: 'rag:write',
    description: 'Create collections and ingest documents',
  },
  {
    id: 'rag:delete',
    label: 'rag:delete',
    description: 'Delete documents and collections',
  },
  // Storage vertical (M7). O backend já aceitava estes dois — e havia teste Go fixando
  // isso — enquanto a tela não os oferecia: capacidade emitível por API e invisível para
  // quem usa o produto.
  {
    id: 'storage:read',
    label: 'storage:read',
    description: 'Download and list stored objects',
  },
  {
    id: 'storage:write',
    label: 'storage:write',
    description: 'Upload and delete stored objects',
  },
  // Trust vertical (loopguardrails, Model B L2). A cadeia inteira já estava de pé — borda
  // roteando /v1/trust/*, forward-auth cunhando chave por tenant — e nenhum cliente podia
  // alcançá-la, porque o escopo que a borda exige não era emitível em lugar nenhum.
  {
    id: 'trust:read',
    label: 'trust:read',
    description: 'Read conversations, themes, trends and policy violations',
  },
  {
    id: 'trust:write',
    label: 'trust:write',
    description: 'Ingest conversations and run inline guardrails',
  },
  {
    id: 'trust:delete',
    label: 'trust:delete',
    description: 'Delete conversations and custom validators',
  },
  // LT-012 / ADR 0009 (opção B). Separado de `trust:read` de propósito: o conteúdo bruto
  // inclui o trecho que o scanner marcou como segredo, então ler uma violação e ler o
  // texto que a produziu deixaram de ser a mesma permissão. A descrição diz o que a chave
  // passa a alcançar, para que conceder deixe de ser um clique sem consequência aparente.
  {
    id: 'trust:content',
    label: 'trust:content',
    description:
      'Read raw conversation text, including content flagged as a secret',
  },
  // Promptly vertical (loopprompt, M11 Model B L2). MESMA história do trust logo acima,
  // e a terceira vez que ela se repete: em 2026-08-01 a cadeia estava inteira de pé — borda
  // roteando /v1/promptly/*, ForwardAuth exigindo `promptly:read`, broker cunhando por
  // tenant — e o produto era inutilizável, porque o escopo não era emitível.
  //
  // Esta tela é a TERCEIRA metade do mesmo defeito, e a mais fácil de esquecer: acrescentar
  // o escopo só no enum do backend torna a chave aceitável e continua sem um jeito de o
  // cliente PEDIR. `api-keys-scope-catalog.test.ts` existe exatamente para isso e foi o que
  // pegou a omissão — a tela precisa oferecer EXATAMENTE o que o backend aceita.
  {
    id: 'promptly:read',
    label: 'promptly:read',
    description: 'Resolve prompts and read revisions, labels and evaluations',
  },
  {
    id: 'promptly:write',
    label: 'promptly:write',
    description: 'Create prompt revisions and move environment labels',
  },
  // Skills vertical (loopskills, M22 Model B). Diferente do trust — onde a cadeia já
  // estava de pé e só o escopo faltava — aqui NADA existia: sem broker, sem forward-auth,
  // sem rota de borda. Oferecer o escopo antes dessas peças entregaria uma chave que
  // nenhuma borda aceita: o defeito oposto, e igualmente silencioso. `skills:admin` é
  // omitido de propósito, como `rag:admin` — é o escopo de ciclo de vida de chave.
  {
    id: 'skills:read',
    label: 'skills:read',
    description: 'Search and download agent skills',
  },
  {
    id: 'skills:write',
    label: 'skills:write',
    description: 'Publish, update and delete skills',
  },
  {
    id: 'skills:publish',
    label: 'skills:publish',
    description: 'Promote skills to the shared catalog',
  },
] as const;

export const RESERVED_SCOPES = [
  { id: 'agents:read', vertical: 'Agents' },
  { id: 'agents:invoke', vertical: 'Agents' },
  { id: 'deploys:read', vertical: 'Deploys' },
  { id: 'deploys:write', vertical: 'Deploys' },
] as const;

export function ApiKeysPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('API Keys'), [setPageTitle]);
  useRequireAuth();
  const listQuery = useApiKeys();

  const [createOpen, setCreateOpen] = useState(false);
  const [revealed, setRevealed] = useState<CreateKeyResponse | null>(null);
  const [pendingDelete, setPendingDelete] = useState<APIKeyView | null>(null);
  // API Key Rotation plan T6.5 — pendingRotate mirrors pendingDelete pattern.
  const [pendingRotate, setPendingRotate] = useState<APIKeyView | null>(null);
  // API Key Lineage View plan T7.4 — pendingLineage opens the Sheet.
  const [pendingLineage, setPendingLineage] = useState<APIKeyView | null>(null);

  const createMutation = useCreateApiKey((resp) => {
    setRevealed(resp);
    setCreateOpen(false);
  });
  const revokeMutation = useRevogarApiKey(() => setPendingDelete(null));
  const rotateMutation = useRotacionarApiKey((resp) => {
    setRevealed(resp);
    setPendingRotate(null);
  });

  const keys = listQuery.data?.keys ?? [];

  const columns: DataTableColumn<APIKeyView>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'key',
      label: 'Key',
      render: (row) => (
        <code className="text-xs font-mono text-muted-foreground">
          {row.key_prefix}…
        </code>
      ),
    },
    {
      key: 'scopes',
      label: 'Scopes',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.scopes.map((s) => (
            <Badge key={s} variant="outline">
              {s}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => <Timestamp value={row.created_at} />,
    },
    {
      key: 'last_used_at',
      label: 'Last used',
      render: (row) =>
        row.last_used_at ? (
          <Timestamp value={row.last_used_at} />
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex gap-1 justify-end">
          {/* API Key Lineage View plan T7.4 — Lineage button per row. */}
          <Button
            variant="ghost"
            size="sm"
            aria-label={`View lineage for API key ${row.name}`}
            onClick={() => setPendingLineage(row)}
          >
            <History className="size-4" />
          </Button>
          {/* API Key Rotation plan T6.5 — Rotate button per row. */}
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Rotate API key ${row.name}`}
            onClick={() => setPendingRotate(row)}
          >
            <Recycle className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete API key ${row.name}`}
            onClick={() => setPendingDelete(row)}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageShell
        title="API Keys"
        description="Manage your unified LoopScale platform keys. Each key carries explicit scopes, chosen per product surface."
        primaryAction={{
          label: 'Create API Key',
          icon: Plus,
          onClick: () => setCreateOpen(true),
        }}
      >
        {listQuery.isLoading ? (
          <Card>Loading…</Card>
        ) : listQuery.isError ? (
          <Alert intent="warning" title="Could not load API keys">
            Something went wrong. Try refreshing the page.
          </Alert>
        ) : keys.length === 0 ? (
          <EmptyState
            icon={Key}
            title="No API keys yet"
            description="Create your first key to enable programmatic access from your code."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4 mr-1" />
                Create API Key
              </Button>
            }
          />
        ) : (
          <Card>
            <DataTable columns={columns} data={keys} rowKey={(row) => row.id} />
            <ListTruncationNotice
              hasMore={listQuery.data?.has_more === true}
              total={keys.length}
              substantivo="API keys"
            />
          </Card>
        )}
      </PageShell>

      <CreateApiKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => createMutation.mutate(input)}
        submitting={createMutation.isPending}
        error={createMutation.error}
      />

      <RevealedSecretDialog
        revealed={revealed}
        onClose={() => setRevealed(null)}
      />

      <ConfirmDeleteDialog
        target={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() =>
          pendingDelete && revokeMutation.mutate(pendingDelete.id)
        }
        submitting={revokeMutation.isPending}
      />

      <ConfirmRotateDialog
        target={pendingRotate}
        onCancel={() => setPendingRotate(null)}
        onConfirm={() =>
          pendingRotate && rotateMutation.mutate(pendingRotate.id)
        }
        submitting={rotateMutation.isPending}
      />

      <LineageSheet
        target={pendingLineage}
        onClose={() => setPendingLineage(null)}
      />
    </>
  );
}
