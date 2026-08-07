// doc-theme-toggle.test.tsx
//
// The wiki page content has its own theme (System / White), a global preference. These
// tests pin the toggle's behavior + that MarkdownView honors the theme.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { DocThemeToggle } from './doc-theme-toggle';
import { setDocTheme } from '@/hooks/rag/use-doc-theme';
import { MarkdownView } from '@/components/common/markdown-view';

describe('DocThemeToggle — global document theme', () => {
  beforeEach(() => setDocTheme('system')); // reset the shared preference

  it('defaults to System pressed', () => {
    render(<DocThemeToggle />);
    expect(screen.getByRole('button', { name: /system/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /white/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to White on click and persists', () => {
    render(<DocThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /white/i }));
    expect(screen.getByRole('button', { name: /white/i })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('theo:wiki:doc-theme')).toBe('white');
  });

  it('two toggles stay in sync (shared global preference)', () => {
    render(
      <>
        <DocThemeToggle />
        <DocThemeToggle />
      </>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /white/i })[0]);
    // both toggles reflect White
    for (const b of screen.getAllByRole('button', { name: /white/i })) {
      expect(b).toHaveAttribute('aria-pressed', 'true');
    }
  });
});

describe('MarkdownView — theme', () => {
  it('white theme renders on a light paper surface with dark ink (contrast)', () => {
    render(<MarkdownView source="# hi" theme="white" />);
    const el = screen.getByTestId('kb-markdown').className;
    expect(el).toContain('bg-white');
    // prose-doc-white re-binds the prose colours to dark ink (the app-token bind would be light).
    expect(el).toContain('prose-doc-white');
  });

  it('system theme uses inverted prose (no white surface)', () => {
    render(<MarkdownView source="# hi" theme="system" />);
    const el = screen.getByTestId('kb-markdown');
    expect(el.className).toContain('dark:prose-invert');
    expect(el.className).not.toContain('bg-white');
  });
});
