/** Master Ball logo, drawn as inline SVG (no external asset). */
export function MasterBall({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="Master Ball">
      <defs>
        <linearGradient id="mb-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a35ee8" />
          <stop offset="1" stopColor="#6a2fb5" />
        </linearGradient>
        <linearGradient id="mb-bottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9dbe6" />
        </linearGradient>
        <clipPath id="mb-clip">
          <circle cx="50" cy="50" r="46" />
        </clipPath>
      </defs>
      <g clipPath="url(#mb-clip)">
        <rect x="0" y="0" width="100" height="50" fill="url(#mb-top)" />
        <rect x="0" y="50" width="100" height="50" fill="url(#mb-bottom)" />
        {/* pink side bumps */}
        <circle cx="22" cy="30" r="11" fill="#e85fa8" />
        <circle cx="78" cy="30" r="11" fill="#e85fa8" />
        {/* M */}
        <path d="M36 38 L36 18 L50 30 L64 18 L64 38 L57 38 L57 31 L50 37 L43 31 L43 38 Z" fill="#ffffff" />
        {/* band */}
        <rect x="0" y="45" width="100" height="10" fill="#1c1830" />
      </g>
      <circle cx="50" cy="50" r="46" fill="none" stroke="#1c1830" strokeWidth="5" />
      <circle cx="50" cy="50" r="13" fill="#1c1830" />
      <circle cx="50" cy="50" r="8" fill="#ffffff" />
      <circle cx="47" cy="47" r="2.5" fill="#ffffff" opacity="0.9" />
      {/* shine */}
      <ellipse cx="33" cy="15" rx="9" ry="4" fill="#ffffff" opacity="0.25" transform="rotate(-25 33 15)" />
    </svg>
  );
}

export const MASTER_BALL_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><clipPath id="c"><circle cx="50" cy="50" r="46"/></clipPath><g clip-path="url(#c)"><rect width="100" height="50" fill="#8a45d6"/><rect y="50" width="100" height="50" fill="#fff"/><circle cx="22" cy="30" r="11" fill="#e85fa8"/><circle cx="78" cy="30" r="11" fill="#e85fa8"/><path d="M36 38V18l14 12 14-12v20h-7v-7l-7 6-7-6v7z" fill="#fff"/><rect y="45" width="100" height="10" fill="#1c1830"/></g><circle cx="50" cy="50" r="46" fill="none" stroke="#1c1830" stroke-width="5"/><circle cx="50" cy="50" r="13" fill="#1c1830"/><circle cx="50" cy="50" r="8" fill="#fff"/></svg>',
  );
