/**
 * The relay as match/online.ts wires it: a published build never takes a
 * relay from a link or from storage, wipes a remembered one when it loads,
 * and its invite links never name one. Each case loads online.ts afresh
 * under its own build flags (vi.stubEnv) and page (vi.stubGlobal).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RELAY_STORE_KEY } from "../net/relayUrl";

/** In-memory Storage stand-in. */
class MemStore implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

/** A page served on this machine (`npm start`, or `npm run dev` opened here), opened with `search`. */
function page(search: string, hostname = "127.0.0.1", port = 4111) {
  const host = `${hostname}:${port}`;
  return { search, protocol: "http:", hostname, host, origin: `http://${host}`, pathname: "/" };
}

async function loadOnline(opts: { dev: boolean; search: string; stored?: string; hostname?: string; relayEnv?: string }) {
  vi.resetModules();
  vi.stubEnv("DEV", opts.dev);
  vi.stubEnv("VITE_RELAY_URL", opts.relayEnv ?? "same-origin");
  const store = new MemStore();
  if (opts.stored) store.setItem(RELAY_STORE_KEY, opts.stored);
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("location", page(opts.search, opts.hostname));
  const online = await import("./online");
  return { online, store };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("online relay wiring in a published build", () => {
  it("wipes a remembered relay as soon as the game loads", async () => {
    const { store } = await loadOnline({ dev: false, search: "", stored: "wss://evil2.invalid/ws" });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("uses the baked-in relay, whatever the link and storage say", async () => {
    const { online, store } = await loadOnline({
      dev: false,
      search: "?relay=wss://evil.invalid/ws",
      stored: "wss://evil2.invalid/ws",
    });
    expect(online.relayTarget()).toEqual({ url: "ws://127.0.0.1:4111/ws", lan: false });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("never puts a relay in an invite link", async () => {
    const { online } = await loadOnline({ dev: false, search: "?relay=wss://evil.invalid/ws" });
    expect(online.inviteRelayParam()).toBeNull();
    const link = new URL(online.inviteLink("LION042"));
    expect(link.searchParams.get("join")).toBe("LION042");
    expect(link.searchParams.has("relay")).toBe(false);
    expect(link.origin).toBe("http://127.0.0.1:4111");
  });
});

describe("online relay wiring in a development build", () => {
  it("keeps the ?relay= aid: remembered, and carried by invite links", async () => {
    const { online, store } = await loadOnline({ dev: true, search: "?relay=wss://picked.invalid/ws" });
    expect(online.relayTarget()).toEqual({ url: "wss://picked.invalid/ws", lan: false });
    expect(store.getItem(RELAY_STORE_KEY)).toBe("wss://picked.invalid/ws");
    const link = new URL(online.inviteLink("LION042"));
    expect(link.searchParams.get("relay")).toBe("wss://picked.invalid/ws");
  });

  it("keeps ?relay=none (preview a site with no relay)", async () => {
    const { online } = await loadOnline({ dev: true, search: "?relay=none" });
    expect(online.relayTarget()).toEqual({ url: null, lan: false });
  });

  it("keeps a remembered relay at boot on the developer's own computer", async () => {
    const { store } = await loadOnline({ dev: true, search: "", stored: "wss://picked.invalid/ws" });
    expect(store.getItem(RELAY_STORE_KEY)).toBe("wss://picked.invalid/ws");
  });
});

/**
 * `npm run play`: the kids' devices open the dev server by its LAN address
 * (no relay baked in), and always use the LAN relay beside the page.
 */
describe("online relay wiring on the dev server reached from another device", () => {
  const PLAY = { dev: true, hostname: "192.168.1.20", relayEnv: "" };

  it("wipes a remembered relay as soon as the game loads", async () => {
    const { store } = await loadOnline({ ...PLAY, search: "", stored: "ws://192.168.1.66:4134/ws" });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("ignores ?relay= and never puts a relay in an invite link", async () => {
    const { online, store } = await loadOnline({ ...PLAY, search: "?join=LION042&relay=ws://192.168.1.66:4134/ws" });
    expect(online.relayTarget()).toEqual({ url: "ws://192.168.1.20:3110", lan: true });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
    expect(online.inviteRelayParam()).toBeNull();
    const link = new URL(online.inviteLink("LION042"));
    expect(link.searchParams.get("join")).toBe("LION042");
    expect(link.searchParams.has("relay")).toBe(false);
    expect(link.origin).toBe("http://192.168.1.20:4111");
  });
});

describe("emotes from the relay", () => {
  it("reach only the fixed glyph table", async () => {
    const { online } = await loadOnline({ dev: false, search: "" });
    const glyphs = ["a", "b", "c"];
    expect(online.emoteGlyphFor(glyphs, 0)).toBe("a");
    expect(online.emoteGlyphFor(glyphs, 2)).toBe("c");
    for (const bad of [3, -1, 1.5, NaN, Infinity, "1", "length", "constructor", "__proto__", null, undefined, {}, [0]]) {
      expect(online.emoteGlyphFor(glyphs, bad), String(bad)).toBeNull();
    }
  });
});
