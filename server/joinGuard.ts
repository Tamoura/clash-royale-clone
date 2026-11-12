/**
 * The wrong-code limit: one home cannot sweep the room codes by guessing.
 *
 * A waiting room is found only by its code (LION042: one of 20 words and
 * three digits, 20,000 codes), and joining a matching code starts the match
 * at once. The relay's pairing limit (5 create/join per IP per 10 s) slows a
 * guesser down but never stops one. This guard counts the joins that named
 * no room ("no-such-room"). Ten of those within ten minutes, from one address
 * or one connection, and every join from it is answered "rate-limited" for
 * the next ten minutes, right code or not (so a blocked guesser learns
 * nothing). A kid who mistypes a code a few times never comes near it.
 *
 * Addresses are grouped the way they are handed out: an IPv4 address on its
 * own, an IPv6 address by its /64 network (one home or phone usually gets a
 * whole /64, so counting single IPv6 addresses would let one device rotate
 * through billions of them). An IPv6 address also counts toward its /56 (a
 * home's usual allocation: 256 /64s) and its /48 (a site's, or a free tunnel
 * broker's: 65,536 /64s), with looser limits (NET_MISSES), so rotating /64s
 * inside one allocation does not multiply the guesses.
 *
 * What it buys: about 10 guesses per address in a waiting room's ten-minute
 * life, 30 per IPv6 /56 and 60 per /48. It does not stop someone with many
 * separate networks; a room code is a hard-to-guess key, not a password.
 *
 * Pure and clock-injected, so server/joinGuard.test.ts covers it without a
 * network; server/relay.ts wires it in (and server/relay.test.ts checks that
 * wiring against a real relay process).
 */

export interface JoinGuardOpts {
  /** Wrong codes allowed inside the window; the one that reaches it starts a block. */
  maxMisses: number;
  /**
   * Looser limits for wide keys, by prefix length: a key ending "/56" or
   * "/48" (addressKeys) may make this many wrong codes in the window.
   */
  netMisses: Readonly<Record<number, number>>;
  /** How far back wrong codes are counted (ms). */
  windowMs: number;
  /** How long a block lasts (ms). */
  blockMs: number;
  /** Most keys tracked at once (oldest dropped first), so memory stays bounded. */
  maxKeys: number;
}

/** Wrong codes allowed per IPv6 /56 and /48 network (see JoinGuardOpts.netMisses). */
export const NET_MISSES: Readonly<Record<number, number>> = { 56: 30, 48: 60 };

export const JOIN_GUARD_DEFAULTS: Readonly<JoinGuardOpts> = {
  maxMisses: 10,
  netMisses: NET_MISSES,
  windowMs: 10 * 60_000,
  blockMs: 10 * 60_000,
  maxKeys: 50_000,
};

/**
 * The key one address counts under: IPv4 as is, an IPv4-mapped IPv6 address
 * (::ffff:1.2.3.4) as its IPv4, and any other IPv6 address as its /64
 * network. Anything unparseable is kept whole (lower-cased).
 */
export function addressKey(ip: string): string {
  return addressKeys(ip)[0];
}

/**
 * Every key one address counts under, narrowest first: addressKey's, and for
 * a real IPv6 address also its /56 and /48 networks (limited by NET_MISSES).
 */
export function addressKeys(ip: string): string[] {
  let a = ip.trim().toLowerCase();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return [`ip:${mapped[1]}`];
  if (!a.includes(":")) return [`ip:${a}`];
  const groups = expandIpv6(a);
  if (!groups) return [`ip:${a}`];
  const g = (i: number): string => groups[i];
  const g56 = (parseInt(g(3), 16) & 0xff00).toString(16);
  return [
    `ip6:${groups.slice(0, 4).join(":")}::/64`,
    `ip6:${g(0)}:${g(1)}:${g(2)}:${g56}::/56`,
    `ip6:${g(0)}:${g(1)}:${g(2)}::/48`,
  ];
}

/** The 8 hextets of an IPv6 address (no leading zeros), or null if it is not one. */
function expandIpv6(a: string): string[] | null {
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const part = (s: string): string[] => (s === "" ? [] : s.split(":"));
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  // An embedded IPv4 tail (::1.2.3.4) is two hextets; the network part is all we keep.
  const last = tail.length ? tail : head;
  if (last.length && last[last.length - 1].includes(".")) last.splice(-1, 1, "0", "0");
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16).toString(16));
}

export class JoinGuard {
  private readonly opts: JoinGuardOpts;
  /** Recent wrong-code times per key, oldest first (at most its limit kept). */
  private readonly misses = new Map<string, number[]>();
  /** Keys refused until this time. */
  private readonly blockedUntil = new Map<string, number>();

  constructor(opts: Partial<JoinGuardOpts> = {}) {
    this.opts = { ...JOIN_GUARD_DEFAULTS, ...opts };
  }

  /** True while any of `keys` is blocked: answer the join "rate-limited". */
  blocked(keys: readonly string[], now: number): boolean {
    return keys.some((k) => (this.blockedUntil.get(k) ?? -Infinity) > now);
  }

  /**
   * Count one wrong code against every key. Returns true when this miss
   * started a block (for the log); later joins from those keys are refused
   * until the block ends.
   */
  miss(keys: readonly string[], now: number): boolean {
    const { windowMs, blockMs, maxKeys } = this.opts;
    let tripped = false;
    for (const k of keys) {
      const maxMisses = this.limitOf(k);
      const recent = (this.misses.get(k) ?? []).filter((t) => now - t < windowMs);
      recent.push(now);
      if (recent.length > maxMisses) recent.splice(0, recent.length - maxMisses);
      // Re-insert so the map stays ordered by last activity (oldest evicted first).
      this.misses.delete(k);
      this.misses.set(k, recent);
      if (recent.length >= maxMisses && !this.blocked([k], now)) {
        this.blockedUntil.set(k, now + blockMs);
        this.misses.delete(k); // a fresh count once the block ends
        tripped = true;
      }
    }
    while (this.misses.size > maxKeys) {
      const oldest = this.misses.keys().next().value;
      if (oldest === undefined) break;
      this.misses.delete(oldest);
    }
    return tripped;
  }

  /** Wrong codes `key` may make in the window: maxMisses, or its network's netMisses. */
  limitOf(key: string): number {
    const bits = /\/(\d+)$/.exec(key);
    return (bits && this.opts.netMisses[Number(bits[1])]) || this.opts.maxMisses;
  }

  /** Forget counts and blocks that no longer matter (the relay's expiry sweep). */
  sweep(now: number): void {
    for (const [k, times] of this.misses) {
      if (times.every((t) => now - t >= this.opts.windowMs)) this.misses.delete(k);
    }
    for (const [k, until] of this.blockedUntil) {
      if (until <= now) this.blockedUntil.delete(k);
    }
  }

  /** Live counts, for tests and the health endpoint. */
  stats(): { tracked: number; blocked: number } {
    return { tracked: this.misses.size, blocked: this.blockedUntil.size };
  }
}
