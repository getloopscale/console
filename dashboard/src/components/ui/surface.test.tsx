import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@/test/render';
import { Globe } from 'lucide-react';
import { Row, Rows, Stats, Surface } from './surface';

describe('Surface', () => {
  it('is a named region with its title, count and action on the title strip', () => {
    render(
      <Surface title="Domains" icon={Globe} count={2} action={<a href="/all">View all</a>}>
        <p>body</p>
      </Surface>,
    );
    const region = screen.getByRole('region', { name: 'Domains' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Domains' })).toBeInTheDocument();
    expect(within(region).getByText('2')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'View all' })).toBeInTheDocument();
    expect(within(region).getByText('body')).toBeInTheDocument();
  });

  it('has no title strip when it has no title', () => {
    render(
      <Surface label="Live URL">
        <p>body</p>
      </Surface>,
    );
    const region = screen.getByRole('region', { name: 'Live URL' });
    // The body is the first thing in the box: no strip comes before it.
    expect(region.firstElementChild).toHaveTextContent('body');
    expect(region.firstElementChild?.tagName).toBe('P');
  });

  it('lists rows with title, meta and trail', () => {
    render(
      <Surface title="Apps">
        <Rows label="Apps">
          <Row title="web" meta="server" trail="2 replicas" />
          <Row title="worker" meta="worker" />
        </Rows>
      </Surface>,
    );
    const items = within(screen.getByRole('list', { name: 'Apps' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('web');
    expect(items[0]).toHaveTextContent('server');
    expect(items[0]).toHaveTextContent('2 replicas');
  });

  it('shows figures as terms and values', () => {
    render(<Stats label="Health" items={[{ label: 'Replicas ready', value: '2 / 2' }, { label: 'Deploy status', value: 'succeeded', note: '13 hours ago' }]} />);
    const stats = screen.getByLabelText('Health');
    expect(within(stats).getByText('Replicas ready').tagName).toBe('DT');
    expect(within(stats).getByText('2 / 2').tagName).toBe('DD');
    expect(within(stats).getByText('13 hours ago')).toBeInTheDocument();
  });
});
