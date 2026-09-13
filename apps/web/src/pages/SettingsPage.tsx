import { useNavigate } from '@tanstack/react-router';
import { PasswordSection } from '../components/settings/PasswordSection.tsx';
import { ProfileSection } from '../components/settings/ProfileSection.tsx';
import { SessionsSection } from '../components/settings/SessionsSection.tsx';
import { TotpSection } from '../components/settings/TotpSection.tsx';
import { PageHeader } from '../components/ui/index.ts';

/** @rfc RFC-13 R2 */
export function SettingsPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your profile, password, two-factor authentication and sessions."
      />
      <div className="flex flex-col gap-12">
        <ProfileSection />
        <PasswordSection />
        <TotpSection />
        <SessionsSection onSignedOutEverywhere={() => navigate({ to: '/' })} />
      </div>
    </>
  );
}
