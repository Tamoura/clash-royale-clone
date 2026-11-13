/**
 * The in-game "Reduce motion" setting, for CSS: while it is on, <html>
 * carries data-reduce-motion and the stylesheets' `:root[data-reduce-motion]`
 * blocks stop decorative animation (the same blocks as the OS-level
 * `@media (prefers-reduced-motion: reduce)`). main.ts applies it at boot and
 * on every prefs change, from reducedMotion() (which also follows the OS on
 * "auto").
 */
export const REDUCE_MOTION_ATTR = "data-reduce-motion";

export function applyMotionAttr(root: Pick<Element, "setAttribute" | "removeAttribute">, reduced: boolean): void {
  if (reduced) root.setAttribute(REDUCE_MOTION_ATTR, "");
  else root.removeAttribute(REDUCE_MOTION_ATTR);
}
