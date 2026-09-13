import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Emblem } from './Emblem.tsx';

describe('RFC-13 R5 Emblem', () => {
  it('is a named image sized by the prop', () => {
    render(<Emblem size={40} />);
    const img = screen.getByRole('img', { name: /TreeRepro/ });
    expect(img).toHaveAttribute('width', '40');
    expect(img).toHaveAttribute('height', '40');
    expect(img).not.toHaveAttribute('style');
  });

  it('two emblems on one page keep their gradient ids apart', () => {
    const { container } = render(
      <>
        <Emblem size={40} />
        <Emblem size={72} />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
