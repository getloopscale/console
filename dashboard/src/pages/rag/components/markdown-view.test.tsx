import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';

import { MarkdownView } from './markdown-view';

describe('MarkdownView (KB1 reading foundation)', () => {
  it('renders markdown headings and lists as real HTML, not plain text', () => {
    render(<MarkdownView source={'# Title\n\n- one\n- two'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
  });

  it('renders GitHub-flavored tables (remark-gfm)', () => {
    const md = ['| Name | Role |', '| --- | --- |', '| Ada | Eng |'].join('\n');
    render(<MarkdownView source={md} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Ada' })).toBeInTheDocument();
  });

  it('renders a fenced code block as a copyable code block (KB10)', () => {
    const md = ['```bash', 'loopscale deploy --env prod', '```'].join('\n');
    render(<MarkdownView source={md} />);
    const block = screen.getByTestId('kb-code-block');
    expect(block).toBeInTheDocument();
    expect(block).toHaveTextContent('loopscale deploy --env prod');
    // a copy control exists inside the block (KB10 DoD)
    expect(block.querySelector('button')).not.toBeNull();
  });

  it('keeps inline code inline — not a code block (KB10 negative case)', () => {
    const { container } = render(<MarkdownView source={'run `loopscale login` first'} />);
    expect(screen.queryByTestId('kb-code-block')).toBeNull();
    expect(container.querySelector('code')).not.toBeNull();
  });

  it('sanitizes embedded scripts (XSS invariant — negative case)', () => {
    const { container } = render(
      <MarkdownView source={'ok <script>window.__pwned = 1</script> text'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('renders nothing for empty/whitespace content', () => {
    const { container } = render(<MarkdownView source={'   '} />);
    expect(container.querySelector('[data-testid="kb-markdown"]')).toBeNull();
  });
});
