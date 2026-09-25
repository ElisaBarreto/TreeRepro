import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROJECT_HEADLINE } from '../../content/project.ts';
import { DASHBOARD } from '../../test/dataset-fixtures.ts';
import { withRouter } from '../../test/router.tsx';
import { IntroCard } from './IntroCard.tsx';

function renderCard(name = 'Ada Lovelace') {
  render(withRouter(<IntroCard dataset={DASHBOARD.dataset} name={name} />));
  return screen.findByRole('region', { name: 'About TreeRepro' });
}

describe('RFC-72 R3 IntroCard', () => {
  it('greets the viewer by first name and heads the card with the headline as the page h1', async () => {
    await renderCard();
    expect(screen.getByText('Welcome back, Ada')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PROJECT_HEADLINE);
    expect(PROJECT_HEADLINE).toBe('Help complete what we know about how trees reproduce.');
  });

  it('greets by the whole name when it is one word', async () => {
    await renderCard('Ada');
    expect(screen.getByText('Welcome back, Ada')).toBeInTheDocument();
  });

  it('renders the description with the dataset counts substituted and the contact e-mail as a link', async () => {
    await renderCard();
    expect(
      screen.getByText(/TreeRepro is a collective data assembly of reproductive trait data/),
    ).toHaveTextContent(
      `spanning ${DASHBOARD.dataset.primaryReferenceCount} primary references, ${DASHBOARD.dataset.secondaryReferenceCount} secondary references and ${DASHBOARD.dataset.recordCount} records over ${DASHBOARD.dataset.speciesCount} species`,
    );
    const link = screen.getByRole('link', { name: 'elisabpereira@gmail.com' });
    expect(link).toHaveAttribute('href', 'mailto:elisabpereira@gmail.com');
  });

  it('lets the description take the full width of its card', async () => {
    await renderCard();
    expect(screen.getByText(/TreeRepro is a collective data assembly/)).not.toHaveClass(
      'max-w-3xl',
    );
  });

  it('holds the quick actions inside the card, under the text', async () => {
    const card = await renderCard();
    const nav = within(card).getByRole('navigation', { name: 'Quick actions' });
    const text = screen.getByText(/TreeRepro is a collective data assembly/);
    expect(text.compareDocumentPosition(nav)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows the three dataset counts, and no traits count the contract does not carry', async () => {
    const card = await renderCard();
    const list = within(card).getByRole('list', { name: 'Dataset' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list).toHaveTextContent('Species');
    expect(list).toHaveTextContent(String(DASHBOARD.dataset.speciesCount));
    expect(list).toHaveTextContent('References');
    expect(list).toHaveTextContent(String(DASHBOARD.dataset.referenceCount));
    expect(list).toHaveTextContent('Records');
    expect(list).toHaveTextContent(String(DASHBOARD.dataset.recordCount));
    expect(list).not.toHaveTextContent('Traits');
  });
});
