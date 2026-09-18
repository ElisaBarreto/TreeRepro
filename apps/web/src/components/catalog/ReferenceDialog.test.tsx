import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReferenceDetail } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { REFERENCE_DETAIL } from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { ReferenceDialog } from './ReferenceDialog.tsx';

const catalog = vi.hoisted(() => ({
  createReference: vi.fn(),
  updateReference: vi.fn(),
  invalidateAfterCatalogWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

beforeEach(() => {
  catalog.createReference.mockReset();
  catalog.updateReference.mockReset();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

function mount(reference?: ReferenceDetail) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(
    <ReferenceDialog reference={reference} onClose={onClose} onSaved={onSaved} />,
  );
  return {
    dialog: screen.getByRole('dialog', { name: reference ? 'Edit reference' : 'New reference' }),
    onClose,
    onSaved,
  };
}

describe('RFC-61 R6 ReferenceDialog', () => {
  it('creates with the citation key alone, omitting empty optionals', async () => {
    catalog.createReference.mockResolvedValue(REFERENCE_DETAIL);
    const { dialog, onSaved } = mount();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /citation key/i }),
      'Smith2001',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    await waitFor(() =>
      expect(catalog.createReference).toHaveBeenCalledWith({ citationKey: 'Smith2001' }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(
      expect.anything(),
      'references',
    );
    expect(onSaved).toHaveBeenCalledWith(REFERENCE_DETAIL);
  });

  it('creates with every field, the year as a number', async () => {
    catalog.createReference.mockResolvedValue(REFERENCE_DETAIL);
    const { dialog } = mount();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /citation key/i }),
      'Smith2001',
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /^title/i }),
      'Breeding systems',
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: /authors/i }), 'Smith, J.');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: /year/i }), '2001');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /journal/i }), 'JTE');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /doi/i }), '10.1000/x');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /url/i }),
      'https://example.org',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    await waitFor(() =>
      expect(catalog.createReference).toHaveBeenCalledWith({
        citationKey: 'Smith2001',
        title: 'Breeding systems',
        authors: 'Smith, J.',
        year: 2001,
        journal: 'JTE',
        doi: '10.1000/x',
        url: 'https://example.org',
      }),
    );
  });

  it('creates with a short and full citation, trimmed', async () => {
    catalog.createReference.mockResolvedValue(REFERENCE_DETAIL);
    const { dialog } = mount();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /citation key/i }),
      'Smith2001',
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /short citation/i }),
      '  Smith & Doe (2001)  ',
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /full citation/i }),
      'Smith, J.; Doe, A. (2001). Breeding systems.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    await waitFor(() =>
      expect(catalog.createReference).toHaveBeenCalledWith({
        citationKey: 'Smith2001',
        shortCitation: 'Smith & Doe (2001)',
        fullCitation: 'Smith, J.; Doe, A. (2001). Breeding systems.',
      }),
    );
  });

  it('edit: prefills the short and full citation and sends null when either is emptied', async () => {
    catalog.updateReference.mockResolvedValue(REFERENCE_DETAIL);
    const cited: ReferenceDetail = {
      ...REFERENCE_DETAIL,
      shortCitation: 'Smith & Doe (2001)',
      fullCitation: 'Smith, J.; Doe, A. (2001). Breeding systems.',
    };
    const { dialog } = mount(cited);
    expect(within(dialog).getByRole('textbox', { name: /short citation/i })).toHaveValue(
      'Smith & Doe (2001)',
    );
    expect(within(dialog).getByRole('textbox', { name: /full citation/i })).toHaveValue(
      'Smith, J.; Doe, A. (2001). Breeding systems.',
    );
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /short citation/i }));
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /full citation/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateReference).toHaveBeenCalledWith(cited.id, {
        shortCitation: null,
        fullCitation: null,
      }),
    );
  });

  it('edit: prefilled; sends only the changed fields, null for an emptied one; unchanged closes without a request', async () => {
    catalog.updateReference.mockResolvedValue(REFERENCE_DETAIL);
    const first = mount(REFERENCE_DETAIL);
    expect(within(first.dialog).getByRole('textbox', { name: /citation key/i })).toHaveValue(
      'Smith2001',
    );
    expect(within(first.dialog).getByRole('spinbutton', { name: /year/i })).toHaveValue(2001);
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Save' }));
    expect(catalog.updateReference).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    const second = mount(REFERENCE_DETAIL);
    const journal = within(second.dialog).getByRole('textbox', { name: /journal/i });
    await userEvent.clear(journal);
    const year = within(second.dialog).getByRole('spinbutton', { name: /year/i });
    await userEvent.clear(year);
    await userEvent.type(year, '2002');
    await userEvent.click(within(second.dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateReference).toHaveBeenCalledWith(REFERENCE_DETAIL.id, {
        year: 2002,
        journal: null,
      }),
    );
  });

  it('an emptied citation key is a local error; REFERENCE_KEY_TAKEN and REFERENCE_DOI_TAKEN land under their fields', async () => {
    const { dialog } = mount(REFERENCE_DETAIL);
    const key = within(dialog).getByRole('textbox', { name: /citation key/i });
    await userEvent.clear(key);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter a citation key.')).toBeInTheDocument();
    expect(catalog.updateReference).not.toHaveBeenCalled();
    await userEvent.type(key, 'Doe2001');
    catalog.updateReference.mockRejectedValueOnce(
      new ApiError(409, 'REFERENCE_KEY_TAKEN', 'taken'),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('A reference with this citation key already exists.'),
    ).toBeInTheDocument();
    catalog.updateReference.mockRejectedValueOnce(
      new ApiError(409, 'REFERENCE_DOI_TAKEN', 'taken'),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Another reference has this DOI.')).toBeInTheDocument();
  });

  it('shows a VALIDATION_FAILED field message without the Alert alongside it', async () => {
    catalog.updateReference.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'bad', [{ path: 'title', message: 'Too long' }]),
    );
    const { dialog } = mount(REFERENCE_DETAIL);
    const title = within(dialog).getByRole('textbox', { name: /^title/i });
    await userEvent.clear(title);
    await userEvent.type(title, 'A new title');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Too long')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a local validation error clears a stale API Alert from the previous attempt', async () => {
    catalog.createReference.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    const { dialog } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /citation key/i }), 'Key');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /citation key/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    expect(within(dialog).getByText('Enter a citation key.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a year outside 1500–2100 is refused locally with the schema message', async () => {
    const { dialog } = mount();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /citation key/i }), 'X');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: /year/i }), '1200');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    expect(within(dialog).getByRole('spinbutton', { name: /year/i })).toHaveAccessibleDescription(
      /1500/,
    );
    expect(catalog.createReference).not.toHaveBeenCalled();
  });
});
