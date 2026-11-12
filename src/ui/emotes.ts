/**
 * The battle emotes: a friendly set, and the bot's manners.
 *
 * EMOTES is the wire table: the index is the emote id online frames carry
 * (0..7, see net/lockstep.ts). Clients from before this set know only
 * 0..3 and drop anything else (match/online.ts showOnlineEmote skips an
 * index with no glyph), so the new emotes live on 4..7 and need no
 * protocol bump. The laughing (0) and angry (3) faces are retired: their
 * slots are empty, so a new client shows nothing when an old one sends
 * them. Crying (1) stays in the table so an old friend's emote still
 * shows, but it is not offered any more.
 *
 * The bubble draws the glyph on the inked, off-white canvas bubble
 * (render3d/scene/fx/pool.ts paintBubble), like the Crown Pass emotes.
 * The glyphs are written as \u escapes, as meta/pass.ts writes its own:
 * emotes are emoji on purpose (the noEmoji ratchet exempts the emote
 * list), so they stay out of that ratchet's count for UI chrome.
 */

/** Wire id -> glyph ("" = retired: never shown). 7 is free for later. */
export const EMOTES: readonly string[] = [
  "", // 0: laughing face, retired
  "\u{1F62D}", // 1: crying face (shown when an old client sends it; not offered)
  "\u{1F44D}", // 2: thumbs up
  "", // 3: angry face, retired
  "\u{1F44B}", // 4: waving hand (hello, good game)
  "\u{1F62E}", // 5: open-mouth face (wow)
  "\u{2764}\u{FE0F}", // 6: red heart
];

/** Wire ids of the retired faces (laughing, angry). */
export const RETIRED_EMOTES: readonly number[] = [0, 3];

/** Named wire ids. */
export const EMOTE_ID = {
  thumbsUp: 2,
  hello: 4,
  wow: 5,
  heart: 6,
} as const;

export interface PickerEmote {
  /** Wire id (index into EMOTES). */
  id: number;
  /** What a screen reader says: [English, Arabic]. */
  label: [string, string];
}

/** The picker, in tray order: four friendly emotes. */
export const EMOTE_PICKER: readonly PickerEmote[] = [
  { id: EMOTE_ID.hello, label: ["Hello!", "مرحبًا!"] },
  { id: EMOTE_ID.thumbsUp, label: ["Nice!", "أحسنت!"] },
  { id: EMOTE_ID.wow, label: ["Wow!", "واو!"] },
  { id: EMOTE_ID.heart, label: ["Love it!", "أعجبني!"] },
];

/** The glyph for a wire id, or null when it is retired or unknown. */
export function emoteGlyph(id: number): string | null {
  return Number.isInteger(id) ? EMOTES[id] || null : null;
}

/** Something the bot may react to. */
export type BotMoment =
  /**
   * A tower fell; `byKid` is true when the kid took it. `matchOver` is
   * true when that tower ended the match (the King, or a sudden-death
   * crown): the end-of-match emote speaks for it then.
   */
  | { type: "crown"; byKid: boolean; matchOver?: boolean }
  /** The match ended; `kidWon` is null for a draw. */
  | { type: "end"; kidWon: boolean | null };

/**
 * The bot's reaction (a wire id), or null to stay quiet. The bot is a
 * good sport: it never laughs, gloats or celebrates the kid's loss. It
 * says wow when the kid takes its tower, gives a thumbs up when the kid
 * wins and waves a friendly 'good game' at the end otherwise. One emote
 * per moment: the tower that ends the match gets only the end's emote.
 */
export function botReaction(m: BotMoment): number | null {
  if (m.type === "crown") return m.byKid && !m.matchOver ? EMOTE_ID.wow : null;
  return m.kidWon === true ? EMOTE_ID.thumbsUp : EMOTE_ID.hello;
}
