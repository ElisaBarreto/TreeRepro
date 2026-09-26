import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VoteButton } from './VoteButton.tsx';

describe('RFC-13 R5 VoteButton', () => {
  it('is named by its label, shows it as a tooltip, and keeps the icon out of the name', async () => {
    const onClick = vi.fn();
    render(
      <VoteButton icon="thumbsUp" label="Validate dioecious for sexual system" onClick={onClick} />,
    );
    const button = screen.getByRole('button', { name: 'Validate dioecious for sexual system' });
    expect(button).toHaveAttribute('title', 'Validate dioecious for sexual system');
    expect(button.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
