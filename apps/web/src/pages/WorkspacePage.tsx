import { PageHeader } from '../components/ui/index.ts';
import { useMe } from '../lib/session.ts';

/** @rfc RFC-13 R2 */
export function WorkspacePage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Workspace" description={`Welcome, ${me.user.name}.`} />
      <p className="text-sm text-mist-500">Research data arrives in the next release.</p>
    </>
  );
}
