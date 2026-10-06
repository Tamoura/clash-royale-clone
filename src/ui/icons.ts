/**
 * Drawn UI icons (inline SVG) that replace emoji in the interface, so the
 * chrome looks the same on every device. Chunky flat shapes with a dark
 * outline, sized by the surrounding font (1em square).
 */
export type IconName =
  | "crown" | "sword" | "trophy" | "coin" | "gem" | "home" | "cards"
  | "sound" | "mute" | "chest" | "calendar" | "shop" | "profile" | "events"
  | "dice" | "puzzle" | "hammer" | "book" | "tv" | "star" | "shield" | "play"
  | "heart" | "bomb"
  // UI glyphs
  | "elixir" | "check" | "lock" | "back" | "settings" | "share" | "copy"
  | "handshake" | "save" | "bolt" | "wrench" | "upgrade" | "flag" | "music"
  | "sfx" | "wifi"
  // Game glyphs
  | "crown-filled" | "crown-empty" | "skull" | "wing" | "snow" | "pause" | "info"
  // Profile crests (prefs.crest picks one)
  | `crest-${CrestIndex}`;

export type CrestIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

const O = 'stroke="#1a1030" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"';

/** Line glyphs: a dark under-stroke with a light stroke on top, so thin shapes keep the outline. */
const line = (d: string, color = "#fff"): string =>
  `<path fill="none" stroke="#1a1030" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>` +
  `<path fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;

// Profile crests: four outlines x twelve colours x twelve emblems.
const CREST_SHAPES = [
  "M12 2 20.5 5v6.5c0 5-3.6 8.9-8.5 10.5-4.9-1.6-8.5-5.5-8.5-10.5V5z", // shield
  "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z", // roundel
  "M12 2l8.7 5v10L12 22l-8.7-5V7z", // hexagon
  "M4.5 2.5h15v19L12 17.5l-7.5 4z", // banner
];
const CREST_COLORS = [
  "#4f8cff", "#e8413b", "#3ee07a", "#b58aff", "#f2a31b", "#1aa3a0",
  "#ff5a8a", "#2d3b66", "#8a5a30", "#16807e", "#d9912b", "#6a7390",
];
const E = 'stroke="#1a1030" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"';
const CREST_EMBLEMS = [
  `<path ${E} fill="#ffd23f" d="M12 6.5 13.2 9.8 16.8 10 14 12.1 14.9 15.5 12 13.6 9.1 15.5 10 12.1 7.2 10 10.8 9.8z"/>`, // star
  `<path ${E} fill="#ffd23f" d="M7 15 7.8 8.5l2.6 2.4L12 7.5l1.6 3.4 2.6-2.4L17 15z"/>`, // crown
  `<path ${E} fill="#dfe7f2" d="M11 5h2v8h2.5v1.8H13V18h-2v-3.2H8.5V13H11z"/>`, // sword
  `<path ${E} fill="#ffd23f" d="M14.5 6.5a5.5 5.5 0 1 0 0 10 4.5 4.5 0 1 1 0-10z"/>`, // crescent
  `<path ${E} fill="#ffb03a" d="M12 5c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 1.5.6 2.3 1.4 2.6C11 10 11 7.5 12 5z"/>`, // flame
  `<path ${E} fill="#b8ffd2" d="M7 16C7 10 11 6.5 17 6.5c0 6-3.5 9.5-10 9.5z"/>`, // leaf
  `<path ${E} fill="#ffd23f" d="M13 5 8.5 12.5h3L10.5 18l5-7.5h-3z"/>`, // bolt
  `<path ${E} fill="#ffc2d6" d="M12 17 7.4 12.5A2.8 2.8 0 0 1 12 9.2a2.8 2.8 0 0 1 4.6 3.3z"/>`, // heart
  `<path ${E} fill="#f6e7c8" d="M8 18V9h1.6v1.6h1.6V9h1.6v1.6h1.6V9H16v9z"/>`, // tower
  `<path ${E} fill="#b8ffd2" d="M9 7.5h6l2.5 3.5L12 17l-5.5-6z"/>`, // gem
  `<circle ${E} fill="#ffd23f" cx="12" cy="11.5" r="2.8"/><circle fill="none" stroke="#ffd23f" stroke-width="1.6" stroke-dasharray="1.6 1.9" cx="12" cy="11.5" r="5"/>`, // sun
  `<path ${E} fill="#ff8fd0" d="M12 6c-1.7 2.6-3.6 4.6-3.6 6.9a3.6 3.6 0 0 0 7.2 0C15.6 10.6 13.7 8.6 12 6z"/>`, // drop
];
const crest = (i: CrestIndex): string =>
  `<path ${O} fill="${CREST_COLORS[i]}" d="${CREST_SHAPES[i % CREST_SHAPES.length]}"/>${CREST_EMBLEMS[i]}`;

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
  // ---- UI glyphs ----
  elixir: `<path ${O} fill="#e91e9b" d="M12 2.5C9 7 5.5 10.5 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.5 15 7 12 2.5z"/><path fill="#ff8fd0" d="M9 13.8a3.2 3.2 0 0 1 1.7-3.1l.8 1.3a1.7 1.7 0 0 0-.9 1.8z"/>`,
  check: line("m4.5 12.5 5 5 10-11", "#3ee07a"),
  lock: `${line("M8 10.5V7.5a4 4 0 0 1 8 0v3", "#9aa7b8")}<rect ${O} fill="#ffd23f" x="5" y="10" width="14" height="11" rx="2"/><path fill="#1a1030" d="M12 13.2a1.7 1.7 0 0 0-.9 3.1V18h1.8v-1.7a1.7 1.7 0 0 0-.9-3.1z"/>`,
  back: line("M19 12H6m5-6-6 6 6 6"),
  settings: `<path ${O} fill="#9aa7b8" d="M19.4 10.1 22.1 10.3 22.1 13.7 19.4 13.9 18.5 15.9 20.3 17.9 17.9 20.3 15.9 18.5 13.9 19.4 13.7 22.1 10.3 22.1 10.1 19.4 8.1 18.5 6.1 20.3 3.7 17.9 5.5 15.9 4.6 13.9 1.9 13.7 1.9 10.3 4.6 10.1 5.5 8.1 3.7 6.1 6.1 3.7 8.1 5.5 10.1 4.6 10.3 1.9 13.7 1.9 13.9 4.6 15.9 5.5 17.9 3.7 20.3 6.1 18.5 8.1z"/><circle ${O} fill="#2d3b66" cx="12" cy="12" r="3.4"/>`,
  share: `${line("m7 12 10-5.5M7 12l10 5.5", "#dfe7f2")}<circle ${O} fill="#4f8cff" cx="6" cy="12" r="3"/><circle ${O} fill="#3ee07a" cx="18" cy="6" r="3"/><circle ${O} fill="#ffd23f" cx="18" cy="18" r="3"/>`,
  copy: `<rect ${O} fill="#9aa7b8" x="3.5" y="3" width="12" height="14" rx="2"/><rect ${O} fill="#dfe7f2" x="8.5" y="7" width="12" height="14" rx="2"/>`,
  handshake: `<path ${O} fill="#4f8cff" d="M1.5 9.5 6 7l3 7-4.5 2.5z"/><path ${O} fill="#e8413b" d="M22.5 9.5 18 7l-3 7 4.5 2.5z"/><path ${O} fill="#ffd9a8" d="M7 9.5c2-1.5 4-2 5.5-1.5L17 9.5l-1.8 5.6c-.9 1.8-3 2.4-4.7 1.4L7.8 15z"/><path fill="none" stroke="#1a1030" stroke-width="1.3" stroke-linecap="round" d="m10.5 12.2 2 1.6M12 10.8l2.2 1.7"/>`,
  save: `<path ${O} fill="#4f8cff" d="M4 3h13l3 3v15H4z"/><path ${O} fill="#dfe7f2" d="M7.5 3h8v5.5h-8z"/><path ${O} fill="#f6f1e6" d="M7 13h10v8H7z"/>`,
  bolt: `<path ${O} fill="#ffd23f" d="M13.5 2 4.5 13.5h6L9.5 22l9-12h-6z"/>`,
  wrench: `<path ${O} fill="#9aa7b8" d="M14.5 3.2a5 5 0 0 0-5.3 6.6L3 16a2.1 2.1 0 0 0 3 3l6.2-6.2a5 5 0 0 0 6.6-5.3l-3 3-2.8-.8-.8-2.8z"/>`,
  upgrade: `<path ${O} fill="#3ee07a" d="M12 2.5 20.5 11h-5v9.5h-7V11h-5z"/><path fill="#b8ffd2" d="M12 5.2 7.6 9.6h2.2z"/>`,
  flag: `<rect ${O} fill="#9aa7b8" x="4" y="2.5" width="2.4" height="19" rx="1"/><path ${O} fill="#e8413b" d="M6.4 4H19l-3 4 3 4H6.4z"/>`,
  music: `<rect ${O} fill="#b58aff" x="9" y="6.5" width="2.2" height="12" rx=".6"/><rect ${O} fill="#b58aff" x="17.3" y="4" width="2.2" height="12" rx=".6"/><path ${O} fill="#b58aff" d="M9 6.5 19.5 3.5v3.2L9 9.6z"/><ellipse ${O} fill="#b58aff" cx="7.8" cy="18.4" rx="3" ry="2.3"/><ellipse ${O} fill="#b58aff" cx="16.1" cy="16" rx="3" ry="2.3"/>`,
  sfx: `<path ${O} fill="#dfe7f2" d="M3 9h4l5-4v14l-5-4H3z"/><path ${O} fill="#ffd23f" d="m18 5 1.2 3.3 3.3 1.2-3.3 1.2L18 14l-1.2-3.3-3.3-1.2 3.3-1.2z"/>`,
  wifi: `${line("M3 9.5a13 13 0 0 1 18 0M6.2 13a8.5 8.5 0 0 1 11.6 0M9.4 16.4a4 4 0 0 1 5.2 0", "#3ee07a")}<circle ${O} fill="#3ee07a" cx="12" cy="19.5" r="1.6"/>`,
  // ---- Game glyphs ----
  "crown-filled": `<path ${O} fill="#ffd23f" d="M3 18 4 7.5l4.8 4.2L12 5l3.2 6.7L20 7.5 21 18z"/><path fill="#fff6c9" d="M5 9.5 5.6 14l1.4-.6z"/><circle ${O} fill="#4f8cff" cx="12" cy="14.6" r="1.6"/>`,
  "crown-empty": `<path stroke="#6a7390" stroke-width="1.6" stroke-linejoin="round" fill="#2d3348" d="M3 18 4 7.5l4.8 4.2L12 5l3.2 6.7L20 7.5 21 18z"/>`,
  skull: `<path ${O} fill="#f6f1e6" d="M12 2.5a8 8 0 0 0-8 8c0 2.6 1.2 4.5 3 5.6V20.5h10v-4.4c1.8-1.1 3-3 3-5.6a8 8 0 0 0-8-8z"/><circle fill="#1a1030" cx="8.8" cy="11" r="2"/><circle fill="#1a1030" cx="15.2" cy="11" r="2"/><path fill="#1a1030" d="M12 13.4 13.2 16h-2.4z"/><path stroke="#1a1030" stroke-width="1.3" d="M10 17.5v3M14 17.5v3"/>`,
  wing: `<path ${O} fill="#dfe7f2" d="M3 6c4 0 9 1.5 12 4.5 2 2 3.5 4.5 6 6.5-3.5 1.5-8 1-11-1C7 14 4.5 10.5 3 6z"/><path fill="none" stroke="#9aa7b8" stroke-width="1.3" stroke-linecap="round" d="M7 9.5c2.5.8 4.5 2 6 3.5M8.5 13c2 .6 3.8 1.5 5 2.6"/>`,
  snow: line("M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5", "#8fd8ff"),
  pause: `<circle ${O} fill="#4f8cff" cx="12" cy="12" r="9.5"/><rect fill="#fff" stroke="#1a1030" stroke-width="1.4" x="8" y="7.5" width="2.8" height="9" rx="1"/><rect fill="#fff" stroke="#1a1030" stroke-width="1.4" x="13.2" y="7.5" width="2.8" height="9" rx="1"/>`,
  info: `<circle ${O} fill="#4f8cff" cx="12" cy="12" r="9.5"/><circle fill="#fff" stroke="#1a1030" stroke-width="1" cx="12" cy="7.4" r="1.7"/><rect fill="#fff" stroke="#1a1030" stroke-width="1" x="10.7" y="10.2" width="2.6" height="7.6" rx="1.2"/>`,
  // ---- Profile crests ----
  "crest-0": crest(0),
  "crest-1": crest(1),
  "crest-2": crest(2),
  "crest-3": crest(3),
  "crest-4": crest(4),
  "crest-5": crest(5),
  "crest-6": crest(6),
  "crest-7": crest(7),
  "crest-8": crest(8),
  "crest-9": crest(9),
  "crest-10": crest(10),
  "crest-11": crest(11),
};

/** An inline SVG icon, 1em square, for innerHTML use. */
export function icon(name: IconName, extraClass = ""): string {
  return `<svg class="ui-icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** Every icon name, in map order (for pickers and tests). */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];
