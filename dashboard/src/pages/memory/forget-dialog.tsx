import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';

/**
 * Forget-memory confirmation (extracted from memories.tsx on 2026-07-23 for the
 * 300-line module budget — behavior unchanged). DESIGN.md danger-zone
 * choreography: confirmationPhrase = the memory id; hard-delete (GDPR) opt-in.
 */
export function ForgetMemoryDialog({
  memory,
  hardDelete,
  onHardDeleteChange,
  pending,
  onConfirm,
  onClose,
}: {
  memory: { id: string; content: string };
  hardDelete: boolean;
  onHardDeleteChange: (v: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Forget memory ${memory.id.slice(0, 12)}…`}
      description={
        <div className="space-y-2 text-sm">
          <p className="font-mono bg-muted p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
            {memory.content.length > 600 ? `${memory.content.slice(0, 600)}…` : memory.content}
          </p>
          <p>
            This memory will be {hardDelete ? 'permanently erased' : 'forgotten'}. Your agent
            will no longer recall it.
          </p>
          <label className="flex items-start gap-2 text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={hardDelete}
              onChange={(e) => onHardDeleteChange(e.target.checked)}
              aria-label="Permanently erase (GDPR, cannot be recovered)"
            />
            <span>
              Permanently erase (GDPR). Skips the soft-delete audit trail — this cannot be
              recovered.
            </span>
          </label>
        </div>
      }
      confirmLabel={pending ? 'Forgetting…' : hardDelete ? 'Permanently erase' : 'Forget memory'}
      cancelLabel="Cancel"
      intent="destructive"
      confirmationPhrase={memory.id}
      loading={pending}
      onConfirm={onConfirm}
    />
  );
}
