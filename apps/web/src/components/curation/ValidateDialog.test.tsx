import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { SPECIES } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { SOURCES_NOT_READY } from './errors.ts';
import { ValidateDialog } from './ValidateDialog.tsx';

const curation = vi.hoisted(() => ({
  resolveDoi: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
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
  curation.invalidateAfterRecordWrite.mockClear();
});

function mount(write = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  renderWithProviders(
    withRouter(
      <ValidateDialog subject="dioecious" speciesId={SPECIES.id} write={write} onClose={onClose} />,
    ),
    { me: ME },
  );
  return { write, onClose };
}

describe('RFC-70 R4 ValidateDialog', () => {
  it('asks the question and validates with no reference, then closes', async () => {
    const { write, onClose } = mount();
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    expect(
      within(dialog).getByText('Do you confirm that this record is correct?'),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText('This will be recorded as your personal observation'),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(write).toHaveBeenCalledWith({});
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalledWith(expect.anything(), SPECIES.id);
  });

  it('sends the one supporting DOI once it resolved', async () => {
    curation.resolveDoi.mockResolvedValue(RESOLVABLE);
    const { write } = mount();
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    expect(await within(dialog).findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith({ referenceSource: { doi: DOI } }));
  });

  it('refuses to send while the DOI has not resolved', async () => {
    curation.resolveDoi.mockResolvedValue({ status: 'not_found', reference: null });
    const { write } = mount();
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'DOI' }), DOI);
    await userEvent.tab();
    await within(dialog).findByText('DOI not found');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    expect(
      within(dialog).getByText('Each DOI must resolve before the record can be added.'),
    ).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  it('RFC-80 R4 drops the not-resolved alert once the DOI resolves', async () => {
    curation.resolveDoi
      .mockResolvedValueOnce({ status: 'not_found', reference: null })
      .mockResolvedValue(RESOLVABLE);
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    const doi = within(dialog).getByRole('textbox', { name: 'DOI' });
    await userEvent.type(doi, `${DOI}x`);
    await userEvent.tab();
    await within(dialog).findByText('DOI not found');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    expect(within(dialog).getByText(SOURCES_NOT_READY)).toBeInTheDocument();
    await userEvent.clear(doi);
    await userEvent.type(doi, DOI);
    await userEvent.tab();
    expect(await within(dialog).findByText('Resolved: Seed size (2023)')).toBeInTheDocument();
    expect(within(dialog).queryByText(SOURCES_NOT_READY)).not.toBeInTheDocument();
  });

  it('RFC-13 R6 shows the API refusal and stays open', async () => {
    const write = vi.fn().mockRejectedValue(new ApiError(409, 'SOMETHING_ELSE', 'x'));
    const { onClose } = mount(write);
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    expect(await within(dialog).findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
