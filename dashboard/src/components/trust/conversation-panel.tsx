import { useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { Button, Card, Skeleton, Timestamp } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import {
  conversationContentState,
  conversationMessages,
  type ConversationPayload,
} from './trust-series';

/**
 * M23 — a conversa de origem de uma violação, aberta ao lado da lista.
 *
 * O conteúdo da conversa É o dado sensível que a violação denuncia — e ele chega **ÍNTEGRO**.
 *
 * LT-013 (BLOCKER): este cabeçalho afirmava o contrário — "já vem redigido do lado do theo-trust".
 * Era falso. A garantia de redação do serviço cobre a superfície de violações e a tabela
 * `policy_violations`; NÃO cobre `messages.content`, que `GET /v1/conversations/:id` serve
 * original (LT-012, ADR 0009). A afirmação foi escrita por suposição, não por verificação, e a
 * entrega do LT-001 (`conversationId`) foi o que tornou este painel alcançável.
 *
 * Garantia falsa é pior que garantia nenhuma: quem lê baixa a guarda — abre em screen-share,
 * tira print — e vaza justamente por confiar. Agora a descrição diz o oposto, e um teste de
 * componente impede a frase de voltar.
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
  const content = conversationContentState(data);
  /** Ver o conteúdo original é uma DECISÃO do operador, não o default da tela (LT-013). */
  const [revealed, setRevealed] = useState(false);

  return (
    <Card>
      <Card.Header>
        {/* asChild → <h2>: o PageShell já rende o <h1> (WCAG 1.3.1). */}
        <Card.Title asChild>
          <h2>
            Conversa{' '}
            <span className="font-mono text-base">{conversationId}</span>
          </h2>
        </Card.Title>
        <Card.Description>
          Este é o <strong>conteúdo original</strong> da conversa, como foi
          ingerido — inclusive o trecho que a violação apontou. Cuidado ao
          exibir em tela compartilhada ou impressão.
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
        ) : content.kind === 'withheld' ? (
          /* #347 — a mensagem antiga ("não trouxe mensagens legíveis") descrevia o DADO quando o
             fato é sobre PERMISSÃO, e mandava o leitor investigar ingestão/parsing/banco, todos
             funcionando. O back-end SUPRIME `content` sem o escopo, de propósito (LT-012): "a
             ausência descreve uma permissão, o vazio descreveria o dado" — a tela estava do lado
             errado dessa distinção. Dizer o NÚMERO de mensagens é o que prova, para quem lê, que
             a ingestão está de pé. */
          <Alert
            intent="info"
            title="Conteúdo não exibido por falta de permissão"
            description={`Esta conversa tem ${content.total} ${
              content.total === 1 ? 'mensagem' : 'mensagens'
            }, e o texto delas não foi entregue porque a credencial em uso não inclui o escopo trust:content. A ingestão está correta; o que falta é permissão de leitura.`}
          />
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            A conversa foi lida e não tem mensagem alguma.
          </p>
        ) : (
          <ol className="space-y-3">
            {messages.map((m, i) => (
              <li
                key={m.id ?? `msg-${i}`}
                className="rounded-md border border-border p-3"
              >
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
                {revealed ? (
                  <p className="whitespace-pre-wrap text-body-sm">
                    {m.content}
                  </p>
                ) : (
                  // Oculto por padrão. Quem abre uma violação para investigar não pediu para
                  // VER o segredo — pediu para saber o que aconteceu, e papel + horário acima
                  // já respondem isso. Exibir por padrão punha o vazamento na jornada mais
                  // provável do produto, com o operador em screen-share sem perceber.
                  <p className="text-body-sm italic text-muted-foreground">
                    Conteúdo oculto — {m.content?.length ?? 0} caractere(s).
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card.Body>

      <Card.Footer>
        {messages.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
            {revealed ? 'Ocultar conteúdo' : 'Revelar conteúdo original'}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Fechar conversa"
        >
          <X className="size-4" aria-hidden="true" />
          Fechar conversa
        </Button>
      </Card.Footer>
    </Card>
  );
}
