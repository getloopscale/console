// tag-input.test.tsx — the wiki tag entry field.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { userEvent } from '@testing-library/user-event';
import { TagInput } from './tag-input';

describe('TagInput — add / remove / recolor', () => {
  it('adds a tag on Enter', async () => {
    const onChange = vi.fn();
    render(<TagInput value="" onChange={onChange} />);
    const input = screen.getByLabelText(/page tags/i);
    await userEvent.type(input, 'api');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('api');
  });

  it('adds a tag when a comma is typed', async () => {
    const onChange = vi.fn();
    render(<TagInput value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/page tags/i), 'auth,');
    expect(onChange).toHaveBeenCalledWith('auth');
  });

  it('renders existing tags as chips and removes one via its X', async () => {
    const onChange = vi.fn();
    render(<TagInput value="api, auth" onChange={onChange} />);
    expect(screen.getByRole('button', { name: /change colour of api/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /remove auth/i }));
    expect(onChange).toHaveBeenCalledWith('api');
  });

  it('Backspace on empty input removes the last tag', async () => {
    const onChange = vi.fn();
    render(<TagInput value="api, auth" onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText(/page tags/i), { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith('api');
  });

  it('clicking a chip opens the colour picker; picking a colour is remembered', async () => {
    render(<TagInput value="api" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /change colour of api/i }));
    // palette popover appears with swatches
    const swatch = await screen.findByRole('option', { name: /blue for api/i });
    await userEvent.click(swatch);
    // re-render: the chip now reflects blue (assert the override took by reopening the picker)
    await userEvent.click(screen.getByRole('button', { name: /change colour of api/i }));
    expect(screen.getByRole('option', { name: /blue for api/i })).toHaveAttribute('aria-selected', 'true');
  });
});
