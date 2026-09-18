import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DoiField } from './DoiField.tsx';

function mount(props: Partial<Parameters<typeof DoiField>[0]> = {}) {
  const onChange = vi.fn();
  const onBlur = vi.fn();
  const utils = render(
    <DoiField
      id="doi-0"
      value=""
      onChange={onChange}
      check={{ status: 'idle' }}
      onBlur={onBlur}
      {...props}
    />,
  );
  return { onChange, onBlur, ...utils };
}

describe('RFC-80 R4 DoiField', () => {
  it('is labelled DOI, or by the number the field gave it', () => {
    const { unmount } = mount();
    expect(screen.getByRole('textbox', { name: 'DOI' })).toBeInTheDocument();
    unmount();
    mount({ label: 'DOI 2' });
    expect(screen.getByRole('textbox', { name: 'DOI 2' })).toBeInTheDocument();
  });

  it('keeps an empty live region while there is nothing to say', () => {
    mount();
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
  });

  it('says a check is running', () => {
    mount({ value: '10.1111/geb.13000', check: { status: 'checking' } });
    expect(screen.getByRole('status')).toHaveTextContent('Checking…');
    expect(screen.getByRole('textbox', { name: /doi/i })).not.toHaveAttribute('aria-invalid');
  });

  it('reports what was typed and asks for a check on blur', async () => {
    const { onChange, onBlur } = mount();
    const input = screen.getByRole('textbox', { name: /doi/i });
    await userEvent.type(input, '1');
    expect(onChange).toHaveBeenCalledWith('1');
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('shows the resolved reference', () => {
    mount({ value: '10.1111/geb.13000', check: { status: 'ok', label: 'Seed size (2023)' } });
    expect(screen.getByRole('status')).toHaveTextContent('Resolved: Seed size (2023)');
  });

  it('shows that the DOI is not in the registry', () => {
    mount({ value: '10.1111/nope', check: { status: 'not_found' } });
    expect(screen.getByText('DOI not found')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /doi/i })).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows that the DOI is malformed', () => {
    mount({ value: 'not-a-doi', check: { status: 'malformed' } });
    expect(screen.getByText('Malformed DOI')).toBeInTheDocument();
  });

  it('shows that the check itself failed', () => {
    mount({ value: '10.1111/geb.13000', check: { status: 'failed' } });
    expect(screen.getByText('Could not check the DOI — try again')).toBeInTheDocument();
  });

  it('shows the field error the API named', () => {
    mount({ value: '10.1111/geb.13000', error: 'This DOI is already listed.' });
    expect(screen.getByText('This DOI is already listed.')).toBeInTheDocument();
  });

  it('offers a remove button only when the row can be removed', async () => {
    const onRemove = vi.fn();
    const { unmount } = mount();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    unmount();
    mount({ onRemove });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
