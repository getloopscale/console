// confirm-dialog.tsx
//
// Canonical destructive-action confirmation dialog — a CENTERED modal.
//
// Was a re-export of `@usetheo/ui`'s ConfirmDialog, but that primitive is built on the
// library's `Dialog`, which in @usetheo/ui@0.28.2 renders as a lateral SHEET (drawer)
// because `Dialog` and `Sheet` share one object and `Sheet.Content` clobbers
// `Dialog.Content`. This local implementation is built on the local centered `Dialog`
// (Radix) so every confirmation is a traditional centered modal. The public props match
// the previous upstream contract exactly, so no call site changes shape:
//   open / onOpenChange · title · description · confirmLabel · cancelLabel ·
//   intent: "default" | "destructive" · confirmationPhrase (type-to-confirm gate) ·
//   onConfirm: () => void | Promise<void> (loading state managed here) · loading

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Input } from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  intent?: 'default' | 'destructive';
  confirmationPhrase?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

/**
 * ConfirmDialog — centered confirmation modal. Focuses Cancel on open (deliberate — never
 * the destructive button). `confirmationPhrase` gates confirm behind exact type-to-confirm.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  intent = 'default',
  confirmationPhrase,
  onConfirm,
  loading,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setTyped('');
      // Focus Cancel on open, not the destructive action.
      const t = setTimeout(() => cancelRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const phraseRequired = !!confirmationPhrase;
  const phraseOk = !phraseRequired || typed === confirmationPhrase;
  const pending = busy || !!loading;
  const canConfirm = phraseOk && !pending;

  const confirm = async () => {
    if (!canConfirm) return;
    try {
      setBusy(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    // `size="sm"` é `max-w-md` — a MESMA largura que este arquivo declarava como
    // `className`. A migração não muda um pixel; ela tira a largura do call site
    // e a põe na escala, que é o ponto do plano.
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={intent === 'destructive' ? 'destructive' : 'primary'}
            onClick={() => void confirm()}
            disabled={!canConfirm}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmLabel}
          </Button>
        </>
      }
    >
      {phraseRequired ? (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Type <span className="font-mono font-medium text-foreground">{confirmationPhrase}</span> to confirm.
          </p>
          <Input
            autoComplete="off"
            placeholder={confirmationPhrase}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirm();
            }}
            aria-label="Type to confirm"
          />
        </div>
      ) : null}
    </AppModal>
  );
}
