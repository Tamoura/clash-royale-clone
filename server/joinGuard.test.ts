import { describe, expect, it } from "vitest";
import { JOIN_GUARD_DEFAULTS, JoinGuard, NET_MISSES, addressKey, addressKeys } from "./joinGuard";

const MIN = 60_000;
const IP = ["ip:203.0.113.7", "conn:c1"];

describe("join guard: wrong room codes", () => {
  it("defaults to 10 wrong codes in 10 minutes, then a 10 minute block", () => {
    expect(JOIN_GUARD_DEFAULTS).toMatchObject({ maxMisses: 10, windowMs: 10 * MIN, blockMs: 10 * MIN });
    // Looser limits for a whole IPv6 /56 (a home) and /48 (a site or tunnel broker).
    expect(NET_MISSES).toEqual({ 56: 30, 48: 60 });
  });

  it("lets a kid mistype a code a few times and still join", () => {
    const g = new JoinGuard();
    for (let i = 0; i < 9; i++) {
      expect(g.blocked(IP, i * 1000)).toBe(false);
      expect(g.miss(IP, i * 1000)).toBe(false);
    }
    // The tenth try (the right code) is still allowed.
    expect(g.blocked(IP, 9_000)).toBe(false);
  });

  it("blocks the address for 10 minutes after the 10th wrong code, even for the right code", () => {
    const g = new JoinGuard();
    for (let i = 0; i < 9; i++) g.miss(IP, i * 1000);
    expect(g.miss(IP, 9_000)).toBe(true); // the 10th miss trips it
    expect(g.blocked(IP, 9_001)).toBe(true); // the 11th try is refused
    expect(g.blocked(["ip:203.0.113.7"], 9_000 + 10 * MIN - 1)).toBe(true);
    expect(g.blocked(IP, 9_000 + 10 * MIN)).toBe(false); // then it is over
    // ...with a fresh count: one more miss does not block again.
    expect(g.miss(IP, 9_000 + 10 * MIN)).toBe(false);
    expect(g.blocked(IP, 9_000 + 10 * MIN + 1)).toBe(false);
  });

  it("forgets wrong codes older than the window (typos spread over an afternoon are fine)", () => {
    const g = new JoinGuard();
    for (let i = 0; i < 30; i++) {
      g.miss(IP, i * 2 * MIN); // one wrong code every 2 minutes: at most 5 in any 10
      expect(g.blocked(IP, i * 2 * MIN + 1)).toBe(false);
    }
  });

  it("a new connection from the same address is still blocked; another address is not", () => {
    const g = new JoinGuard();
    for (let i = 0; i < 10; i++) g.miss(["ip:203.0.113.7", `conn:c${i}`], i);
    expect(g.blocked(["ip:203.0.113.7", "conn:c99"], 100)).toBe(true);
    expect(g.blocked(["ip:198.51.100.4", "conn:c100"], 100)).toBe(false);
  });

  it("counts per connection too, so one socket cannot rotate the address it reports", () => {
    const g = new JoinGuard();
    for (let i = 0; i < 10; i++) g.miss([`ip:10.0.0.${i}`, "conn:c7"], i);
    expect(g.blocked(["ip:10.0.0.200", "conn:c7"], 100)).toBe(true);
  });

  it("makes sweeping the 20,000 codes hopeless from one address", () => {
    const g = new JoinGuard();
    const tries: number[] = [];
    // A script guesses as fast as the relay's pairing limit allows (5 per 10 s) for a whole day.
    for (let t = 0; t < 24 * 60 * MIN; t += 2_000) {
      if (g.blocked(IP, t)) continue;
      tries.push(t);
      g.miss(IP, t);
      g.sweep(t);
    }
    // Without the guard that would be 43,200 guesses: every code twice.
    // With it, at most 10 land in any 10 minutes, the life of a waiting
    // room, so a given room's code is hit with a chance of 10 in 20,000.
    let most = 0;
    for (let i = 0, j = 0; i < tries.length; i++) {
      while (tries[i] - tries[j] >= 10 * MIN) j++;
      most = Math.max(most, i - j + 1);
    }
    expect(most).toBe(10);
    expect(tries.length).toBeLessThan(1_500);
  });

  it("an IPv6 home cannot multiply its guesses by rotating /64s inside its /56", () => {
    const g = new JoinGuard();
    const from = (net: number, i: number): string[] => [...addressKeys(`2001:db8:5:1${net.toString(16).padStart(2, "0")}::1`), `conn:n${net}-${i}`];
    let t = 0;
    let misses = 0;
    // Nine wrong codes from each /64 (never enough to block one /64)...
    for (let net = 0; misses < 30; net++) {
      for (let i = 0; i < 9 && misses < 30; i++, t++) {
        expect(g.blocked(from(net, i), t)).toBe(false);
        g.miss(from(net, i), t);
        misses++;
      }
    }
    // ...and the 30th from the /56 blocks every /64 in it, a fresh one included.
    expect(g.blocked(from(0xfe, 0), t)).toBe(true);
    // Another home's /56 in the same /48 is not blocked.
    expect(g.blocked([...addressKeys("2001:db8:5:200::1"), "conn:other"], t)).toBe(false);
  });

  it("a /48 is capped at 60 wrong codes in 10 minutes, however many /56s it rotates through", () => {
    const g = new JoinGuard();
    let tries = 0;
    for (let net = 0; net < 256 && tries < 500; net++) {
      // 29 per /56 (never enough to block one), each from a different /64.
      for (let i = 0; i < 29; i++) {
        const keys = [...addressKeys(`2001:db8:6:${net.toString(16)}${i.toString(16).padStart(2, "0")}::1`), `conn:${net}-${i}`];
        if (g.blocked(keys, tries)) continue;
        g.miss(keys, tries);
        tries++;
      }
    }
    expect(tries).toBe(60);
    expect(g.blocked([...addressKeys("2001:db8:6:ff00::1"), "conn:z"], 61)).toBe(true);
    expect(g.blocked([...addressKeys("2001:db8:7::1"), "conn:y"], 61)).toBe(false);
  });

  it("limits each key by its kind: 10 for an address or socket, 30 for a /56, 60 for a /48", () => {
    const g = new JoinGuard();
    expect(g.limitOf("ip:203.0.113.7")).toBe(10);
    expect(g.limitOf("conn:c1")).toBe(10);
    expect(g.limitOf("ip6:2001:db8:1:2::/64")).toBe(10);
    expect(g.limitOf("ip6:2001:db8:1:200::/56")).toBe(30);
    expect(g.limitOf("ip6:2001:db8:1::/48")).toBe(60);
  });

  it("sweeps expired counts and blocks, and caps how many keys it tracks", () => {
    const g = new JoinGuard({ maxKeys: 3 });
    for (let i = 0; i < 5; i++) g.miss([`ip:10.0.0.${i}`], 0);
    expect(g.stats().tracked).toBe(3);
    const b = new JoinGuard();
    for (let i = 0; i < 10; i++) b.miss(IP, 0);
    expect(b.stats().blocked).toBe(2);
    b.miss(["ip:1.1.1.1"], 0);
    b.sweep(10 * MIN);
    expect(b.stats()).toEqual({ tracked: 0, blocked: 0 });
  });
});

