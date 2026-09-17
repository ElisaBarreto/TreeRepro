import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { REFERENCE } from '../../test/dataset-fixtures.ts';
import { SourcesField, type SourcesValue, sourcesToBody } from './SourcesField.tsx';

const curation = vi.hoisted(() => ({ resolveDoi: vi.fn() }));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));

const DOI = '10.1111/geb.13000';
const RESOLVABLE = {
  status: 'resolvable',
  reference: null,
  preview: { title: 'Seed size', authors: 'Moles, A.', year: 2023, journal: 'GEB' },
};

beforeEach(() => {
  curation.resolveDoi.mockReset();
});

function Harness({
  onValidity,
  errors = {},
}: {
  onValidity: (ready: boolean) => void;
  errors?: Record<string, string>;
}) {
  const [value, setValue] = useState<SourcesValue>({ dois: [''] });
  return <SourcesField value={value} onChange={setValue} errors={errors} onValidity={onValidity} />;
}

function mount(errors: Record<string, string> = {}) {
  const onValidity = vi.fn();
  render(<Harness onValidity={onValidity} errors={errors} />);
  return { onValidity };
}

function doiRow(index = 0): HTMLElement {
  const rows = screen.getAllByRole('textbox', { name: /doi/i });
  return rows[index] as HTMLElement;
}

