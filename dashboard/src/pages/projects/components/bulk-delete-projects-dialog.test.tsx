import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';

vi.mock('@/hooks/projects/use-bulk-delete-projects', () => ({ useBulkDeleteProjects: vi.fn() }));

import { BulkDeleteProjectsDialog, confirmPhrase } from './bulk-delete-projects-dialog';
import { useBulkDeleteProjects } from '@/hooks/projects/use-bulk-delete-projects';

const mocked = vi.mocked(useBulkDeleteProjects);

function mockMutation(result: { succeeded: string[]; failed: { name: string; error: string }[] }) {
  const mutateAsync = vi.fn().mockResolvedValue(result);
  mocked.mockReturnValue({ mutateAsync, isPending: false } as unknown as ReturnType<typeof useBulkDeleteProjects>);
  return mutateAsync;
}

beforeEach(() => vi.clearAllMocks());

describe('confirmPhrase', () => {
  it('singular', () => expect(confirmPhrase(1)).toBe('delete 1 project'));
  it('plural', () => expect(confirmPhrase(3)).toBe('delete 3 projects'));
});

// J-07 D4 — type-to-confirm bulk delete with honest partial-failure surface.
describe('BulkDeleteProjectsDialog (J-07 D4)', () => {
  it('test_confirm_disabled_until_exact_phrase', () => {
    mockMutation({ succeeded: [], failed: [] });
    render(<BulkDeleteProjectsDialog open onOpenChange={vi.fn()} projectNames={['a', 'b']} />);
    const btn = screen.getByRole('button', { name: /delete 2 projects/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/type-to-confirm/i), { target: { value: 'delete 2 projects' } });
    expect(btn).toBeEnabled();
  });

  it('test_wrong_phrase_keeps_disabled', () => {
    mockMutation({ succeeded: [], failed: [] });
    render(<BulkDeleteProjectsDialog open onOpenChange={vi.fn()} projectNames={['a', 'b']} />);
    fireEvent.change(screen.getByLabelText(/type-to-confirm/i), { target: { value: 'delete these' } });
    expect(screen.getByRole('button', { name: /delete 2 projects/i })).toBeDisabled();
  });

  it('test_submit_calls_mutation_with_names_and_closes_on_full_success', async () => {
    const mutateAsync = mockMutation({ succeeded: ['a', 'b'], failed: [] });
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();
    render(
      <BulkDeleteProjectsDialog open onOpenChange={onOpenChange} projectNames={['a', 'b']} onDeleted={onDeleted} />,
    );
    fireEvent.change(screen.getByLabelText(/type-to-confirm/i), { target: { value: 'delete 2 projects' } });
    fireEvent.click(screen.getByRole('button', { name: /delete 2 projects/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(['a', 'b']));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('test_partial_failure_surfaces_failed_and_keeps_open', async () => {
    const mutateAsync = mockMutation({ succeeded: ['a'], failed: [{ name: 'b', error: 'ACTIVE_DEPLOY' }] });
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();
    render(
      <BulkDeleteProjectsDialog open onOpenChange={onOpenChange} projectNames={['a', 'b']} onDeleted={onDeleted} />,
    );
    fireEvent.change(screen.getByLabelText(/type-to-confirm/i), { target: { value: 'delete 2 projects' } });
    fireEvent.click(screen.getByRole('button', { name: /delete 2 projects/i }));
    // Honest partial-failure contract: the mutation ran, but the dialog does NOT
    // claim success — onDeleted is never fired and the dialog is NOT closed when a
    // project failed to delete.
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(['a', 'b']));
    // The failed project is named honestly; success is NOT claimed (stays open).
    expect(await screen.findByText(/Couldn't delete: b/i)).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
