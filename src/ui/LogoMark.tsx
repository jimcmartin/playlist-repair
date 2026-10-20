// The app's mark: a workman tapping a crooked note back into a playlist crate.
// Drawn inline like the icons, in currentColor, so the page loads nothing from outside the site.
// Sized for the gradient tile in the header; it stays legible down to about 40px.

/** Decorative: hidden from screen readers, since the app name sits beside it. */
export function LogoMark({ size = 54 }: { size?: number }) {
  return (
    <svg
      className="logo-art"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* Playlist crate */}
      <rect x="29" y="36" width="30" height="21" rx="3.5" fill="currentColor" fillOpacity="0.16" />
      <path d="M34.5 43.5h19M34.5 49.5h13" strokeOpacity="0.8" />
      {/* Notes, at three quarters size and lifted clear of the crate */}
      <g transform="translate(45 32) scale(0.75) translate(-47 -35.4)">
        <g fill="currentColor" stroke="none">
          <ellipse cx="46" cy="33" rx="3.3" ry="2.5" transform="rotate(-20 46 33)" />
          <ellipse cx="54.5" cy="30" rx="3.3" ry="2.5" transform="rotate(-20 54.5 30)" />
          <ellipse cx="38.5" cy="32.5" rx="2.6" ry="2" transform="rotate(-35 38.5 32.5)" />
        </g>
        {/* Beamed pair, standing straight */}
        <path d="M48.9 32V17.5M57.4 29V14.5" strokeWidth="3.2" />
        <path d="M48.9 17.5 57.4 14.5" strokeWidth="4.8" />
        {/* Small note, knocked crooked */}
        <path d="M40.5 31.4 37.4 21.4q4.4 1 4.6 5.4" strokeWidth="2.7" />
      </g>
      {/* Workman: hard hat with its peak to the front, head, torso, legs, arms */}
      <path d="M10.7 20a3.9 3.9 0 0 1 7.8 0Z" fill="currentColor" strokeWidth="1.6" />
      <path d="M18 20h3" strokeWidth="1.8" />
      <circle cx="14.6" cy="24.7" r="3.1" fill="currentColor" stroke="none" />
      <path d="M10.6 28.2h7.8l-1 12h-5.8Z" fill="currentColor" strokeWidth="2" />
      <path d="M12.4 40.4 8.6 55.5M16.6 40.4l3.8 15.1" strokeWidth="3" />
      <path d="M10.9 29.5 7.2 36.5M18.2 29.4l3.4-4.4 3-5" strokeWidth="2.8" />
      {/* Hammer */}
      <path d="M24.2 20.4 30 12.4" strokeWidth="2.4" />
      <path
        d="M34.55 12.86 32.45 15.54 25.85 10.34 27.95 7.66Z"
        fill="currentColor"
        strokeWidth="1.4"
      />
      {/* Impact */}
      <path d="M35 17.2l1.3-1.9M38.6 18.6l2.1-.9M33.2 19.6l-.6.5" strokeWidth="1.8" />
    </svg>
  );
}
