import {
  ACTIVE_SCOPES,
  RESERVED_SCOPES,
  type CreateKeyResponse,
  type APIKeyView,
} from '@/pages/settings/api-keys';
import {useState} from 'react';
import {Badge, Button, Checkbox, CodeBlock, CopyButton, Input, Tooltip} from '@usetheo/ui';
import {Dialog} from '@/components/ui/dialog';
import {ConfirmDialog} from '@/components/dialogs/confirm-dialog';
import {Alert} from '@/components/ui/alert-guard';

/**
 * Os quatro diálogos da tela de chaves de API.
 *
 * ## Por que saíram (B-009)
 *
 * `settings/api-keys.tsx` tinha 955 linhas — o maior arquivo do projeto, e 455
 * acima do orçamento de 500 do `ADR-0002`. Sete componentes conviviam ali; os
 * quatro diálogos somavam 364 linhas.
 *
 * O corte foi possível porque a fronteira já existia: cada diálogo recebe props
 * e devolve por callback, sem ler estado do pai. Medido antes de mover — o
 * acoplamento com o topo do arquivo era de três nomes (`ACTIVE_SCOPES`,
 * `RESERVED_SCOPES`, `CreateKeyResponse`, `APIKeyView`), todos exportáveis.
 *
 * ## O que NÃO veio
 *
 * `LineageSheet` e `LineageRow`. Eles renderizam a linhagem de uma chave — o
 * painel lateral que a tela abre — e não são diálogos: não confirmam nem criam
 * nada. Movê-los junto teria produzido um arquivo "componentes que estavam no
 * api-keys", que é o balde genérico que o `ADR-0001` existe para impedir.
 *
 * Eles ficam como a próxima fatia, com fronteira própria.
 */

interface ConfirmRotateDialogProps {
  target: APIKeyView | null;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}

export function ConfirmRotateDialog({
  target,
  onCancel,
  onConfirm,
  submitting,
}: ConfirmRotateDialogProps) {
  if (!target) return null;

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => !o && onCancel()}
      title={`Rotate API key "${target.name}"?`}
      description={
        <div className="space-y-2 text-sm">
          <p>
            A new API key will be generated immediately. The old key will keep
            working for 24 hours, then expire automatically. Both keys overlap
            during the grace window so you can update your code without
            downtime.
          </p>
          <p className="text-muted-foreground">
            Type the key name to confirm. You will see the new secret only once.
          </p>
        </div>
      }
      confirmLabel={submitting ? 'Rotating…' : 'Rotate key'}
      cancelLabel="Cancel"
      intent="destructive"
      confirmationPhrase={target.name}
      loading={submitting}
      onConfirm={onConfirm}
    />
  );
}

interface CreateApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    scopes: string[];
    expires_at?: string | null;
  }) => void;
  submitting: boolean;
  error: unknown;
}

/**
 * Create dialog. Form is intentionally simple — Input + scope checkboxes +
 * optional expiration. Validation mirrors the backend (`EMPTY_SCOPES`,
 * `EMPTY_NAME`, `NAME_TOO_LONG`, `EXPIRES_IN_PAST`) so the customer never
 * sees a server-side 400 they could have prevented client-side.
 */

