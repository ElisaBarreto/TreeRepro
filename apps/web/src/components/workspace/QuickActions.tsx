import { Link, type LinkProps } from '@tanstack/react-router';
import { buttonClassName } from '../ui/Button.tsx';
import { Icon, type IconName } from '../ui/Icon.tsx';

// The outlined pill of the dark intro card: the kit's `secondary` is white
// on white, which the canopy-950 ground has no use for.
const OUTLINE_ON_DARK =
  'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-mist-50/35 px-5 font-display text-cell font-semibold whitespace-nowrap text-mist-50 transition-colors hover:bg-mist-50/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';

const ACTIONS: readonly { to: LinkProps['to']; label: string; icon: IconName }[] = [
  { to: '/app/species', label: 'Browse species', icon: 'leaf' },
  { to: '/app/traits', label: 'Browse traits', icon: 'list' },
  { to: '/app/references', label: 'Browse references', icon: 'book' },
];

/**
 * The dashboard's three ways into the dataset (RFC-72 R3, spec R-18): the
 * species list, the trait dictionary and the references, each unfiltered.
 * Drawn for the dark intro card it sits in: species as the amber primary
 * pill, the other two outlined; each carries the sidebar's icon for it.
 * @rfc RFC-72 R3
 */
export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap gap-3">
      {ACTIONS.map((action, index) => (
        <Link
          key={action.label}
          to={action.to}
          className={index === 0 ? buttonClassName({ variant: 'primary' }) : OUTLINE_ON_DARK}
        >
          <Icon name={action.icon} size={18} />
          {action.label}
        </Link>
      ))}
    </nav>
  );
}
