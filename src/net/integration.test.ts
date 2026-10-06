import { describe, expect, it } from "vitest";
import { createBattle, deployCard, type BattleState } from "../game/battle";
import { useAbility } from "../game/abilities";
import { tick } from "../game/sim";
import type { CardId } from "../game/cards";
import { Lockstep, type DeployCommand, type InputFrame } from "./lockstep";
import { stateChecksum } from "./checksum";

const DT = 1 / 30;
const DELAY = 4;
const HOST_DECK: CardId[] = ["knight", "archers", "giant", "fireball", "musketeer", "mini-pekka", "baby-dragon", "arrows"];
const GUEST_DECK: CardId[] = ["wizard", "witch", "skeletons", "gargoyles", "valkyrie", "hog-rider", "cannon", "zap"];

function apply(state: BattleState, cmds: DeployCommand[]): void {
  for (const c of cmds) deployCard(state, c.side, c.cardId, c.x, c.y);
}

/**
 * Full end-to-end of the lockstep transport: two peers, each with their own
 * Lockstep + BattleState, exchanging frames exactly as the relay would. The
 * canonical battle is identical on both ends (host=player deck, guest=enemy
 * deck), so if the transport is correct the two simulations never diverge.
 */
describe("networked match determinism", () => {
  it("keeps both peers bit-identical for a full skirmish", () => {
    const host = new Lockstep("player", DELAY);
    const guest = new Lockstep("enemy", DELAY);
    const hostBattle = createBattle(HOST_DECK, GUEST_DECK, {});
    const guestBattle = createBattle(HOST_DECK, GUEST_DECK, {});

    // Exchange opening frames (each peer self-delivers its own).
    for (const f of host.bootstrap()) guest.receive(f);
    for (const f of guest.bootstrap()) host.receive(f);

    // Each side schedules some deploys on its own half across the match.
    const hostPlays = new Map<number, DeployCommand>([
      [2, { side: "player", cardId: "knight", x: 6, y: 22 }],
      [20, { side: "player", cardId: "giant", x: 12, y: 20 }],
      [50, { side: "player", cardId: "musketeer", x: 9, y: 24 }],
    ]);
    const guestPlays = new Map<number, DeployCommand>([
      [5, { side: "enemy", cardId: "wizard", x: 9, y: 10 }],
      [25, { side: "enemy", cardId: "hog-rider", x: 5, y: 12 }],
    ]);

    for (let i = 0; i < 150; i++) {
      if (hostPlays.has(i)) host.queue(hostPlays.get(i)!);
      if (guestPlays.has(i)) guest.queue(guestPlays.get(i)!);

      expect(host.ready()).toBe(true);
      expect(guest.ready()).toBe(true);
      const ra = host.step();
      const rb = guest.step();
      guest.receive(ra.outgoing);
      host.receive(rb.outgoing);

      // Both peers received the identical command list for this tick.
      expect(ra.commands).toEqual(rb.commands);
      apply(hostBattle, ra.commands);
      apply(guestBattle, rb.commands);
      tick(hostBattle, DT);
      tick(guestBattle, DT);

      expect(stateChecksum(hostBattle)).toBe(stateChecksum(guestBattle));
    }

    // The deploys actually produced a live battle, not two idle boards.
    expect(hostBattle.entities.length).toBeGreaterThan(4);
  });

  it("fires King's abilities on the same tick on both peers, despite duplicate and stale frames", () => {
    const host = new Lockstep("player", DELAY);
    const guest = new Lockstep("enemy", DELAY);
    const abilities = { player: "salvo", enemy: "restore" } as const;
    const hostBattle = createBattle(HOST_DECK, GUEST_DECK, {}, 1, {}, abilities);
    const guestBattle = createBattle(HOST_DECK, GUEST_DECK, {}, 1, {}, abilities);

    // A flaky link: every frame arrives twice, and an old frame is replayed
    // late (as a resume would). The scheduler must ignore all of it.
    const sent: InputFrame[] = [];
    const deliver = (to: Lockstep, f: InputFrame): void => {
      to.receive(f);
      to.receive({ ...f, commands: [] }); // duplicate with different contents
      if (sent.length > 3) to.receive(sent[sent.length - 3]); // stale replay
      sent.push(f);
    };
    for (const f of host.bootstrap()) deliver(guest, f);
    for (const f of guest.bootstrap()) deliver(host, f);

    const fired: { host: string[]; guest: string[] }[] = [];
    for (let i = 0; i < 90; i++) {
      if (i === 3) host.queue({ side: "player", cardId: "knight", x: 9, y: 17.5 });
      if (i === 4) guest.queue({ side: "enemy", cardId: "valkyrie", x: 9, y: 14 });
      if (i === 40) {
        // Both kings are charged; the guest fires on the same tick as the host.
        for (const b of [hostBattle, guestBattle]) {
          b.player.abilityCharge = 1;
          b.enemy.abilityCharge = 1;
        }
        host.queueAbility();
        guest.queueAbility();
      }

      const t = host.tick;
      expect(guest.tick).toBe(t);
      const ra = host.step();
      const rb = guest.step();
      deliver(guest, ra.outgoing);
      deliver(host, rb.outgoing);
      expect(ra.commands).toEqual(rb.commands);

      // Driver order: deploys, then abilities (player first), then the tick.
      apply(hostBattle, ra.commands);
      apply(guestBattle, rb.commands);
      const hostFired = host.abilitiesAt(t).filter((s) => useAbility(hostBattle, s));
      const guestFired = guest.abilitiesAt(t).filter((s) => useAbility(guestBattle, s));
      fired.push({ host: hostFired, guest: guestFired });
      tick(hostBattle, DT);
      tick(guestBattle, DT);
      expect(stateChecksum(hostBattle)).toBe(stateChecksum(guestBattle));
    }

    // Queued during tick 40 → applied on tick 40 + DELAY, by both, together.
    const firedTicks = fired.flatMap((f, i) => (f.host.length ? [i] : []));
    expect(firedTicks).toEqual([40 + DELAY]);
    expect(fired[40 + DELAY]).toEqual({ host: ["player", "enemy"], guest: ["player", "enemy"] });
    expect(hostBattle.player.abilityCharge).toBeLessThan(1);
    expect(guestBattle.enemy.abilityCharge).toBeLessThan(1);
  });
});
