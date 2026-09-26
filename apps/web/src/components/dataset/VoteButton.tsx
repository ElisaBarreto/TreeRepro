import { Button, Icon } from '../ui/index.ts';

/**
 * One of the three record decisions as an icon button (spec §2): thumbsUp
 * Validate, thumbsDown Contest, plus Complement. The icon is decorative;
 * `label` names the action and its subject for assistive technology and, as
 * `title`, for the pointer (Cross-review amendment 1: no emoji, `Icon`
 * glyphs only).
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
    <Button
      variant="secondary"
      size="sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="px-3"
    >
      <Icon name={icon} />
    </Button>
  );
}
