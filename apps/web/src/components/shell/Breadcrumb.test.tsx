import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BreadcrumbProvider, useBreadcrumb, useCrumbs } from './Breadcrumb.tsx';

function Reader() {
  const crumbs = useCrumbs();
  return <div data-testid="crumbs">{crumbs.map((c) => c.label).join('|')}</div>;
}

function Registrar({ label }: { label: string }) {
  // A fresh array literal every render — the effect dependency must not be
  // the array itself, or a context consumer like this one loops forever.
  useBreadcrumb([{ label }]);
  return null;
}

describe('RFC-13 R3 Breadcrumb context', () => {
  it('registers crumbs a sibling reads through useCrumbs, and clears them on unmount', () => {
    function Wrapper({ show }: { show: boolean }) {
      return (
        <BreadcrumbProvider>
          <Reader />
          {show ? <Registrar label="Anathallis funerea" /> : null}
        </BreadcrumbProvider>
      );
    }
    const { rerender } = render(<Wrapper show={true} />);
    expect(screen.getByTestId('crumbs')).toHaveTextContent('Anathallis funerea');
    rerender(<Wrapper show={false} />);
    expect(screen.getByTestId('crumbs')).toHaveTextContent('');
  });

  it('does not loop when the caller re-renders with a fresh array literal of the same content', () => {
    function Parent() {
      const [n, setN] = useState(0);
      useBreadcrumb([{ label: 'X' }]);
      return (
        <>
          <button type="button" onClick={() => setN((v) => v + 1)}>
            bump
          </button>
          <span data-testid="n">{n}</span>
        </>
      );
    }
    render(
      <BreadcrumbProvider>
        <Parent />
        <Reader />
      </BreadcrumbProvider>,
    );
    act(() => screen.getByText('bump').click());
    act(() => screen.getByText('bump').click());
    expect(screen.getByTestId('n')).toHaveTextContent('2');
    expect(screen.getByTestId('crumbs')).toHaveTextContent('X');
  });
});
