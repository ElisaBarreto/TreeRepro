import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  DICTIONARY,
  DICTIONARY_SEXUAL_SYSTEM,
  MAP_RESULT,
  PENDING_GROUPS,
  SEED_MASS,
} from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { MapDialog } from './MapDialog.tsx';

const curation = vi.hoisted(() => ({
  mapPending: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));

const LEVELS = DICTIONARY[0]?.traits[0]?.levels ?? [];
const GROUP = PENDING_GROUPS[0] as (typeof PENDING_GROUPS)[number];
const me = { ...ME, permissions: ['dataset.read', 'records.create'] } as never;

beforeEach(() => {
  curation.mapPending.mockReset().mockResolvedValue(MAP_RESULT);
  curation.invalidateAfterRecordWrite.mockClear();
});

describe('RFC-65 R9 MapDialog', () => {
  it('maps a categorical group to the chosen active levels', async () => {
    const onMapped = vi.fn();
    renderWithProviders(
      <MapDialog
        trait={DICTIONARY_SEXUAL_SYSTEM}
        levels={LEVELS}
        group={GROUP}
        onClose={() => undefined}
        onMapped={onMapped}
      />,
      { me },
    );
    const dialog = await screen.findByRole('dialog', { name: /map "dioecious "/i });
    expect(within(dialog).getByText(/2 records/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: 'polygamous' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Map records' }));
    expect(within(dialog).getByText('Choose at least one level.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /note/i }), 'Trailing space');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Map records' }));
    await waitFor(() =>
      expect(curation.mapPending).toHaveBeenCalledWith({
        traitId: DICTIONARY_SEXUAL_SYSTEM.id,
        valueText: 'dioecious ',
        value: { levelIds: ['018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12'] },
        note: 'Trailing space',
      }),
    );
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalled();
    expect(onMapped).toHaveBeenCalledWith(MAP_RESULT);
  });

  it('shows a traitId API error under the summary line', async () => {
    curation.mapPending.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_FAILED', 'x', [
        { path: 'traitId', message: 'Trait is inactive' },
      ]),
    );
    renderWithProviders(
      <MapDialog
        trait={DICTIONARY_SEXUAL_SYSTEM}
        levels={LEVELS}
        group={GROUP}
        onClose={() => undefined}
        onMapped={() => undefined}
      />,
      { me },
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'dioecious' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Map records' }));
    const message = await within(dialog).findByText('Trait is inactive');
    expect(message.previousElementSibling).toHaveTextContent(/sexual system · 2 records/);
  });

  it('maps a quantitative group to a number and shows API errors', async () => {
    curation.mapPending.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_FAILED', 'x', [
        { path: 'value.numeric', message: 'Number is out of range' },
      ]),
    );
    renderWithProviders(
      <MapDialog
        trait={SEED_MASS}
        levels={[]}
        group={{ ...GROUP, valueText: 'ca. 12', harmonisation: 'not_numeric' }}
        onClose={() => undefined}
        onMapped={() => undefined}
      />,
      { me },
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: /number/i }), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Map records' }));
    expect(await within(dialog).findByText('Number is out of range')).toBeInTheDocument();
    expect(curation.mapPending).toHaveBeenCalledWith({
      traitId: SEED_MASS.id,
      valueText: 'ca. 12',
      value: { numeric: 12 },
    });
  });
});
