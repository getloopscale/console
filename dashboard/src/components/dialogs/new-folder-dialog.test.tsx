// new-folder-dialog.test.tsx
//
// M14 T2 — pins the NewFolderDialog contract so its rebuild onto AppModal is a
// safe refactor (behavior + props unchanged; shared by wiki + workspace).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { NewFolderDialog } from '@/components/dialogs/new-folder-dialog';

const base = {
  open: true,
  prefix: '',
  error: null as string | null,
  creating: false,
  onNameChange: () => {},
  onCreate: () => {},
  onClose: () => {},
};

describe('NewFolderDialog — contract preserved across the AppModal rebuild', () => {
  it('renders the New folder title when open', () => {
    render(<NewFolderDialog {...base} name="" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName(/new folder/i);
  });

  it('is not rendered when closed', () => {
    render(<NewFolderDialog {...base} open={false} name="" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejects a name containing "/" — shows the error and disables Create', () => {
    render(<NewFolderDialog {...base} name="a/b" />);
    expect(screen.getByText(/can.?t contain/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create folder/i })).toBeDisabled();
  });

  it('calls onCreate when the primary button is clicked with a valid name', () => {
    const onCreate = vi.fn();
    render(<NewFolderDialog {...base} name="images" onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: /create folder/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('calls onCreate on Enter in the input', () => {
    const onCreate = vi.fn();
    render(<NewFolderDialog {...base} name="images" onCreate={onCreate} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<NewFolderDialog {...base} name="" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces a server error when provided', () => {
    render(<NewFolderDialog {...base} name="images" error="Could not create the folder. Try again." />);
    expect(screen.getByText(/could not create the folder/i)).toBeInTheDocument();
  });
});
