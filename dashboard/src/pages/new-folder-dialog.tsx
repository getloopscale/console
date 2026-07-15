import { Button, Dialog, Input, Label } from '@usetheo/ui';

interface Props {
  open: boolean;
  prefix: string;
  name: string;
  error: string | null;
  creating: boolean;
  onNameChange: (v: string) => void;
  onCreate: () => void;
  onClose: () => void;
}

/**
 * In-app New-folder dialog (extracted from workspace.tsx for the LoC budget).
 * Replaces the native window.prompt — an Input with inline validation.
 */
export function NewFolderDialog({ open, prefix, name, error, creating, onNameChange, onCreate, onClose }: Props) {
  const invalid = name.includes('/');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>New folder</Dialog.Title>
          <Dialog.Description>
            Create a folder{prefix ? <> in <span className="font-mono">{prefix.replace(/\/$/, '')}</span></> : ' at the workspace root'}.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <div className="space-y-1.5">
            <Label htmlFor="new-folder-name">Folder name</Label>
            <Input
              id="new-folder-name"
              autoFocus
              placeholder="e.g. images"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onCreate(); }}
            />
            {invalid && <p className="text-xs text-destructive">Folder names can’t contain “/”.</p>}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onCreate} disabled={creating || !name.trim() || invalid}>
            {creating ? 'Creating…' : 'Create folder'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
