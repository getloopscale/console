import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KEDAToggle } from './keda-toggle';

describe('KEDAToggle', () => {
  it('test_starter_shows_upgrade_cta_and_disables_toggle', () => {
    render(<KEDAToggle enabled={false} planTier="starter" onChange={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/Pro plan required/i)).toBeInTheDocument();
    const upgradeLink = document.querySelector('a[href="/billing"]');
    expect(upgradeLink).not.toBeNull();
    expect(upgradeLink?.textContent).toMatch(/Upgrade to Pro/i);
  });

  it('test_pro_enables_toggle', () => {
    render(<KEDAToggle enabled={false} planTier="pro" onChange={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeDisabled();
    expect(screen.queryByText(/Pro plan required/i)).toBeNull();
  });

  it('test_enterprise_eligible_like_pro_and_team', () => {
    render(<KEDAToggle enabled={true} planTier="enterprise" onChange={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).not.toBeDisabled();
    expect(checkbox.checked).toBe(true);
  });

  // M16: the component must NOT leak internal terms nor assert unobservable
  // cluster state. Scale-to-zero cluster availability is enforced server-side.
  it('never leaks internal terms (KEDA / cluster) into user-facing copy', () => {
    const { container } = render(<KEDAToggle enabled={false} planTier="pro" onChange={vi.fn()} />);
    expect(container.textContent).not.toMatch(/KEDA/i);
    expect(container.textContent).not.toMatch(/cluster/i);
  });
});
