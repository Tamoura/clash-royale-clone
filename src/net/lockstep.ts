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
  /** That side fires its King's ability on this tick (after its deploys). */
  ability?: true;
  /** Emote ids (0..7) shown on this tick. Render only, never simulated. */
  emotes?: number[];
}

/** An emote some side sent, as seen on the tick it lands. */
export interface EmoteAt {
  side: Side;
  emote: number;
}

/** Most emotes one frame carries (the relay enforces the same cap). */
const MAX_EMOTES_PER_FRAME = 2;

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
  /** Ability and emote flags per tick, kept until the tick after it is stepped. */
  private readonly abilities = new Map<number, Side[]>();
  private readonly emotes = new Map<number, EmoteAt[]>();
  private pending: DeployCommand[] = [];
  private pendingAbility = false;
  private pendingEmotes: number[] = [];
  private simTick = 0;

  constructor(
    private readonly localSide: Side,
    private readonly delay: number,
  ) {}

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

  /** Fire the local King's ability on the next produced frame. */
  queueAbility(): void {
    this.pendingAbility = true;
  }

  /** Attach an emote (0..7) to the next produced frame; extras are dropped. */
  queueEmote(emote: number): void {
    if (this.pendingEmotes.length < MAX_EMOTES_PER_FRAME) this.pendingEmotes.push(emote);
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
    // Flags for the previous tick are no longer queryable; this tick's stay
    // readable via abilitiesAt/emotesAt until the next step.
    this.abilities.delete(this.simTick - 1);
    this.emotes.delete(this.simTick - 1);

    const outgoing: InputFrame = {
      tick: this.simTick + this.delay,
      side: this.localSide,
      commands: this.pending,
    };
    if (this.pendingAbility) outgoing.ability = true;
    if (this.pendingEmotes.length > 0) outgoing.emotes = this.pendingEmotes;
    this.store(outgoing);
    this.pending = [];
    this.pendingAbility = false;
    this.pendingEmotes = [];
    this.simTick++;
    return { commands, outgoing };
  }

  /**
   * Buffer a frame received from the peer. Our own side (self-delivered),
   * stale ticks (already simulated) and duplicates (slot already filled, as
   * when a resume replays the log) are ignored, so the first frame wins.
   */
  receive(frame: InputFrame): void {
    if (frame.side === this.localSide) return;
    if (frame.tick < this.simTick) return;
    if (this.frames.get(frame.tick)?.[frame.side] !== undefined) return;
    this.store(frame);
  }

  /**
   * Sides firing their ability on `tick`, player before enemy. Valid for the
   * tick about to be stepped and the one just stepped; drivers apply these
   * after that tick's deploys.
   */
  abilitiesAt(tick: number): Side[] {
    const sides = this.abilities.get(tick) ?? [];
    return (["player", "enemy"] as const).filter((s) => sides.includes(s));
  }

  /** Emotes landing on `tick`, player's first. Render only. */
  emotesAt(tick: number): EmoteAt[] {
    const list = this.emotes.get(tick) ?? [];
    return [...list.filter((e) => e.side === "player"), ...list.filter((e) => e.side === "enemy")];
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
    if (frame.ability) {
      const sides = this.abilities.get(frame.tick) ?? [];
      if (!sides.includes(frame.side)) sides.push(frame.side);
      this.abilities.set(frame.tick, sides);
    }
    if (frame.emotes && frame.emotes.length > 0) {
      const list = this.emotes.get(frame.tick) ?? [];
      for (const emote of frame.emotes.slice(0, MAX_EMOTES_PER_FRAME)) list.push({ side: frame.side, emote });
      this.emotes.set(frame.tick, list);
    }
  }
}
