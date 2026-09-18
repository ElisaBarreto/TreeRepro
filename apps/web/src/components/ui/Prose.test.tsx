import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('keeps the heading ids the topic body wrote, so an anchor link lands', () => {
    render(
      <Prose>
        <h2 id="contest">Contest</h2>
      </Prose>,
    );
    expect(screen.getByRole('heading', { name: 'Contest' })).toHaveAttribute('id', 'contest');
  });
});
