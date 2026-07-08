import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';

import { Alert } from './alert-guard';

describe('AlertGuard (renders children as body — closes #175)', () => {
  it('renders a children body (the @usetheo/ui Alert silently drops it)', () => {
    render(<Alert intent="warning" title="Could not resolve">the specific failure detail</Alert>);
    expect(screen.getByText('Could not resolve')).toBeInTheDocument();
    expect(screen.getByText('the specific failure detail')).toBeInTheDocument(); // the #175 fix
  });

  it('renders a JSX children body intact (trace id / badge)', () => {
    render(
      <Alert intent="warning" title="Could not load this trace">
        <span className="font-mono">tr-abc-123</span> is unavailable
      </Alert>,
    );
    expect(screen.getByText('tr-abc-123')).toBeInTheDocument();
  });

  it('prefers an explicit description and does not double-render children', () => {
    render(
      <Alert intent="warning" title="T" description="the description">
        the children
      </Alert>,
    );
    expect(screen.getByText('the description')).toBeInTheDocument();
    expect(screen.queryByText('the children')).not.toBeInTheDocument(); // description wins
  });
});
