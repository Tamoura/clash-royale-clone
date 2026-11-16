import { describe, expect, it } from "vitest";
import {
  RELAY_STORE_KEY,
  buildRelayUrl,
  forgetRelayOverride,
  inviteRelay,
  relayOverrideAllowed,
  resolveRelayUrl,
} from "./relayUrl";

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
/** The dev server opened on the computer that runs it: the only page that reads ?relay=. */
const HOME = { search: "", protocol: "http:", hostname: "localhost", host: "localhost:3101" };
const ENV = { VITE_RELAY_URL: "wss://relay.example.com/ws" };
/** A development build (npm run dev, npm run play). */
const DEV = { DEV: true };
const DEV_ENV = { ...ENV, ...DEV };

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

  it("in development, takes ?relay=wss://… over everything and remembers it", () => {
    const store = new MemStore();
    const page = { ...HOME, search: "?relay=wss://x.trycloudflare.com/ws" };
    expect(resolveRelayUrl(page, DEV_ENV, store)).toEqual({ url: "wss://x.trycloudflare.com/ws", lan: false });
    expect(store.getItem(RELAY_STORE_KEY)).toBe("wss://x.trycloudflare.com/ws");
    // Later visits without the parameter still use it.
    expect(resolveRelayUrl(HOME, DEV_ENV, store).url).toBe("wss://x.trycloudflare.com/ws");
    expect(resolveRelayUrl({ ...HOME, search: "?relay=wss://x" }, DEV, store).url).toBe("wss://x");
  });

  it("in development, rejects ?relay=javascript:alert(1) and other non-ws URLs", () => {
    const store = new MemStore();
    for (const bad of ["javascript:alert(1)", "http://x.com", "https://x.com/ws", "wss://", "not a url"]) {
      const page = { ...HOME, protocol: "https:", search: `?relay=${encodeURIComponent(bad)}` };
      expect(resolveRelayUrl(page, DEV, store)).toEqual({ url: null, lan: false });
    }
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
    // A bad parameter does not wipe a good remembered relay.
    store.setItem(RELAY_STORE_KEY, "wss://good.example/ws");
    expect(resolveRelayUrl({ ...HOME, search: "?relay=javascript:alert(1)" }, DEV, store).url).toBe(
      "wss://good.example/ws",
    );
  });

  it("in development, ?relay=clear forgets the remembered relay", () => {
    const store = new MemStore();
    store.setItem(RELAY_STORE_KEY, "wss://old.example/ws");
    expect(resolveRelayUrl({ ...HOME, search: "?relay=clear" }, DEV_ENV, store)).toEqual({
      url: "wss://relay.example.com/ws",
      lan: false,
    });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("upgrades ws: to wss: on https pages, but not on http ones", () => {
    expect(resolveRelayUrl(PAGES, { VITE_RELAY_URL: "ws://relay.example.com/ws" }).url).toBe(
      "wss://relay.example.com/ws",
    );
    const homeTls = { ...HOME, protocol: "https:" };
    expect(resolveRelayUrl({ ...homeTls, search: "?relay=ws://10.0.0.5:3110" }, DEV).url).toBe("wss://10.0.0.5:3110");
    expect(resolveRelayUrl({ ...HOME, search: "?relay=ws://10.0.0.5:3110" }, DEV).url).toBe("ws://10.0.0.5:3110");
  });

  it('"same-origin" points at the page\'s own server, wss on https', () => {
    const SAME = { VITE_RELAY_URL: "same-origin", BASE_URL: "/" };
    const render = { search: "", protocol: "https:", hostname: "my-game.onrender.com", host: "my-game.onrender.com" };
    expect(resolveRelayUrl(render, SAME, new MemStore())).toEqual({ url: "wss://my-game.onrender.com/ws", lan: false });
    // Plain http keeps ws: and the port (npm start on a computer or the LAN).
    const local = { search: "", protocol: "http:", hostname: "localhost", host: "localhost:3310" };
    expect(resolveRelayUrl(local, SAME)).toEqual({ url: "ws://localhost:3310/ws", lan: false });
    expect(resolveRelayUrl({ ...LAN, host: "192.168.1.20:3110" }, SAME)).toEqual({
      url: "ws://192.168.1.20:3110/ws",
      lan: false,
    });
    // Without Location.host the hostname alone is used.
    expect(resolveRelayUrl(PAGES, SAME).url).toBe("wss://tamoura.github.io/ws");
    // Case and spaces do not matter; BASE_URL defaults to "/".
    expect(resolveRelayUrl(render, { VITE_RELAY_URL: " Same-Origin " }).url).toBe("wss://my-game.onrender.com/ws");
  });

  it('"same-origin" follows the build\'s base path; a "/path" value is used as given', () => {
    const page = { ...PAGES, host: "tamoura.github.io" };
    expect(buildRelayUrl(page, { VITE_RELAY_URL: "same-origin", BASE_URL: "/clash-royale-clone/" })).toBe(
      "wss://tamoura.github.io/clash-royale-clone/ws",
    );
    expect(buildRelayUrl(page, { VITE_RELAY_URL: "same-origin", BASE_URL: "/sub" })).toBe("wss://tamoura.github.io/sub/ws");
    // A relative base ("./") cannot name a socket path: fall back to the root.
    expect(buildRelayUrl(page, { VITE_RELAY_URL: "same-origin", BASE_URL: "./" })).toBe("wss://tamoura.github.io/ws");
    expect(buildRelayUrl(page, { VITE_RELAY_URL: "/ws", BASE_URL: "/clash-royale-clone/" })).toBe(
      "wss://tamoura.github.io/ws",
    );
    expect(buildRelayUrl({ ...LAN, host: "192.168.1.20:8080" }, { VITE_RELAY_URL: "/relay/ws" })).toBe(
      "ws://192.168.1.20:8080/relay/ws",
    );
  });

  it("refuses same-origin values that are not plain paths or pages that are not http(s)", () => {
    for (const bad of ["//evil.example/ws", "/ws?x=1", "/ws#x", "/w s", "/ws\\x"]) {
      expect(buildRelayUrl(PAGES, { VITE_RELAY_URL: bad }), bad).toBeNull();
    }
    const file = { search: "", protocol: "file:", hostname: "", host: "" };
    expect(buildRelayUrl(file, { VITE_RELAY_URL: "same-origin" })).toBeNull();
    expect(resolveRelayUrl(file, { VITE_RELAY_URL: "same-origin" })).toEqual({ url: null, lan: false });
  });

  it("in development, a ?relay= link still beats a same-origin build, and ?relay=clear returns to it", () => {
    const store = new MemStore();
    const SAME = { VITE_RELAY_URL: "same-origin", BASE_URL: "/", DEV: true };
    expect(resolveRelayUrl({ ...HOME, search: "?relay=wss://other.example/ws" }, SAME, store).url).toBe(
      "wss://other.example/ws",
    );
    expect(resolveRelayUrl({ ...HOME, search: "?relay=clear" }, SAME, store).url).toBe("ws://localhost:3101/ws");
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("buildRelayUrl matches the old handling of absolute URLs", () => {
    expect(buildRelayUrl(PAGES, ENV)).toBe("wss://relay.example.com/ws");
    expect(buildRelayUrl(PAGES, { VITE_RELAY_URL: "ws://relay.example.com/ws" })).toBe("wss://relay.example.com/ws");
    expect(buildRelayUrl(LAN, { VITE_RELAY_URL: "ws://relay.example.com/ws" })).toBe("ws://relay.example.com/ws");
    expect(buildRelayUrl(PAGES, { VITE_RELAY_URL: "https://relay.example.com/ws" })).toBeNull();
    expect(buildRelayUrl(PAGES, { VITE_RELAY_URL: "  " })).toBeNull();
    expect(buildRelayUrl(PAGES, {})).toBeNull();
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
    expect(resolveRelayUrl({ ...HOME, search: "?relay=wss://x" }, DEV, broken).url).toBe("wss://x");
    expect(resolveRelayUrl(PAGES, ENV, broken).url).toBe("wss://relay.example.com/ws");
    expect(resolveRelayUrl({ ...PAGES, search: "?relay=wss://x" }, ENV, broken).url).toBe("wss://relay.example.com/ws");
  });
});

/**
 * A published build (GitHub Pages, Render, npm start: anything but the dev
 * server) talks only to the relay baked in at build time, or to the LAN
 * relay beside a plain-http page. A link cannot pick the server the kid's
 * name, crest and deck go to.
 */
describe("resolveRelayUrl in a published build", () => {
  /** What .github/workflows/deploy.yml builds for GitHub Pages, with the Render relay. */
  const PAGES_ENV = { VITE_RELAY_URL: "wss://clash-royale-clone.onrender.com/ws", BASE_URL: "/clash-royale-clone/" };
  const PAGES_HOST = { ...PAGES, host: "tamoura.github.io" };

  it("ignores ?relay= and keeps the baked-in relay", () => {
    const store = new MemStore();
    const page = { ...PAGES_HOST, search: "?relay=wss://evil.example/ws" };
    expect(resolveRelayUrl(page, PAGES_ENV, store)).toEqual({ url: "wss://clash-royale-clone.onrender.com/ws", lan: false });
    expect(resolveRelayUrl(page, { ...PAGES_ENV, DEV: false }, store).url).toBe("wss://clash-royale-clone.onrender.com/ws");
    // Nothing is remembered for later visits.
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
    // With the parameter mixed in with a join link, too.
    const invite = { ...PAGES_HOST, search: "?join=LION042&relay=wss%3A%2F%2Fevil.example%2Fws" };
    expect(resolveRelayUrl(invite, PAGES_ENV, store).url).toBe("wss://clash-royale-clone.onrender.com/ws");
  });

  it("ignores and removes a relay remembered by an older build", () => {
    const store = new MemStore();
    store.setItem(RELAY_STORE_KEY, "wss://evil2.example/ws");
    store.setItem("cr-clone-trophies", "300");
    expect(resolveRelayUrl(PAGES_HOST, PAGES_ENV, store).url).toBe("wss://clash-royale-clone.onrender.com/ws");
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
    // Only that one key goes.
    expect(store.getItem("cr-clone-trophies")).toBe("300");
  });

  it("ignores ?relay=clear (nothing to clear: the store is wiped anyway)", () => {
    const store = new MemStore();
    store.setItem(RELAY_STORE_KEY, "wss://old.example/ws");
    expect(resolveRelayUrl({ ...PAGES_HOST, search: "?relay=clear" }, PAGES_ENV, store).url).toBe(
      "wss://clash-royale-clone.onrender.com/ws",
    );
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("with no relay baked in, a link cannot switch online play on", () => {
    const store = new MemStore();
    store.setItem(RELAY_STORE_KEY, "wss://evil2.example/ws");
    const page = { ...PAGES_HOST, search: "?relay=wss://evil.example/ws" };
    expect(resolveRelayUrl(page, { BASE_URL: "/clash-royale-clone/" }, store)).toEqual({ url: null, lan: false });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("keeps the same-origin and LAN fallbacks as they were", () => {
    const SAME = { VITE_RELAY_URL: "same-origin", BASE_URL: "/" };
    const render = { search: "?relay=wss://evil.example/ws", protocol: "https:", hostname: "my-game.onrender.com", host: "my-game.onrender.com" };
    expect(resolveRelayUrl(render, SAME, new MemStore())).toEqual({ url: "wss://my-game.onrender.com/ws", lan: false });
    const local = { search: "?relay=wss://evil.example/ws", protocol: "http:", hostname: "127.0.0.1", host: "127.0.0.1:4111" };
    expect(resolveRelayUrl(local, SAME, new MemStore())).toEqual({ url: "ws://127.0.0.1:4111/ws", lan: false });
    // A plain-http page with no relay baked in: the LAN relay on its own host.
    const lan = { ...LAN, search: "?relay=wss://evil.example/ws" };
    expect(resolveRelayUrl(lan, {}, new MemStore())).toEqual({ url: "ws://192.168.1.20:3110", lan: true });
  });

  it("only DEV === true counts as a development build", () => {
    const page = { ...HOME, search: "?relay=wss://picked.example/ws" };
    for (const env of [{}, { DEV: false }, { DEV: "true" }, { DEV: 1 }] as unknown as { DEV?: boolean }[]) {
      expect(resolveRelayUrl(page, { ...ENV, ...env }, new MemStore()).url).toBe("wss://relay.example.com/ws");
    }
    expect(resolveRelayUrl(page, DEV_ENV, new MemStore()).url).toBe("wss://picked.example/ws");
  });

  it("forgetRelayOverride removes the key and survives blocked storage", () => {
    const store = new MemStore();
    store.setItem(RELAY_STORE_KEY, "wss://evil.example/ws");
    forgetRelayOverride(store);
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
    const broken = {
      removeItem() {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => forgetRelayOverride(broken)).not.toThrow();
    expect(() => forgetRelayOverride(undefined)).not.toThrow();
  });
});

/**
 * `npm run play` serves the dev server to the kids' devices by its LAN
 * address. Those pages are development builds too, but a link must not pick
 * their relay either: they always find the LAN relay beside the page.
 */
describe("resolveRelayUrl on the dev server reached from another device (npm run play)", () => {
  const PLAY = { ...LAN, host: "192.168.1.20:3101" };

  it("ignores ?relay= and uses the LAN relay beside the page", () => {
    const store = new MemStore();
    const page = { ...PLAY, search: "?relay=ws://192.168.1.66:4134/ws" };
    expect(resolveRelayUrl(page, DEV, store)).toEqual({ url: "ws://192.168.1.20:3110", lan: true });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
    const invite = { ...PLAY, search: "?join=LION042&relay=ws%3A%2F%2F192.168.1.66%3A4134%2Fws" };
    expect(resolveRelayUrl(invite, DEV, store)).toEqual({ url: "ws://192.168.1.20:3110", lan: true });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("ignores and removes a remembered relay", () => {
    const store = new MemStore();
    store.setItem(RELAY_STORE_KEY, "ws://192.168.1.66:4134/ws");
    expect(resolveRelayUrl(PLAY, DEV, store)).toEqual({ url: "ws://192.168.1.20:3110", lan: true });
    expect(store.getItem(RELAY_STORE_KEY)).toBeNull();
  });

  it("only localhost, 127.0.0.1 and [::1] count as the developer's own computer", () => {
    for (const hostname of ["localhost", "LOCALHOST", "127.0.0.1", "[::1]"]) {
      expect(relayOverrideAllowed({ ...HOME, hostname }, DEV), hostname).toBe(true);
      expect(relayOverrideAllowed({ ...HOME, hostname }, {}), hostname).toBe(false);
      expect(relayOverrideAllowed({ ...HOME, hostname }, { DEV: false }), hostname).toBe(false);
    }
    for (const hostname of [
      "192.168.1.20",
      "10.0.0.5",
      "my-laptop.local",
      "localhost.evil.example",
      "127.0.0.1.nip.io",
      "evil-localhost",
      "tamoura.github.io",
      "",
    ]) {
      expect(relayOverrideAllowed({ ...HOME, hostname }, DEV), hostname).toBe(false);
    }
  });
});

describe("inviteRelay (the relay an invite link names)", () => {
  const picked = { url: "wss://picked.example/ws", lan: false };

  it("names a hand-picked relay only on the development server opened on its own computer", () => {
    expect(inviteRelay(picked, HOME, DEV_ENV)).toBe("wss://picked.example/ws");
    expect(inviteRelay(picked, HOME, ENV)).toBeNull();
    expect(inviteRelay(picked, HOME, { ...ENV, DEV: false })).toBeNull();
    expect(inviteRelay(picked, HOME, {})).toBeNull();
    expect(inviteRelay(picked, PAGES, ENV)).toBeNull();
    // The kids' devices in npm run play: a dev build reached by its LAN address.
    expect(inviteRelay(picked, LAN, DEV)).toBeNull();
    expect(inviteRelay(picked, PAGES, DEV_ENV)).toBeNull();
  });

  it("never names the build's own relay, the LAN relay or no relay", () => {
    expect(inviteRelay({ url: "wss://relay.example.com/ws", lan: false }, HOME, DEV_ENV)).toBeNull();
    // ws: and wss: name the same relay.
    expect(inviteRelay({ url: "ws://relay.example.com/ws", lan: false }, HOME, DEV_ENV)).toBeNull();
    expect(inviteRelay({ url: "ws://localhost:3110", lan: true }, HOME, DEV)).toBeNull();
    expect(inviteRelay({ url: null, lan: false }, HOME, DEV)).toBeNull();
    const SAME = { VITE_RELAY_URL: "same-origin", BASE_URL: "/", DEV: true };
    const local = { search: "", protocol: "http:", hostname: "localhost", host: "localhost:3101" };
    expect(inviteRelay({ url: "ws://localhost:3101/ws", lan: false }, local, SAME)).toBeNull();
  });
});
