import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { meQueryOptions } from '../lib/session.ts';
import { HomePage } from '../pages/HomePage.tsx';

/**
 * A signed-in visitor belongs in the workspace. After a sign-in the page
 * plays the landing beats of the reveal and then asks for the navigation as
 * a view transition, which carries the emblem into the sidebar (landing.css);
 * under reduced motion it asks for a plain one at once.
 * @rfc RFC-13 R2, R7
 */
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    // staleTime: 0 forces a real API check; after sign-out the cached `me`
    // entry is only removed once navigation resolves, so the 60s default
    // staleTime would still read as fresh and bounce `/` straight back here.
    const me = await context.queryClient
      .fetchQuery({ ...meQueryOptions, staleTime: 0 })
      .catch(() => null);
    if (me) throw redirect({ to: '/app' });
  },
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  return (
    <HomePage
      onSignedIn={(_user, transition) =>
        void navigate({ to: '/app', viewTransition: transition === 'reveal' })
      }
    />
  );
}
