/**
 * Drawn UI icons (inline SVG) that replace emoji in the interface, so the
 * chrome looks the same on every device. Chunky flat shapes with a dark
 * outline, sized by the surrounding font (1em square).
 */
export type IconName =
  | "crown" | "sword" | "trophy" | "coin" | "gem" | "home" | "cards"
  | "sound" | "mute" | "chest" | "calendar" | "shop" | "profile" | "events"
  | "dice" | "puzzle" | "hammer" | "book" | "tv" | "star" | "shield" | "play"
  | "heart" | "bomb";

const O = 'stroke="#1a1030" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"';

const PATHS: Record<IconName, string> = {
  crown: `<path ${O} fill="#ffd23f" d="M3 17 4.5 7l4.5 4 3-6 3 6 4.5-4L21 17z"/><rect ${O} fill="#f2a31b" x="3" y="17" width="18" height="3.4" rx="1"/><circle fill="#e8413b" cx="12" cy="18.7" r="1.1"/>`,
  sword: `<path ${O} fill="#dfe7f2" d="M14.5 3H21v6.5L10.5 20 4 13.5z"/><path ${O} fill="#b87a2e" d="m3 15 6 6-2 1.5L1.5 17z"/><path ${O} fill="#ffd23f" d="m6.5 11 6.5 6.5-1.8 1.8L4.7 12.8z"/>`,
  trophy: `<path ${O} fill="#ffd23f" d="M7 3h10v5a5 5 0 0 1-10 0z"/><path ${O} fill="none" d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/><path ${O} fill="#f2a31b" d="M10 13h4v3h-4zM7.5 17h9v4h-9z"/>`,
  coin: `<circle ${O} fill="#ffd23f" cx="12" cy="12" r="9"/><circle fill="none" stroke="#f2a31b" stroke-width="1.6" cx="12" cy="12" r="6"/><path fill="#fff6c9" d="M9 7.5a6 6 0 0 1 4-1.3l-.4 1.8A4 4 0 0 0 10 9z"/>`,
  gem: `<path ${O} fill="#3ee07a" d="M6 4h12l4 6-10 11L2 10z"/><path fill="#b8ffd2" d="M6 4h6L8 10H2z"/><path fill="#1fa856" d="M12 21 16 10h6z"/>`,
  home: `<path ${O} fill="#e8413b" d="M2.5 11.5 12 3l9.5 8.5z"/><path ${O} fill="#f6e7c8" d="M5 11h14v10H5z"/><path ${O} fill="#8a5a30" d="M10 14h4v7h-4z"/>`,
  cards: `<rect ${O} fill="#4f8cff" x="3" y="5" width="11" height="15" rx="2" transform="rotate(-10 8.5 12.5)"/><rect ${O} fill="#ffd23f" x="10" y="4" width="11" height="15" rx="2" transform="rotate(8 15.5 11.5)"/>`,
  sound: `<path ${O} fill="#dfe7f2" d="M3 9h4l5-4v14l-5-4H3z"/><path ${O} fill="none" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/>`,
  mute: `<path ${O} fill="#dfe7f2" d="M3 9h4l5-4v14l-5-4H3z"/><path ${O} fill="none" stroke="#e8413b" d="m15.5 9 5 6m0-6-5 6"/>`,
  chest: `<path ${O} fill="#b87a2e" d="M3 11h18v9H3z"/><path ${O} fill="#d99a42" d="M3 11a9 6 0 0 1 18 0z"/><path ${O} fill="#ffd23f" d="M10 10h4v5h-4zM3 11h18v1.8H3z"/>`,
  calendar: `<rect ${O} fill="#f6f1e6" x="3" y="5" width="18" height="16" rx="2"/><path ${O} fill="#e8413b" d="M3 5h18v4.5H3z"/><path ${O} fill="none" d="M8 3v4M16 3v4"/><path fill="#1a1030" d="M7 12h3v3H7zM11 12h3v3h-3zM15 12h3v3h-3zM7 16h3v3H7z"/>`,
  shop: `<path ${O} fill="#e8413b" d="M3 9 5 4h14l2 5z"/><path ${O} fill="#f6e7c8" d="M4 9h16v12H4z"/><path ${O} fill="#4f8cff" d="M9 13h6v8H9z"/>`,
  profile: `<circle ${O} fill="#ffd9a8" cx="12" cy="8.5" r="4.5"/><path ${O} fill="#4f8cff" d="M3.5 21a8.5 7 0 0 1 17 0z"/>`,
  events: `<path ${O} fill="#b58aff" d="m12 2 2.8 6 6.7.7-5 4.5 1.4 6.6L12 16.4l-5.9 3.4 1.4-6.6-5-4.5L9.2 8z"/>`,
  dice: `<rect ${O} fill="#f6f1e6" x="3" y="3" width="18" height="18" rx="4"/><g fill="#1a1030"><circle cx="8" cy="8" r="1.6"/><circle cx="16" cy="8" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="8" cy="16" r="1.6"/><circle cx="16" cy="16" r="1.6"/></g>`,
  puzzle: `<path ${O} fill="#3ee07a" d="M4 8h4a2.5 2.5 0 1 1 5 0h4v4a2.5 2.5 0 1 1 0 5v4H4z"/>`,
  hammer: `<path ${O} fill="#b87a2e" d="m11 10 2.2 2.2L5 20.4 2.8 18.2z"/><path ${O} fill="#9aa7b8" d="m10 4 5-1.5 6.5 6.5L20 14l-3-1-2 2-5-5 2-2z"/>`,
  book: `<path ${O} fill="#4f8cff" d="M4 4h9a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4z"/><path ${O} fill="#e8413b" d="M20 4h-4v17a3 3 0 0 1 3-3h1z"/>`,
  tv: `<rect ${O} fill="#2d3b66" x="2.5" y="6" width="19" height="13" rx="2.5"/><path ${O} fill="none" d="m8 2 4 4 4-4"/><path fill="#ffd23f" d="m10 9.5 5 3-5 3z"/>`,
  star: `<path ${O} fill="#ffd23f" d="m12 2 2.8 6 6.7.7-5 4.5 1.4 6.6L12 16.4l-5.9 3.4 1.4-6.6-5-4.5L9.2 8z"/>`,
  shield: `<path ${O} fill="#4f8cff" d="M12 2 20 5v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path fill="#ffd23f" d="M12 6v12c-3-1.7-5-4.4-5-7.5V8z"/>`,
  heart: `<path ${O} fill="#ff5a8a" d="M12 20.5 3.8 12.6A5 5 0 0 1 12 6.4a5 5 0 0 1 8.2 6.2z"/><path fill="#ffc2d6" d="M7 8.5a2.5 2.5 0 0 1 3 .2l-1 1.4a1 1 0 0 0-1.4 0z"/>`,
  bomb: `<circle ${O} fill="#2d3348" cx="11" cy="14" r="7"/><path ${O} fill="#9aa7b8" d="m14.5 6.5 3 3 1.8-1.8-3-3z"/><path ${O} fill="none" stroke="#b87a2e" d="M18.4 5.6c1-1.6 2.6-1.8 3.3-.6"/><circle fill="#ffd23f" cx="21.6" cy="4.6" r="1.3"/><circle fill="#6a7390" cx="8.5" cy="11.5" r="1.6"/>`,
  play: `<circle ${O} fill="#3ee07a" cx="12" cy="12" r="9.5"/><path fill="#fff" stroke="#1a1030" stroke-width="1.4" stroke-linejoin="round" d="m10 7.5 6.5 4.5-6.5 4.5z"/>`,
};

/** An inline SVG icon, 1em square, for innerHTML use. */
export function icon(name: IconName, extraClass = ""): string {
  return `<svg class="ui-icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
