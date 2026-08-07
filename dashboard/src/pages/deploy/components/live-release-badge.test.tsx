import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveReleaseBadge } from './live-release-badge';

describe('LiveReleaseBadge', () => {
  it('shows nothing when neither live nor commit known', () => {
    const { container } = render(<LiveReleaseBadge isLive={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows Serving label + commit + url when live', () => {
    render(
      <LiveReleaseBadge
        isLive={true}
        commitShort="e6001ec"
        activeSince="2026-06-18T14:30:00Z"
        liveUrl="https://app.example.com"
      />,
    );
    const badge = screen.getByTestId('live-release-badge');
    expect(badge.getAttribute('data-state')).toBe('serving');
    expect(badge.textContent).toContain('Serving');
    expect(badge.textContent).toContain('e6001ec');
    expect(badge.textContent).toContain('app.example.com');
  });

  it('shows Rolling out… label when not yet live', () => {
    render(<LiveReleaseBadge isLive={false} commitShort="abc1234" />);
    const badge = screen.getByTestId('live-release-badge');
    expect(badge.getAttribute('data-state')).toBe('rolling-out');
    expect(badge.textContent).toContain('Rolling out');
  });

  it('renders commit as link when repoUrl provided', () => {
    render(
      <LiveReleaseBadge
        isLive={true}
        commitShort="e6001ec"
        repoUrl="https://github.com/usetheodev/theokit-example.git"
      />,
    );
    const link = screen.getByRole('link', { name: /e6001ec/i });
    expect(link.getAttribute('href')).toBe(
      'https://github.com/usetheodev/theokit-example/commit/e6001ec',
    );
  });

  it('omits ArgoCD / internal terms (Cross-Project Rule 9)', () => {
    render(
      <LiveReleaseBadge
        isLive={true}
        commitShort="e6001ec"
        liveUrl="https://app.example.com"
        activeSince="2026-06-18T14:30:00Z"
      />,
    );
    const badge = screen.getByTestId('live-release-badge');
    for (const term of ['ArgoCD', 'argocd', 'sync', 'pod', 'kubectl', 'Kubernetes']) {
      expect(badge.textContent).not.toContain(term);
    }
  });
});