describe('RFC-70 R1 SourcesField', () => {
  it('explains once, however many rows there are, that a blank field is own field work', async () => {
    mount();
    const hint =
      'Leave blank if this comes from your own field work or expert knowledge; otherwise give the DOI.';
    expect(screen.getAllByText(hint)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'What does this mean?' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Add another reference' }));
    expect(screen.getAllByRole('textbox', { name: /doi/i })).toHaveLength(2);
    expect(screen.getAllByText(hint)).toHaveLength(1);
    // The rows are told apart, so each input can be addressed on its own.
    expect(screen.getByRole('textbox', { name: 'DOI' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'DOI 2' })).toBeInTheDocument();
  });

  it('starts with one blank row that means a personal observation', () => {
    const { onValidity } = mount();
    expect(screen.getAllByRole('textbox', { name: /doi/i })).toHaveLength(1);
    expect(
      screen.getByText('This will be recorded as your personal observation'),
    ).toBeInTheDocument();
    expect(onValidity).toHaveBeenLastCalledWith(true);
    expect(curation.resolveDoi).not.toHaveBeenCalled();
  });

  it('tells a form that subscribes again what the readiness is, even unchanged', async () => {
    const heard = vi.fn();
    function Form() {
      const [value, setValue] = useState<SourcesValue>({ dois: [''] });
      const [, rerender] = useState(0);
      return (
        <>
          <button type="button" onClick={() => rerender((n) => n + 1)}>
            Reset the form
          </button>
          <SourcesField
            value={value}
            onChange={setValue}
            errors={{}}
            onValidity={(ready) => heard(ready)}
          />
        </>
      );
    }
    render(<Form />);
    expect(heard.mock.calls).toEqual([[true]]);
    await userEvent.click(screen.getByRole('button', { name: 'Reset the form' }));
    expect(heard.mock.calls).toEqual([[true], [true]]);
  });

  it('checks a DOI once when the row loses focus and shows what resolved', async () => {
    curation.resolveDoi.mockResolvedValue(RESOLVABLE);
    const { onValidity } = mount();
    await userEvent.type(doiRow(), DOI);
    await userEvent.tab();
    expect(await screen.findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    expect(curation.resolveDoi).toHaveBeenCalledWith(DOI);
    expect(curation.resolveDoi).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText('This will be recorded as your personal observation'),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(onValidity).toHaveBeenLastCalledWith(true));

    // The row is blurred again with the same value: the check it already
    // holds is reused, no second request.
    await userEvent.click(doiRow());
    await userEvent.tab();
    expect(curation.resolveDoi).toHaveBeenCalledTimes(1);
  });

  it('names a known reference by its title and year', async () => {
    curation.resolveDoi.mockResolvedValue({
      status: 'known',
      reference: { ...REFERENCE, title: 'Breeding systems of tropical trees', year: 2001 },
    });
    mount();
    await userEvent.type(doiRow(), DOI);
    await userEvent.tab();
    expect(
      await screen.findByText('Resolved: Breeding systems of tropical trees (2001)'),
    ).toBeInTheDocument();
  });

  it('blocks the form while a DOI is not in the registry', async () => {
    curation.resolveDoi.mockResolvedValue({ status: 'not_found', reference: null });
    const { onValidity } = mount();
    await userEvent.type(doiRow(), DOI);
    await userEvent.tab();
    expect(await screen.findByText('DOI not found')).toBeInTheDocument();
    await waitFor(() => expect(onValidity).toHaveBeenLastCalledWith(false));
  });

  it('reads a rejected DOI as malformed and a failed lookup as a failed check', async () => {
    curation.resolveDoi.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid input'),
    );
    const { onValidity } = mount();
    await userEvent.type(doiRow(), 'nope');
    await userEvent.tab();
    expect(await screen.findByText('Malformed DOI')).toBeInTheDocument();
    await waitFor(() => expect(onValidity).toHaveBeenLastCalledWith(false));

    curation.resolveDoi.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await userEvent.clear(doiRow());
    await userEvent.type(doiRow(), DOI);
    await userEvent.tab();
    expect(await screen.findByText('Could not check the DOI — try again')).toBeInTheDocument();
    await waitFor(() => expect(onValidity).toHaveBeenLastCalledWith(false));
  });

  it('asks again after a failed check, but not after an answer', async () => {
    curation.resolveDoi.mockRejectedValueOnce(
      new ApiError(503, 'DOI_LOOKUP_FAILED', 'The registry is unreachable'),
    );
    const { onValidity } = mount();
    await userEvent.type(doiRow(), DOI);
    await userEvent.tab();
    expect(await screen.findByText('Could not check the DOI — try again')).toBeInTheDocument();
    await waitFor(() => expect(onValidity).toHaveBeenLastCalledWith(false));

    // The registry is back: leaving the unchanged row asks again.
    curation.resolveDoi.mockResolvedValue(RESOLVABLE);
    await userEvent.click(doiRow());
    await userEvent.tab();
    expect(await screen.findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    expect(curation.resolveDoi).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onValidity).toHaveBeenLastCalledWith(true));

    // An answer, however, is kept: a third blur asks nothing.
    await userEvent.click(doiRow());
    await userEvent.tab();
    expect(curation.resolveDoi).toHaveBeenCalledTimes(2);
  });

  it('keeps a not_found answer instead of asking the registry again', async () => {
    curation.resolveDoi.mockResolvedValue({ status: 'not_found', reference: null });
    mount();
    await userEvent.type(doiRow(), DOI);
    await userEvent.tab();
    expect(await screen.findByText('DOI not found')).toBeInTheDocument();
    await userEvent.click(doiRow());
    await userEvent.tab();
    expect(curation.resolveDoi).toHaveBeenCalledTimes(1);
  });

  it('adds reference rows up to ten and removes them again', async () => {
    mount();
    const add = screen.getByRole('button', { name: 'Add another reference' });
    await userEvent.click(add);
    expect(screen.getAllByRole('textbox', { name: /doi/i })).toHaveLength(2);
    for (let i = 2; i < 10; i += 1) await userEvent.click(add);
    expect(screen.getAllByRole('textbox', { name: /doi/i })).toHaveLength(10);
    expect(screen.queryByRole('button', { name: 'Add another reference' })).not.toBeInTheDocument();
    const removes = screen.getAllByRole('button', { name: 'Remove' });
    await userEvent.click(removes[0] as HTMLElement);
    expect(screen.getAllByRole('textbox', { name: /doi/i })).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'Add another reference' })).toBeInTheDocument();
  });

  it('keeps a filled row checked while another row is added', async () => {
    curation.resolveDoi.mockResolvedValue(RESOLVABLE);
    mount();
    await userEvent.type(doiRow(), DOI);
    await userEvent.tab();
    expect(await screen.findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add another reference' }));
    expect(screen.getByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    expect(curation.resolveDoi).toHaveBeenCalledTimes(1);
  });

  it('shows the API error of a row under that row', async () => {
    mount({ 'sources.references.0.doi': 'This DOI is already listed.' });
    await userEvent.type(doiRow(), DOI);
    expect(screen.getByText('This DOI is already listed.')).toBeInTheDocument();
  });
});

describe('RFC-70 R1 sourcesToBody', () => {
  it('drops the blank rows and trims what is left', () => {
    expect(sourcesToBody({ dois: ['', ' 10.1/x '] })).toEqual({ references: [{ doi: '10.1/x' }] });
  });

  it('reads no DOI at all as a personal observation', () => {
    expect(sourcesToBody({ dois: [''] })).toEqual({ personalObservation: true });
  });
});
