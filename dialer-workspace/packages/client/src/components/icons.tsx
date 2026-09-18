import type { ReactNode } from 'react';

/** Stroke-only 16px glyphs, matching the prototype's icon set. */
const PATHS: Record<string, ReactNode> = {
  eye: (
    <>
      <path d="M1.3 8S4 3.3 8 3.3 14.7 8 14.7 8 12 12.7 8 12.7 1.3 8 1.3 8Z" />
      <circle cx="8" cy="8" r="2.1" />
    </>
  ),
  edit: (
    <>
      <path d="M11.4 2.3l2.3 2.3-8 8-3 .7.7-3 8-8Z" />
      <path d="M10 3.7l2.3 2.3" />
    </>
  ),
  trash: (
    <>
      <path d="M2.3 4.3h11.4" />
      <path d="M6 4.3V2.3h4v2" />
      <path d="M3.7 4.3l.8 9.4h7l.8-9.4" />
    </>
  ),
  copy: (
    <>
      <rect x="5.7" y="5.7" width="8" height="8" rx="1.4" />
      <path d="M11 5.7V3.7A1.4 1.4 0 0 0 9.6 2.3H3.7A1.4 1.4 0 0 0 2.3 3.7v5.9A1.4 1.4 0 0 0 3.7 11h2" />
    </>
  ),
  upload: (
    <>
      <path d="M8 10.7V2.3" />
      <path d="M5 5.3 8 2.3l3 3" />
      <path d="M2.3 11.7v1.3a.7.7 0 0 0 .7.7h10a.7.7 0 0 0 .7-.7v-1.3" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.3v8.4" />
      <path d="M5 7.7 8 10.7l3-3" />
      <path d="M2.3 11.7v1.3a.7.7 0 0 0 .7.7h10a.7.7 0 0 0 .7-.7v-1.3" />
    </>
  ),
  plus: (
    <>
      <path d="M8 3.3v9.4" />
      <path d="M3.3 8h9.4" />
    </>
  ),
  sliders: (
    <>
      <path d="M2.3 5h4" />
      <path d="M9.7 5h4" />
      <path d="M2.3 11h6.4" />
      <path d="M12 11h1.7" />
      <circle cx="8" cy="5" r="1.6" />
      <circle cx="10.3" cy="11" r="1.6" />
    </>
  ),
  x: (
    <>
      <path d="M4.3 4.3l7.4 7.4" />
      <path d="M11.7 4.3l-7.4 7.4" />
    </>
  ),
  more: (
    <>
      <circle cx="3.6" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12.4" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
