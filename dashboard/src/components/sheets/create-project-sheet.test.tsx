import { describe, it, expect, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/lib/api', () => ({
  engineFetch: vi.fn(),
}));

import { CreateProjectSheet } from './create-project-sheet';

describe('CreateProjectSheet — Red Team theo-cloud#59/#82 closure', () => {
  // Repro per #82/#59 verbatim: the dialog Description exposed
  // "lands in a future iter" — internal roadmap jargon that doesn't
  // belong in user-facing copy (per Cross-Project Rule 9 + `.claude/
  // rules/public-copy.md`). It also referenced a "GitHub picker +
  // framework detect wizard" the user has no context for.
  it('description does not expose internal roadmap jargon', () => {
    render(<CreateProjectSheet open={true} onOpenChange={() => {}} />);
    // RED #82/#59: these tokens MUST NOT appear in the visible copy.
    expect(screen.queryByText(/future iter/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/GitHub picker/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/framework detect/i)).not.toBeInTheDocument();
  });

  // Negative-axis: the user-facing title "New project" + form scaffolding
  // stay in place (UI not gutted by the copy fix).
  it('preserves form title + project-name input', () => {
    render(<CreateProjectSheet open={true} onOpenChange={() => {}} />);
    // Form title is a Sheet.Title.
    expect(
      screen.getByRole('heading', { name: /new project/i }),
    ).toBeInTheDocument();
    // Name input still present.
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
  });

  // Red Team theo-cloud#83 closure: the input MUST be programmatically
  // linked to its validation error so screen readers announce the error
  // when the field has focus. Before this fix the error was in a
  // detached Alert region — sighted users could see it but AT users
  // got nothing.
  it('ties input to inline error via aria-invalid + aria-describedby (#83)', async () => {
    const user = userEvent.setup();
    render(<CreateProjectSheet open={true} onOpenChange={() => {}} />);
    const input = screen.getByLabelText(/project name/i) as HTMLInputElement;
    // Type a string that fails the slug regex (too short).
    await user.type(input, 'AB');
    // Click submit → validator MUST emit the destructive error.
    await user.click(screen.getByRole('button', { name: /create project/i }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // aria-describedby MUST mention the error region id.
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toMatch(/project-name-error/);
  });
});
