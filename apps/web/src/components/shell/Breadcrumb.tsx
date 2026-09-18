import {
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * A trailing breadcrumb segment a page registers through `useBreadcrumb`.
 * The last item of the full trail (Group › Entry › crumbs…) is text; every
 * other item with a `to` renders as a link.
 * @rfc RFC-13 R3
 */
export interface Crumb {
  label: ReactNode;
  to?: string;
  search?: Record<string, unknown>;
}

interface BreadcrumbContextValue {
  crumbs: Crumb[];
  setCrumbs: (crumbs: Crumb[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

function useBreadcrumbContext(): BreadcrumbContextValue {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) {
    throw new Error('useBreadcrumb/useCrumbs must be used within a BreadcrumbProvider');
  }
  return ctx;
}

/**
 * Holds the trailing breadcrumb crumbs a page registers through
 * `useBreadcrumb`. Wraps the whole shell body — above the header that reads
 * `useCrumbs` — so a page nested under `<main>` can reach it.
 * @rfc RFC-13 R3
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

// A label may be a string or a React element (species names render in
// `<em>`); this pulls out its text so it can key the registration effect
// below without depending on the label's object identity.
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return '';
}

/**
 * Registers `crumbs` as the shell's trailing breadcrumb segments while the
 * calling component is mounted, resetting to `[]` on unmount. Safe to call
 * with a fresh array literal on every render: the registering effect keys
 * on a JSON snapshot of the labels' text and links, not on array identity,
 * so a caller re-rendering with equivalent crumbs does not loop.
 * @rfc RFC-13 R3
 */
export function useBreadcrumb(crumbs: Crumb[]): void {
  const { setCrumbs } = useBreadcrumbContext();
  const key = JSON.stringify(crumbs.map((c) => [textOf(c.label), c.to ?? null, c.search ?? null]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is a stable, content-based snapshot of `crumbs`; depending on `crumbs` itself would re-fire on every render of a caller that passes a fresh array literal. `setCrumbs` is the context's `useState` setter, stable across renders.
  useEffect(() => {
    setCrumbs(crumbs);
    return () => setCrumbs([]);
  }, [key]);
}

/**
 * The trailing breadcrumb segments currently registered; read by `AppShell`.
 * @rfc RFC-13 R3
 */
export function useCrumbs(): Crumb[] {
  return useBreadcrumbContext().crumbs;
}
