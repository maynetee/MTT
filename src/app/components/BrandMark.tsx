import { useId } from "react";

/** The app icon (a poker chip whose inlay is a clock), drawn inline at a small size. */
export function BrandMark({ size = 32 }: { size?: number }) {
  // useId() contains colons, which url(#...) references cannot hold.
  const gradient = `brand-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="100 100 824 824" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#172A4F" />
          <stop offset="1" stopColor="#0C1631" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="184" fill={`url(#${gradient})`} />
      <circle cx="512" cy="524" r="300" fill="#B8741A" />
      <circle cx="512" cy="512" r="300" fill="#F3A83B" />
      <circle cx="512" cy="512" r="268" fill="none" stroke="#0C1631" strokeWidth="64" strokeDasharray="94 186.649" transform="rotate(-100.05 512 512)" />
      <circle cx="512" cy="512" r="208" fill="#FBF4E6" />
      <path d="M512 512 L512 362 A150 150 0 0 1 641.9 587 Z" fill="#F3A83B" />
      <line x1="512" y1="512" x2="631.5" y2="581" stroke="#0C1631" strokeWidth="30" strokeLinecap="round" />
      <circle cx="512" cy="512" r="30" fill="#0C1631" />
    </svg>
  );
}
