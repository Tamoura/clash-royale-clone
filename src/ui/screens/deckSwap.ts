/**
 * "Which card goes out?": a small strip of the kid's deck to make room for a
 * new card (the chest summary's Add to deck). Nothing changes until they tap
 * one of their deck cards. "Keep my deck" is the big, focused default (the
 * confirm({ emphasis: "cancel" }) look the tutorial's skip question uses),
 * and Esc or a tap on the dim backdrop keep the deck too. No card is ever
 * picked for them.
 */
import "../styles/deckSwap.css";
import { getCard, type CardId } from "../../game/cards";
import { cardDisplayName } from "../../render/cardNames";
import { ARABIC } from "../../render3d/theme";
import { makeCardCanvas } from "../cardFrame";
import { button, confirmLook } from "../components";
import { fmtNum, tr } from "../i18n";

/** A full battle deck. */
export const DECK_SIZE = 8;

/**
 * Taps on the strip are ignored this long after it opens, so the second
 * tap of a double tap on Add can never pick a card (or close the strip).
 */
export const STRIP_ARM_MS = 450;

/** Keep my deck is the CTA and takes the first focus; there is no OK button. */
export const STRIP_LOOK = confirmLook({ emphasis: "cancel" });

/**
 * The deck with `incoming` in place of the card at `outIndex`, or null when
 * that is not a real choice (no such slot, or the card is already in).
 */
export function swapIntoDeck(deck: readonly CardId[], outIndex: number, incoming: CardId): CardId[] | null {
  if (deck.includes(incoming)) return null;
  if (!Number.isInteger(outIndex) || outIndex < 0 || outIndex >= deck.length) return null;
  const next = deck.slice();
  next[outIndex] = incoming;
  return next;
}

/** A deck with room left takes the card without anything going out. */
export function addWithoutSwap(deck: readonly CardId[], incoming: CardId): CardId[] | null {
  if (deck.includes(incoming) || deck.length >= DECK_SIZE) return null;
  return [...deck, incoming];
}

const FOCUSABLE = "button:not([disabled])";

/**
 * Show the deck strip for `incoming`. Resolves with the index of the deck
 * card the kid tapped to go out, or null when they kept their deck.
 */
export function pickSwapOut(incoming: CardId, deck: readonly CardId[]): Promise<number | null> {
  return new Promise((resolve) => {
    const opener = document.activeElement as HTMLElement | null;
    const openedAt = performance.now();
    const armed = (): boolean => performance.now() - openedAt >= STRIP_ARM_MS;

    const root = document.createElement("div");
    root.className = "ui-modal rw-swap";
    if (ARABIC) root.dir = "rtl";
    const box = document.createElement("div");
    box.className = "ui-modal__box rw-swap__box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.className = "ui-modal__title";
    title.id = `rw-swap-${Math.random().toString(36).slice(2, 8)}`;
    const name = cardDisplayName(incoming);
    title.textContent = tr(`Add ${name} to your deck?`, `إضافة ${name} إلى مجموعتك؟`);
    box.setAttribute("aria-labelledby", title.id);
    const body = document.createElement("p");
    body.className = "ui-modal__body rw-swap__body";
    body.textContent = tr(
      "Tap the card that goes out, or keep your deck as it is.",
      "اضغط البطاقة التي ستخرج، أو أبقِ مجموعتك كما هي.",
    );

    const strip = document.createElement("div");
    strip.className = "rw-swap__strip";
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", tr("Your deck", "مجموعتك"));

    const finish = (choice: number | null): void => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      opener?.focus?.();
      resolve(choice);
    };

    deck.forEach((id, i) => {
      const card = getCard(id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `rw-swap__card rarity-${card.rarity}`;
      const cardName = cardDisplayName(id);
      b.setAttribute(
        "aria-label",
        tr(`Swap out ${cardName} (${card.cost} elixir)`, `أخرج ${cardName} (${fmtNum(card.cost)} إكسير)`),
      );
      b.appendChild(makeCardCanvas(id, { style: "tile", size: 96 }));
      const label = document.createElement("span");
      label.className = "rw-swap__name";
      label.textContent = cardName;
      b.appendChild(label);
      b.addEventListener("click", () => {
        if (armed()) finish(i);
      });
      strip.appendChild(b);
    });

    const actions = document.createElement("div");
    actions.className = "ui-modal__actions";
    const keep = button({
      variant: STRIP_LOOK.cancel,
      size: "lg",
      label: tr("Keep my deck", "أبقِ مجموعتي"),
      onClick: () => finish(null),
    });
    keep.classList.add("ui-modal__cancel", "rw-swap__keep");
    actions.appendChild(keep);

    box.append(title, body, strip, actions);
    root.appendChild(box);
    root.addEventListener("click", (e) => {
      if (e.target === root && armed()) finish(null);
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      } else if (e.key === "Tab") {
        // Keep Tab inside the strip while it is open.
        const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at < 0 || at === items.length - 1 ? 0 : at + 1;
        e.preventDefault();
        items[next].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(root);
    keep.focus();
  });
}
