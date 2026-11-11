/**
 * Tower crews from the cast, delivered through the crew contract (shared
 * rules 4): towers.ts calls `setTowerCrewProvider(towerCrewProvider)` (the
 * integrator wires it in scene3d.ts); without a provider the towers keep
 * their hand-built crew.
 *
 * Crews are CREW_SCALE of their field size (about 0.75 of a field archer),
 * stand inside the crenellations with head and weapon above the parapet,
 * and lean toward the camera like the field cast.
 */
import * as THREE from "three";
import type { Side } from "../../game/arena";
import { animateKitTroop, leanQuaternion, VIEW_DIR } from "./animate";
import { disposeKitTroop, hasKitTroop, makeKitTroop, type KitUnit } from "./index";
import type { Edition } from "./types";

export type CrewKind = "tower-princess" | "tower-king" | "cannoneer" | "duchess";

/** Crew size against the same character on the field (25-30% smaller than the prototype's crew). */
export const CREW_SCALE = 0.72;

export interface CrewState {
  attacking: boolean;
  cooldown: number;
  hitSpeed: number;
  asleep: boolean;
  frozen: boolean;
}

/** What `make` hands the towers: the group to mount and the crew's head-top height. */
export interface CrewUnit {
  group: THREE.Group;
  height: number;
  /** The animated cast unit inside (for tests and the integrator). */
  unit: KitUnit;
  lean: THREE.Group;
}

const Q = new THREE.Quaternion();
const E = new THREE.Euler();

/** The tower crew provider (shared rules 4). `side` is the viewer-relative team the crew wears. */
export const towerCrewProvider = {
  make(kind: CrewKind, side: Side, edition: Edition): CrewUnit | null {
    if (!hasKitTroop(kind, edition)) return null;
    const unit = makeKitTroop(kind, side, edition, false);
    if (!unit) return null;
    unit.group.scale.setScalar(unit.scale * CREW_SCALE);
    const lean = new THREE.Group();
    lean.name = "crewLean";
    lean.add(unit.group);
    const group = new THREE.Group();
    group.name = "castCrew";
    group.add(lean);
    return { group, height: unit.height * CREW_SCALE, unit, lean };
  },

  animate(crew: CrewUnit, s: CrewState, dt: number): void {
    const u = crew.unit;
    animateKitTroop(
      u,
      { moving: false, attacking: s.attacking && !s.asleep, cooldown: s.cooldown, hitSpeed: s.hitSpeed, rate: s.asleep ? 0.35 : 1, frozen: s.frozen },
      s.asleep ? dt * 0.35 : dt,
    );
    // Lean toward the camera about the crew's feet, whatever way the mount turns it.
    crew.group.updateWorldMatrix(true, false);
    crew.group.getWorldQuaternion(Q);
    const yaw = E.setFromQuaternion(Q, "YXZ").y;
    leanQuaternion(VIEW_DIR.x, VIEW_DIR.z, yaw, crew.lean.quaternion);
  },

  dispose(crew: CrewUnit): void {
    disposeKitTroop(crew.unit);
    crew.group.removeFromParent();
  },
};
