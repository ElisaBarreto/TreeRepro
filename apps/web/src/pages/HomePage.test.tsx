import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomePage } from './HomePage.tsx';

describe('RFC-10 R3 HomePage', () => {
  it('renders the product name', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'TreeRepro' })).toBeInTheDocument();
  });
});
