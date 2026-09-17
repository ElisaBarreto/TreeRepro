import { Link } from '@tanstack/react-router';
import { type FocusEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

export interface HelpTipProps {
  /** Overrides the trigger's default `aria-label` ("What does this mean?"). */
  label?: string;
  children: ReactNode;
  /** Route to a fuller explanation, rendered as a "Learn more" link (plan 12a). */
  learnMore?: string;
}

/**
 * A `?` popover, not a dialog — it never joins the modal stack and nothing
 * outside it becomes `inert` (RFC-13 R10). The trigger button toggles a
 * `role="tooltip"` element it names through `aria-controls`/`aria-expanded`;
 * it opens on click, on focus and on pointer hover, and closes on Escape, on
 * a pointerdown outside the component, and once focus leaves it entirely —
 * the blur handler checks `relatedTarget` against the component's own
 * subtree so moving focus from the trigger into the popover (its "Learn
 * more" link) does not close it. Its content is plain React children, never
 * HTML from the API.
 * @rfc RFC-13 R11
 */
export function HelpTip({ label, children, learnMore }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  function onBlur(event: FocusEvent<HTMLSpanElement>) {
    if (!(event.relatedTarget instanceof Node) || !rootRef.current?.contains(event.relatedTarget)) {
      setOpen(false);
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: groups hover/focus for the popover; the real interactive control is the button below, keyboard-operable on its own
    <span
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={onBlur}
    >
      <button
        type="button"
        aria-label={label ?? 'What does this mean?'}
        aria-expanded={open}
        aria-controls={open ? tooltipId : undefined}
        onClick={() => setOpen(true)}
        className="inline-flex size-5 items-center justify-center rounded-full text-mist-400 transition-colors hover:bg-mist-50 hover:text-canopy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
      >
        <Icon name="help" size={16} />
      </button>
      {open ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute left-0 top-full mt-1 z-20 w-72 rounded-[10px] border border-canopy-700/15 bg-white p-3 text-meta shadow"
        >
          {children}
          {learnMore ? (
            <Link
              to={learnMore}
              className="mt-2 inline-block font-medium text-canopy-900 underline-offset-2 hover:underline"
            >
              Learn more
            </Link>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
