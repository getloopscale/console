// app-modal.test.tsx
//
// M14 T1 — AppModal is the system-wide standardized modal primitive. It wraps
// @usetheo/ui's Dialog (Radix) and adds a size token + a title/description/body/
// footer contract. The upstream Dialog owns focus-trap / ESC / overlay / a11y —
// these tests pin THIS wrapper's contract:
//   - renders title as the dialog's accessible name + body when open
//   - renders nothing when open=false
//   - size token maps to the right max-width class on the content
//   - footer content renders
//   - description renders when provided
//   - ESC routes to onClose (delegated to Radix onOpenChange(false))

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { AppModal } from './app-modal';

describe('AppModal — standardized modal primitive', () => {
  it('renders the title as the dialog accessible name + body when open', () => {
    render(
      <AppModal open onClose={() => {}} title="New folder">
        <p>body content here</p>
      </AppModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Radix labels the dialog via Dialog.Title → accessible name.
    expect(dialog).toHaveAccessibleName(/new folder/i);
    expect(screen.getByText(/body content here/i)).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    render(
      <AppModal open={false} onClose={() => {}} title="Hidden modal">
        <p>hidden body</p>
      </AppModal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden body/i)).not.toBeInTheDocument();
  });

  it('maps size="xl" to the max-w-4xl content width', () => {
    render(
      <AppModal open onClose={() => {}} title="Wide" size="xl">
        <p>wide body</p>
      </AppModal>,
    );
    expect(screen.getByRole('dialog').className).toContain('max-w-4xl');
  });

  it('defaults to the md width when size is omitted', () => {
    render(
      <AppModal open onClose={() => {}} title="Default">
        <p>default body</p>
      </AppModal>,
    );
    expect(screen.getByRole('dialog').className).toContain('max-w-lg');
  });

  it('renders the footer slot', () => {
    render(
      <AppModal open onClose={() => {}} title="With footer" footer={<button>Create folder</button>}>
        <p>body</p>
      </AppModal>,
    );
    expect(screen.getByRole('button', { name: /create folder/i })).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <AppModal open onClose={() => {}} title="Titled" description="a helpful description">
        <p>body</p>
      </AppModal>,
    );
    expect(screen.getByText(/a helpful description/i)).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed (delegated to Dialog)', () => {
    const onClose = vi.fn();
    render(
      <AppModal open onClose={onClose} title="Closable">
        <p>body</p>
      </AppModal>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
