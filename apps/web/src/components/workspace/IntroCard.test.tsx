import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DASHBOARD } from '../../test/dataset-fixtures.ts';
import { IntroCard } from './IntroCard.tsx';

describe('RFC-72 R3 IntroCard', () => {
  it('renders the description with the dataset counts substituted and the contact e-mail as a link', () => {
    render(<IntroCard dataset={DASHBOARD.dataset} />);
    expect(
      screen.getByText(/TreeRepro is a collective data assembly of reproductive trait data/),
    ).toHaveTextContent(
      `spanning ${DASHBOARD.dataset.referenceCount} references and ${DASHBOARD.dataset.recordCount} records over ${DASHBOARD.dataset.speciesCount} species`,
    );
    const link = screen.getByRole('link', { name: 'elisabpereira@gmail.com' });
    expect(link).toHaveAttribute('href', 'mailto:elisabpereira@gmail.com');
  });

  it('shows the three dataset counts as tiles', () => {
    render(<IntroCard dataset={DASHBOARD.dataset} />);
    const list = screen.getByRole('list', { name: 'Dataset' });
    expect(list).toHaveTextContent('Species');
    expect(list).toHaveTextContent(String(DASHBOARD.dataset.speciesCount));
    expect(list).toHaveTextContent('References');
    expect(list).toHaveTextContent(String(DASHBOARD.dataset.referenceCount));
    expect(list).toHaveTextContent('Records');
    expect(list).toHaveTextContent(String(DASHBOARD.dataset.recordCount));
  });
});
