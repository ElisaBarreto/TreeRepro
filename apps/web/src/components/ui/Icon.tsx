const PATHS = {
  home: 'M3.5 9.5 10 4l6.5 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-4V17H4.5a1 1 0 0 1-1-1z',
  leaf: 'M4 16C4 9 8.5 4.5 16 4.5 16 12 11.5 16 4 16zM4 16l6.5-6.5',
  list: 'M4 5.5h12M4 10h12M4 14.5h8',
  book: 'M3.5 4.5h5A2.5 2.5 0 0 1 11 7v9.5a2 2 0 0 0-2-2H3.5zM16.5 4.5h-5A2.5 2.5 0 0 0 9 7v9.5a2 2 0 0 1 2-2h5.5z',
  upload: 'M10 13V4M6 8l4-4 4 4M3.5 13.5v2A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5v-2',
  sliders:
    'M3.5 6h2M9.5 6h7M3.5 14h7M14.5 14h2M9.5 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14.5 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  users:
    'M11 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM2.5 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5M13.5 4.5a3 3 0 0 1 0 5M15 12.5c1.5.8 2.5 2.5 2.5 4.5',
  shield: 'M10 2.5l6 2.5v5c0 3.5-2.5 6-6 7.5-3.5-1.5-6-4-6-7.5V5z',
  clipboard:
    'M5.5 3.5h9A1.5 1.5 0 0 1 16 5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16V5a1.5 1.5 0 0 1 1.5-1.5zM7 3.5V2.5h6v1M7 8.5h6M7 12h4',
  chevronRight: 'M8 5l5 5-5 5',
  arrowLeft: 'M16 10H4M9 5l-5 5 5 5',
  arrowRight: 'M4 10h12M11 5l5 5-5 5',
  close: 'M5 5l10 10M15 5L5 15',
  logout:
    'M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H8',
  check: 'M4 10.5l4 4 8-8',
  info: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM10 9v5M10 6.5v.5',
  alert: 'M10 3.5 17.5 16.5h-15zM10 8.5v3.5M10 14.5v.5',
  branch:
    'M6 4v12M6 8c0 3 8 1 8 5M7.5 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM15.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM7.5 16a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
} as const;

export type IconName = keyof typeof PATHS;

/**
 * Stroke icons on a 20px grid, one style everywhere; decorative by default
 * (a labelled control carries the name, not the icon).
 * @rfc RFC-13 R5
 */
export function Icon({
  name,
  size = 20,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