describe("addressKey", () => {
  it("keeps IPv4 addresses whole and unwraps IPv4-mapped IPv6", () => {
    expect(addressKey("203.0.113.7")).toBe("ip:203.0.113.7");
    expect(addressKey("::ffff:203.0.113.7")).toBe("ip:203.0.113.7");
    expect(addressKey(" ::FFFF:203.0.113.7 ")).toBe("ip:203.0.113.7");
  });

  it("groups IPv6 addresses by their /64 network", () => {
    const a = addressKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("ip6:2001:db8:1:2::/64");
    expect(addressKey("2001:0db8:0001:0002::1")).toBe(a);
    expect(addressKey("[2001:db8:1:2::ffff]")).toBe(a);
    expect(addressKey("2001:db8:1:2::1%eth0")).toBe(a);
    expect(addressKey("2001:db8:1:3::1")).not.toBe(a);
    expect(addressKey("::1")).toBe("ip6:0:0:0:0::/64");
    expect(addressKey("2001:db8::")).toBe("ip6:2001:db8:0:0::/64");
  });

  it("adds an IPv6 address's /56 and /48 networks as wider keys; IPv4 stays one key", () => {
    expect(addressKeys("203.0.113.7")).toEqual(["ip:203.0.113.7"]);
    expect(addressKeys("::ffff:203.0.113.7")).toEqual(["ip:203.0.113.7"]);
    expect(addressKeys("2001:db8:1:2a3:aaaa::1")).toEqual(["ip6:2001:db8:1:2a3::/64", "ip6:2001:db8:1:200::/56", "ip6:2001:db8:1::/48"]);
    // Every /64 from 2001:db8:1:200:: to 2001:db8:1:2ff:: is one /56.
    expect(addressKeys("2001:db8:1:2ff::9")[1]).toBe("ip6:2001:db8:1:200::/56");
    expect(addressKeys("2001:db8:1:300::9")[1]).toBe("ip6:2001:db8:1:300::/56");
    expect(addressKeys("2001:db8:1:5::9")[1]).toBe("ip6:2001:db8:1:0::/56");
    expect(addressKeys("unknown")).toEqual(["ip:unknown"]);
  });

  it("keeps anything else as it came", () => {
    expect(addressKey("unknown")).toBe("ip:unknown");
    expect(addressKey("1:2:3")).toBe("ip:1:2:3");
    expect(addressKey("1::2::3")).toBe("ip:1::2::3");
  });
});
