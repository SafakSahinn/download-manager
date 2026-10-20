export default function Logo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="flux-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#flux-g)" />
      <path d="M16 7v11m0 0l-5-5m5 5l5-5M9 24h14" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
