import { X } from 'lucide-react';
import { Button, Card, Skeleton, Timestamp } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { conversationMessages, type ConversationPayload } from './trust-series';

/**
 * M23 — a conversa de origem de uma violação, aberta ao lado da lista.
 *
 * O conteúdo da conversa É o dado sensível que a violação denuncia. Este componente mostra o que o
 * serviço devolve — que já vem redigido do lado do `theo-trust` — e nunca reconstrói o trecho bruto
 * a partir da violação.
 *
 * Vive fora da página porque a página tem outra responsabilidade: listar e filtrar. Aqui só se
 * renderiza uma conversa já carregada.
 */
export interface ConversationPanelProps {
  readonly conversationId: string;
  readonly data: ConversationPayload | null | undefined;
  readonly isLoading: boolean;
  readonly failed: boolean;
  readonly onClose: () => void;
}

export function ConversationPanel(props: ConversationPanelProps) {
  const { conversationId, data, isLoading, failed, onClose } = props;
  const messages = conversationMessages(data);

  return (
    <Card>
      <Card.Header>
        {/* asChild → <h2>: o PageShell já rende o <h1> (WCAG 1.3.1). */}
        <Card.Title asChild>
          <h2>
            Conversa <span className="font-mono text-base">{conversationId}</span>
          </h2>
        </Card.Title>
        <Card.Description>
          O conteúdo já chega redigido do serviço — esta tela nunca reconstrói o trecho bruto.
        </Card.Description>
      </Card.Header>

      <Card.Body>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : failed ? (
          <Alert
            intent="destructive"
            title="Não foi possível carregar a conversa"
            description="A violação continua válida; apenas o detalhe não pôde ser lido agora."
          />
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            A conversa foi lida, mas não trouxe mensagens legíveis.
          </p>
        ) : (
          <ol className="space-y-3">
            {messages.map((m, i) => (
              <li key={m.id ?? `msg-${i}`} className="rounded-md border border-border p-3">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="text-label uppercase text-muted-foreground">
                    {m.role ?? 'desconhecido'}
                  </span>
                  {m.createdAt ? (
                    <span className="text-body-sm text-muted-foreground">
                      <Timestamp value={m.createdAt} format="both" />
                    </span>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap text-body-sm">{m.content}</p>
              </li>
            ))}
          </ol>
        )}
      </Card.Body>

      <Card.Footer>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar conversa">
          <X className="size-4" aria-hidden="true" />
          Fechar conversa
        </Button>
      </Card.Footer>
    </Card>
  );
}