export function CreateApiKeyDialog({
  open,
  onClose,
  onSubmit,
  submitting,
  error,
}: CreateApiKeyDialogProps) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    // #348 — NADA pre-marcado. A tela aconselha "a key with fewer scopes is safer if it leaks" e
    // pre-marcava `memory:read`: quem seguia a jornada de outro produto saia com o escopo de um
    // terceiro sem ter pedido. Nao era escalacao (dava para desmarcar), era um default empurrando
    // na direcao oposta a que a propria tela recomenda — e o custo so aparece no cenario sobre o
    // qual a frase adverte. A guarda de selecao vazia ja existia (`selected.size === 0`), entao
    // remover o default nao abre caminho para chave sem escopo.
    new Set(),
  );
  const [expiresAt, setExpiresAt] = useState('');

  const reset = () => {
    setName('');
    setSelected(new Set()); // #348 — o reset segue o mesmo default: nenhum.
    setExpiresAt('');
  };

  const handleClose = () => {
    if (!submitting) {
      reset();
      onClose();
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (name.trim() === '' || selected.size === 0) return;
    onSubmit({
      name: name.trim(),
      scopes: Array.from(selected),
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  };

  const toggleScope = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const submitDisabled =
    submitting || name.trim() === '' || selected.size === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Create API Key</Dialog.Title>
          <Dialog.Description>
            Choose scopes carefully — a key with fewer scopes is safer if it
            leaks.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <form
            id="create-api-key-form"
            className="space-y-4"
            onSubmit={handleSubmit}
          >
            <div>
              <label
                htmlFor="api-key-name"
                className="text-sm font-medium block mb-1"
              >
                Name
              </label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="prod-agent"
                maxLength={64}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                A short label. Shown in the keys list and audit log.
              </p>
            </div>

            <fieldset>
              <legend className="text-sm font-medium mb-2">Scopes</legend>
              <div className="space-y-2">
                {ACTIVE_SCOPES.map((scope) => (
                  <label
                    key={scope.id}
                    className="flex items-start gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(scope.id)}
                      onCheckedChange={() => toggleScope(scope.id)}
                      aria-label={scope.id}
                    />
                    <span>
                      <span className="font-mono text-sm">{scope.label}</span>
                      <span className="text-xs text-muted-foreground block">
                        {scope.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              <p className="text-xs text-muted-foreground mt-3 mb-2">
                Reserved for future surfaces:
              </p>
              <div className="flex flex-wrap gap-1">
                {RESERVED_SCOPES.map((scope) => (
                  <Tooltip
                    key={scope.id}
                    label={`Coming with the ${scope.vertical} product surface`}
                  >
                    <Badge variant="outline" className="opacity-50">
                      {scope.id}
                    </Badge>
                  </Tooltip>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="api-key-expires"
                className="text-sm font-medium block mb-1"
              >
                Expiration{' '}
                <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="api-key-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Leave blank for a key that never expires.
              </p>
            </div>

            {error ? (
              <Alert intent="destructive" title="Could not create key">
                {error instanceof Error ? error.message : 'Please try again.'}
              </Alert>
            ) : null}
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-api-key-form"
            disabled={submitDisabled}
          >
            {submitting ? 'Creating…' : 'Create key'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

interface RevealedSecretDialogProps {
  revealed: CreateKeyResponse | null;
  onClose: () => void;
}

/**
 * EC-13 absorption: the "Done" button is DISABLED until the customer
 * acknowledges they've copied the secret. This is the show-once contract —
 * the raw secret never appears in any response again, never persists in
 * localStorage / sessionStorage, never goes through analytics. If the
 * customer dismisses without copying, the only recovery path is "revoke
 * and create new" (intentional friction).
 */

export function RevealedSecretDialog({
  revealed,
  onClose,
}: RevealedSecretDialogProps) {
  const [copied, setCopied] = useState(false);

  if (!revealed) return null;

  // The (x) / ESC / overlay dismiss the dialog UNCONDITIONALLY. Dismissing
  // without copying is an allowed (if lossy) path — the show-once secret is
  // gone and the recovery is "revoke + create new" (the intentional friction
  // documented above). Gating dismissal on `copied` left the (x) button dead
  // (it fired onOpenChange → handleClose → early-returned), which is the bug
  // users hit. The acknowledgement gate stays ONLY on the primary "Done" CTA.
  const close = () => {
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={revealed !== null} onOpenChange={(o) => !o && close()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Your new API key</Dialog.Title>
          <Dialog.Description>
            Copy this key now — it will never be shown again.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <div className="space-y-4">
            <Alert intent="info" title="Copy this key now">
              This is the only time the full key will be shown. After you close
              this dialog, you can only see the prefix. If you lose the key,
              revoke it and create a new one.
            </Alert>

            <CodeBlock language="text" code={revealed.secret} />

            <div className="flex justify-end">
              <CopyButton value={revealed.secret} />
            </div>

            <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-border">
              <Checkbox
                checked={copied}
                onCheckedChange={(v) => setCopied(v === true)}
                aria-label="I've copied my key safely"
              />
              <span className="text-sm">I've copied my key safely</span>
            </label>
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            type="button"
            onClick={close}
            disabled={!copied}
            aria-disabled={!copied}
          >
            Done
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

interface ConfirmDeleteDialogProps {
  target: APIKeyView | null;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}

/**
 * DESIGN.md danger zone choreography per Memory Section mandate.
 * Uses @usetheo/ui's built-in `confirmationPhrase` (typed verification)
 * + `intent="destructive"` (NOT primary).
 */

export function ConfirmDeleteDialog({
  target,
  onCancel,
  onConfirm,
  submitting,
}: ConfirmDeleteDialogProps) {
  if (!target) return null;

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => !o && onCancel()}
      title={`Delete API key "${target.name}"`}
      description={
        <div className="space-y-2 text-sm">
          <p>
            This API key will be revoked immediately. Any application using it
            will receive 401 Unauthorized on its next request.
          </p>
          <p className="text-muted-foreground">
            This cannot be undone. To re-enable access, create a new key and
            update your application.
          </p>
        </div>
      }
      confirmLabel={submitting ? 'Deleting…' : 'Delete key'}
      cancelLabel="Cancel"
      intent="destructive"
      confirmationPhrase={target.name}
      onConfirm={onConfirm}
      loading={submitting}
    />
  );
}
