import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { ME_QUERY_KEY } from '../../lib/session.ts';
import { ME, USER } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { ProfileSection } from './ProfileSection.tsx';

const me = vi.hoisted(() => ({ updateName: vi.fn() }));
vi.mock('../../api/me.ts', () => me);

beforeEach(() => {
  me.updateName.mockReset();
});

describe('RFC-50 R11 ProfileSection', () => {
  it('shows the email read-only, saves the name and refreshes the session', async () => {
    me.updateName.mockResolvedValue({
      ...USER,
      name: 'Ada L.',
      roles: [],
      updatedAt: USER.createdAt,
      suspendedAt: null,
    });
    const { queryClient } = renderWithProviders(<ProfileSection />, { me: ME });
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.org');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Ada L.');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Name saved.');
    expect(me.updateName).toHaveBeenCalledWith('Ada L.');
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toMatchObject({ user: { name: 'Ada L.' } });
  });

  it('rejects an empty name locally and shows a 403 inline', async () => {
    renderWithProviders(<ProfileSection />, { me: ME });
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByText('Enter a name (up to 120 characters).')).toBeInTheDocument();
    expect(me.updateName).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    me.updateName.mockRejectedValueOnce(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
  });
});
