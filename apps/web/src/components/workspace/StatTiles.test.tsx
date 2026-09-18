import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatTiles } from './StatTiles.tsx';

describe('RFC-71 R4 StatTiles', () => {
  it('renders one labelled tile per pair, in the order given', () => {
    render(
      <StatTiles
        label="Summary"
        tiles={[
          { label: 'Records', value: 12 },
          { label: 'Contests', value: 2 },
          { label: 'Accepted', value: 4 },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Summary' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Records');
    expect(items[0]).toHaveTextContent('12');
    expect(items[2]).toHaveTextContent('Accepted');
    expect(items[2]).toHaveTextContent('4');
  });

  it('separates the thousands of a large count', () => {
    render(<StatTiles label="Summary" tiles={[{ label: 'Records', value: 12345 }]} />);
    expect(screen.getByText('12,345')).toBeInTheDocument();
  });

  it('renders a zero as a zero, not as nothing', () => {
    render(<StatTiles label="Summary" tiles={[{ label: 'Disputes', value: 0 }]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
