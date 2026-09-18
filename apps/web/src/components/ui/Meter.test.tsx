import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Meter } from './Meter.tsx';

describe('RFC-72 R3 Meter', () => {
  it('renders a native meter carrying the value, max and label', () => {
    render(<Meter value={30} max={50} label="Coverage with data" />);
    const meter = screen.getByRole('meter', { name: 'Coverage with data' });
    expect(meter.tagName).toBe('METER');
    expect(meter).toHaveAttribute('value', '30');
    expect(meter).toHaveAttribute('max', '50');
  });

  it('writes the rounded percentage as text beside the meter', () => {
    render(<Meter value={1} max={3} label="Coverage" />);
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('reads 0% rather than dividing by zero when max is 0', () => {
    render(<Meter value={0} max={0} label="Coverage" />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('carries no inline style attribute', () => {
    const { container } = render(<Meter value={2} max={4} label="Coverage" />);
    for (const el of container.querySelectorAll('*')) {
      expect(el.getAttribute('style')).toBeNull();
    }
  });
});
