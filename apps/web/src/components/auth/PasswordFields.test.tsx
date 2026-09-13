import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PasswordFields, readPasswords } from './PasswordFields.tsx';

describe('RFC-13 R6 PasswordFields', () => {
  it('renders password and confirmation with the policy hint and field errors', () => {
    render(
      <form>
        <PasswordFields
          ids={{ password: 'p', confirm: 'c' }}
          errors={{ password: 'Use at least 12 characters' }}
        />
      </form>,
    );
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(
      screen.getByText('At least 12 characters; a passphrase works well.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Use at least 12 characters')).toBeInTheDocument();
  });

  it('readPasswords reads both values', () => {
    const form = new FormData();
    form.set('password', 'abc');
    form.set('confirm', 'abd');
    expect(readPasswords(form)).toEqual({ password: 'abc', confirm: 'abd' });
  });
});
