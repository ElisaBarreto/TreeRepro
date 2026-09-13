import { PasswordSection } from '../components/settings/PasswordSection.tsx';
import { ProfileSection } from '../components/settings/ProfileSection.tsx';
import { PageHeader } from '../components/ui/index.ts';

/** @rfc RFC-13 R2 */
export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your profile, password, two-factor authentication and sessions."
      />
      <div className="flex flex-col gap-12">
        <ProfileSection />
        <PasswordSection />
        <section aria-labelledby="totp-heading">
          <h2 id="totp-heading" className="font-display text-lg font-bold">
            Two-factor authentication
          </h2>
        </section>
        <section aria-labelledby="sessions-heading">
          <h2 id="sessions-heading" className="font-display text-lg font-bold">
            Sessions
          </h2>
        </section>
      </div>
    </>
  );
}
