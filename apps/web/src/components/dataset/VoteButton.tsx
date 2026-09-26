import { Button, Icon } from '../ui/index.ts';

/**
 * One of the three record decisions as an icon button (spec §2): thumbsUp
 * Validate, thumbsDown Contest, plus Complement. The icon is decorative;
 * `label` names the action and its subject for assistive technology and, in
 * an app-drawn tip shown ~150 ms after hover or on keyboard focus, for the
 * sighted user — not a `title`, whose delay and font the browser owns (issue
 * #214). The tip is `aria-hidden`: it repeats the accessible name (Cross-review
 * amendment 1: no emoji, `Icon` glyphs only).
 * @rfc RFC-13 R5
 * @rfc RFC-70 R1, R4
 */
export function VoteButton({
  icon,
  label,
  onClick,
}: {
  icon: 'thumbsUp' | 'thumbsDown' | 'plus';
  label: string;
  onClick: () => void;
}) {
  return (
    <span className="group/vote relative inline-flex">
      <Button variant="secondary" size="sm" aria-label={label} onClick={onClick} className="px-3">
        <Icon name={icon} />
      </Button>
      <span
        aria-hidden="true"
        className="pointer-events-none invisible absolute right-0 bottom-full z-20 mb-1 w-max max-w-72 rounded-[10px] border border-canopy-700/15 bg-white px-3 py-2 text-body text-canopy-900 opacity-0 shadow transition-opacity group-hover/vote:visible group-hover/vote:opacity-100 group-hover/vote:delay-150 group-focus-within/vote:visible group-focus-within/vote:opacity-100 group-hover/vote:group-focus-within/vote:delay-0"
      >
        {label}
      </span>
    </span>
  );
}
