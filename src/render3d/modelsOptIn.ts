/**
 * Whether this player opted in to the KayKit glTF models with
 * `?models=kaykit` (remembered; `?models=rigs` opts out again). Kept apart
 * from glbModels.ts so the scene can decide without pulling the loader in.
 */
export const MODELS_KEY = "cr-clone-models";

export function kaykitOptIn(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("models");
    if (q === "kaykit" || q === "rigs") localStorage.setItem(MODELS_KEY, q);
    return localStorage.getItem(MODELS_KEY) === "kaykit";
  } catch {
    return false; // node / no storage: the rig roster
  }
}
