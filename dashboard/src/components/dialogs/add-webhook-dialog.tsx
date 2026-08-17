import { useId, useState, type FormEvent } from 'react';
import { Button, Checkbox, Input } from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';
import { Alert } from '@/components/ui/alert-guard';

/**
 * O diálogo de cadastro de webhook, um só (B-193).
 *
 * ## O que estava duplicado
 *
 * `memory/webhooks.tsx` e `settings/webhooks.tsx` traziam o mesmo componente inteiro — estado,
 * reset, submit, JSX — e, junto, a MESMA REGRA DE NEGÓCIO: uma URL de webhook precisa começar com
 * `http://` ou `https://`, o rótulo não pode ser vazio e ao menos um evento precisa estar
 * marcado. Regra de negócio duplicada é o caso em que DRY não é preferência: as duas cópias
 * respondem à mesma pergunta, e no dia em que uma passar a exigir `https` a outra não vai passar.
 *
 * A cópia de `settings` já era o superconjunto — recebia `description` e `events` por parâmetro
 * enquanto a de `memory` os tinha fixos. É ela que sobrevive aqui.
 *
 * ## Os ids saíram de literais para `useId`
 *
 * As duas cópias declaravam ids fixos (`wh-url` / `wwh-url`) e nomes de formulário distintos
 * justamente para não colidirem entre si. Isso resolvia a colisão ENTRE as duas cópias e deixava
 * de pé a colisão dentro de uma só: dois diálogos montados na mesma página compartilhariam o id,
 * e um `<label htmlFor>` ambíguo manda o leitor de tela para o campo errado. `useId` resolve as
 * duas.
 */
/** Não exportada: quem usa o diálogo passa a lista, e o tipo é inferido daqui. */
interface EventoDeWebhook {
  readonly id: string;
  readonly label: string;
}

export interface AddWebhookDialogProps {
  open: boolean;
  onClose: () => void;
  submitting: boolean;
  onSubmit: (input: { url: string; label: string; events: string[] }) => void;
  /**
   * Why the last submit did not register the webhook, or `null`.
   *
   * B-244 — before this, a refused registration was invisible here. The request resolved `null`
   * (B-235), the page treated that as success, closed the dialog and refreshed the list. The user
   * left believing events would arrive at a URL the server never accepted. With the failure
   * arriving as an error the dialog now stays open, and this is what tells them WHY.
   */
  errorMessage?: string | null;
  description: string;
  events: readonly EventoDeWebhook[];
  /** Exemplo mostrado no campo de URL — o caminho difere por domínio. */
  exampleUrl?: string;
  exampleLabel?: string;
}

/**
 * A regra: URL absoluta em http(s), rótulo não vazio, ao menos um evento.
 *
 * Exportada para que o teste a exercite diretamente, sem montar o diálogo — as faixas de uma
 * validação são o tipo de coisa que se cobre mal por clique.
 */
export function canRegisterWebhook(input: {
  url: string;
  label: string;
  eventos: ReadonlySet<string>;
}): boolean {
  return (
    /^https?:\/\//i.test(input.url) && input.label.trim() !== '' && input.eventos.size > 0
  );
}

export function AddWebhookDialog({
  open,
  onClose,
  submitting,
  onSubmit,
  errorMessage = null,
  description,
  events,
  exampleUrl = 'https://hook.example.com/events',
  exampleLabel = 'prod-events',
}: AddWebhookDialogProps) {
  const idFormulario = useId();
  const idUrl = useId();
  const idLabel = useId();
  const primeiroEvento = events[0]?.id ?? '';
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set([primeiroEvento]));

  const reset = () => {
    setUrl('');
    setLabel('');
    setSelected(new Set([primeiroEvento]));
  };
  const handleClose = () => {
    if (!submitting) {
      reset();
      onClose();
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    onSubmit({ url, label: label.trim(), events: Array.from(selected) });
  };

  const submitDisabled =
    submitting || !canRegisterWebhook({ url, label, eventos: selected });

  return (
    <AppModal
      open={open}
      onClose={handleClose}
      title={<>Add webhook</>}
      description={<>{description}</>}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={idFormulario} disabled={submitDisabled}>
            {submitting ? 'Adding…' : 'Add webhook'}
          </Button>
        </>
      }
    >
      <form id={idFormulario} className="space-y-4" onSubmit={submit}>
        {errorMessage !== null && errorMessage !== '' ? (
          <Alert intent="warning" title="Could not add webhook" description={errorMessage} />
        ) : null}
        <div>
          <label htmlFor={idUrl} className="text-sm font-medium block mb-1">
            URL
          </label>
          <Input
            id={idUrl}
            placeholder={exampleUrl}
            value={url}
            onChange={(e) => { setUrl(e.target.value); }}
          />
        </div>
        <div>
          <label htmlFor={idLabel} className="text-sm font-medium block mb-1">
            Label
          </label>
          <Input
            id={idLabel}
            placeholder={exampleLabel}
            value={label}
            onChange={(e) => { setLabel(e.target.value); }}
            maxLength={64}
          />
        </div>
        <fieldset>
          <legend className="text-sm font-medium mb-2">Events</legend>
          <div className="space-y-2">
            {events.map((evt) => (
              <label key={evt.id} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={selected.has(evt.id)}
                  onCheckedChange={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(evt.id)) next.delete(evt.id);
                      else next.add(evt.id);
                      return next;
                    });
                  }}
                  aria-label={evt.id}
                />
                <span className="font-mono text-sm">{evt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </AppModal>
  );
}
