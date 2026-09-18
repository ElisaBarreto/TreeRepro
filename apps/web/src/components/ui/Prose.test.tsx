import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HELP_TOPICS } from '../../content/help/index.ts';
import { withRouter } from '../../test/router.tsx';
import { Prose } from './Prose.tsx';

describe('RFC-13 R5 Prose', () => {
  it('styles its children through a class, never a style attribute', () => {
    const { container } = render(
      <Prose>
        <h2 id="contest">Contest</h2>
        <p>Body.</p>
      </Prose>,
    );
    const article = container.querySelector('article');
    expect(article).not.toBeNull();
    expect(article).toHaveClass('prose-treerepro');
  });

  it('keeps the heading ids the topic body wrote, so an anchor link lands', () => {
    render(
      <Prose>
        <h2 id="contest">Contest</h2>
      </Prose>,
    );
    expect(screen.getByRole('heading', { name: 'Contest' })).toHaveAttribute('id', 'contest');
  });

  // The real bodies, not a two-element fixture: RFC-13 R5 is a rule about the
  // markup that actually ships, and a topic author reaching for a `style`
  // attribute is exactly what it forbids.
  it('RFC-13 R5 renders every help topic with no inline style anywhere', async () => {
    expect(HELP_TOPICS.length).toBeGreaterThan(0);
    for (const topic of HELP_TOPICS) {
      const { container, unmount } = render(withRouter(<Prose>{topic.body}</Prose>));
      // The bodies link to one another, so they mount under a router, which
      // renders on its own tick.
      const headings = await screen.findAllByRole('heading', { level: 2 });
      expect(headings.length, `${topic.slug} renders no section heading`).toBeGreaterThan(0);
      expect(
        container.querySelectorAll('[style]'),
        `${topic.slug} carries an inline style attribute`,
      ).toHaveLength(0);
      unmount();
    }
  });
});
