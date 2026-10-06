import { describe, expect, it } from "vitest";
import { RELAY_STORE_KEY, resolveRelayUrl } from "./relayUrl";

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

const PAGES = { search: "", protocol: "https:", hostname: "tamoura.github.io" };
const LAN = { search: "", protocol: "http:", hostname: "192.168.1.20" };
const ENV = { VITE_RELAY_URL: "wss://relay.example.com/ws" };

describe("resolveRelayUrl", () => {
  it("returns null on an https page with no env and nothing remembered", () => {
    expect(resolveRelayUrl(PAGES, {}, new MemStore())).toEqual({ url: null, lan: false });
    expect(resolveRelayUrl(PAGES, { VITE_RELAY_URL: "" })).toEqual({ url: null, lan: false });
  });

  it("uses the build's VITE_RELAY_URL", () => {
    expect(resolveRelayUrl(PAGES, ENV)).toEqual({ url: "wss://relay.example.com/ws", lan: false });
    // The env beats the implied LAN relay too.
    expect(resolveRelayUrl(LAN, ENV)).toEqual({ url: "wss://relay.example.com/ws", lan: false });
  });

  it("points a plain-http LAN page at ws://<host>:3110", () => {
    expect(resolveRelayUrl(LAN, {})).toEqual({ url: "ws://192.168.1.20:3110", lan: true });
    expect(resolveRelayUrl({ ...LAN, hostname: "localhost" }, {})).toEqual({ url: "ws://localhost:3110", lan: true });
  });

  it("takes ?relay=wss://… over everything and remembers it", () => {
    const store = new MemStore();
    const page = { ...PAGES, search: "?relay=wss://x.trycloudflare.com/ws" };
    expect(resolveRelayUrl(page, ENV, store)).toEqual({ url: "wss://x.trycloudflare.com/ws", lan: false });
    expect(store.getItem(RELAY_STORE_KEY)).toBe("wss://x.trycloudflare.com/ws");
    // Later visits without the parameter still use it.
    expect(resolveRelayUrl(PAGES, ENV, store).url).toBe("wss://x.trycloudflare.com/ws");
    expect(resolveRelayUrl({ ...PAGES, search: "?relay=wss://x" }, {}, store).url).toBe("wss://x");
  });

  it("rejects ?relay=javascript:alert(1) and other non-ws URLs", () => {
    const store = new MemStore();
    for (const bad of ["javascript:alert(1)", "http://x.com", "https://x.com/ws", "wss://", "not a url"]) {
      const page = { ...PAGES, search: `?relay=${encodeURIComponent(bad)}` };
      expect(resolveRelayUrl(page, {}, store)).toEqual({ url: null, lan: false });
    }
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
    // A bad parameter does not wipe a good remembered relay.
    store.setItem(RELAY_STORE_KEY, "wss://good.example/ws");
    expect(resolveRelayUrl({ ...PAGES, search: "?relay=javascript:alert(1)" }, {}, store).url).toBe(
      "wss://good.example/ws",
    );
  });

  it("?relay=clear forgets the remembered relay", () => {
    const store = new MemStore();
    store.setItem(RELAY_STORE_KEY, "wss://old.example/ws");
    expect(resolveRelayUrl({ ...PAGES, search: "?relay=clear" }, ENV, store)).toEqual({
      url: "wss://relay.example.com/ws",
      lan: false,
    });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("upgrades ws: to wss: on https pages, but not on http ones", () => {
    expect(resolveRelayUrl(PAGES, { VITE_RELAY_URL: "ws://relay.example.com/ws" }).url).toBe(
      "wss://relay.example.com/ws",
    );
    expect(resolveRelayUrl({ ...PAGES, search: "?relay=ws://10.0.0.5:3110" }, {}).url).toBe("wss://10.0.0.5:3110");
    expect(resolveRelayUrl({ ...LAN, search: "?relay=ws://10.0.0.5:3110" }, {}).url).toBe("ws://10.0.0.5:3110");
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(resolveRelayUrl({ ...PAGES, search: "?relay=wss://x" }, {}, broken).url).toBe("wss://x");
    expect(resolveRelayUrl(PAGES, ENV, broken).url).toBe("wss://relay.example.com/ws");
  });
});
