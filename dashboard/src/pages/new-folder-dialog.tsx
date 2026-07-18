import { Button, Input, Label } from '@usetheo/ui';
import { AppModal } from '@/components/ui/app-modal';

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
 * In-app New-folder dialog. Rebuilt on the standardized `AppModal` (M14) so the Wiki
 * and Workspace "New folder" share one modal primitive; the props + behaviour are
 * unchanged (a name Input with inline validation, replacing the native window.prompt).
 */
export function NewFolderDialog({ open, prefix, name, error, creating, onNameChange, onCreate, onClose }: Props) {
  const invalid = name.includes('/');
  return (
    <AppModal
      open={open}
      onClose={onClose}
      size="sm"
      title="New folder"
      description={
        <>
          Create a folder{prefix ? <> in <span className="font-mono">{prefix.replace(/\/$/, '')}</span></> : ' at the workspace root'}.
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onCreate} disabled={creating || !name.trim() || invalid}>
            {creating ? 'Creating…' : 'Create folder'}
          </Button>
        </>
      }
    >
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
    </AppModal>
  );
}
