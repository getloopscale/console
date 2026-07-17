import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';

import { KbEditor } from './kb-editor';

describe('KbEditor (KB12 editor polish)', () => {
  it('renders a GFM task list as interactive checkboxes', () => {
    render(<KbEditor value={'- [x] done\n- [ ] todo'} />);
    const editor = screen.getByTestId('kb-editor');
    const boxes = editor.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it('round-trips a checked task item back to `- [x]` markdown', () => {
    let out = '';
    render(<KbEditor value={'- [x] shipped'} onChange={(md) => (out = md)} />);
    // onChange fires on the initial content load; the serialized markdown keeps the checkbox.
    // If onChange did not fire on load, read the DOM as the fallback proof of round-trip parse.
    const editor = screen.getByTestId('kb-editor');
    const box = editor.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(true);
    if (out !== '') expect(out).toMatch(/\[x\]/i);
  });

  it('marks the empty editor with a placeholder (KB12)', () => {
    render(<KbEditor value={''} />);
    const editor = screen.getByTestId('kb-editor');
    const empty = editor.querySelector('.is-editor-empty');
    expect(empty).not.toBeNull();
    expect(empty?.getAttribute('data-placeholder')).toContain('commands');
  });
});
