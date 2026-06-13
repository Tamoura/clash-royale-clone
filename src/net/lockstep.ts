import type { CardId } from "../game/cards";
import type { Side } from "../game/arena";

/** A single deploy issued by one player, in canonical (host-frame) coordinates. */
export interface DeployCommand {
  side: Side;
  cardId: CardId;
  x: number;
  y: number;
}

/** One player's commands for a specific execution tick (may be empty). */
export interface InputFrame {
  tick: number;
  side: Side;
  commands: DeployCommand[];
}

/**
 * Deterministic-lockstep scheduler for a two-player match.
 *
 * Both peers run the identical simulation. A tick is simulated only once both
 * players' input frames for it are in hand, so neither side can apply a command
 * the other hasn't seen — there is no desync from missing or late input. Local
 * commands are scheduled `delay` ticks in the future to hide round-trip latency.
 *
 * The scheduler is pure: it never touches the network. The driver sends the
 * frames returned by {@link bootstrap} and {@link step}, and feeds frames it
 * receives from the peer into {@link receive}.
 */
export class Lockstep {
  private readonly frames = new Map<number, Partial<Record<Side, DeployCommand[]>>>();
  private readonly remoteSide: Side;
  private pending: DeployCommand[] = [];
  private simTick = 0;

  constructor(
    private readonly localSide: Side,
    private readonly delay: number,
  ) {
    this.remoteSide = localSide === "player" ? "enemy" : "player";
  }

  /**
   * The opening `delay` empty local frames. These unblock ticks `0..delay-1`
   * before any command can be scheduled. Self-delivered locally and returned so
   * the driver can forward them to the peer.
   */
  bootstrap(): InputFrame[] {
    const out: InputFrame[] = [];
    for (let t = 0; t < this.delay; t++) {
      const frame: InputFrame = { tick: t, side: this.localSide, commands: [] };
      this.store(frame);
      out.push(frame);
    }
    return out;
  }

  /** Queue a local deploy for the next produced frame. */
  queue(cmd: DeployCommand): void {
    this.pending.push(cmd);
  }

  /** True once both players' frames for the next tick to simulate are present. */
  ready(): boolean {
    const slot = this.frames.get(this.simTick);
    return !!slot && slot.player !== undefined && slot.enemy !== undefined;
  }

  /**
   * Advance exactly one simulation tick. Returns the commands to apply (player
   * before enemy, insertion order within a side) and the outgoing local frame —
   * scheduled `delay` ticks ahead — that the driver must send to the peer.
   * Throws if the tick is not yet confirmed by both players.
   */
  step(): { commands: DeployCommand[]; outgoing: InputFrame } {
    if (!this.ready()) {
      throw new Error(`tick ${this.simTick} not confirmed by both players`);
    }
    const slot = this.frames.get(this.simTick)!;
    const commands = [...(slot.player ?? []), ...(slot.enemy ?? [])];
    this.frames.delete(this.simTick);

    const outgoing: InputFrame = {
      tick: this.simTick + this.delay,
      side: this.localSide,
      commands: this.pending,
    };
    this.store(outgoing);
    this.pending = [];
    this.simTick++;
    return { commands, outgoing };
  }

  /** Buffer a frame received from the peer. */
  receive(frame: InputFrame): void {
    if (frame.side === this.localSide) return; // our own frames are self-delivered
    this.store(frame);
  }

  /** The next tick this peer will simulate. */
  get tick(): number {
    return this.simTick;
  }

  private store(frame: InputFrame): void {
    let slot = this.frames.get(frame.tick);
    if (!slot) {
      slot = {};
      this.frames.set(frame.tick, slot);
    }
    slot[frame.side] = frame.commands;
  }
}
