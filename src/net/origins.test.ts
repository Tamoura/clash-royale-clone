import { describe, expect, it } from "vitest";
import { originAllowed, originOf, originPolicy, relayOriginPolicy } from "./origins";

describe("originPolicy", () => {
  it("defaults to any origin in dev and the local dev page in production", () => {
    expect(originPolicy(undefined, false)).toEqual({ any: true, allowed: [] });
    expect(originPolicy(undefined, true)).toEqual({ any: false, allowed: ["http://localhost:3101"] });
  });

  it("parses the comma list, trimming spaces and trailing slashes", () => {
    const p = originPolicy(" https://tamoura.github.io/ , http://localhost:3101", true);
    expect(p.any).toBe(false);
    expect(p.allowed).toEqual(expect.arrayContaining(["https://tamoura.github.io", "http://localhost:3101"]));
    expect(originPolicy("*", true).any).toBe(true);
  });

  it("always adds the server's own public URL (RENDER_EXTERNAL_URL)", () => {
    const p = originPolicy(undefined, true, ["https://my-game.onrender.com", undefined, "junk"]);
    expect(p.allowed).toEqual(expect.arrayContaining(["http://localhost:3101", "https://my-game.onrender.com"]));
    expect(p.allowed).not.toContain("junk");
  });
});

describe("originAllowed", () => {
  const prod = originPolicy(undefined, true);

  it("allows everything when the policy says *", () => {
    expect(originAllowed("https://evil.example", [], originPolicy("*", true))).toBe(true);
    expect(originAllowed(undefined, [], originPolicy(undefined, false))).toBe(true);
  });

  it("allows listed origins, as before", () => {
    const p = originPolicy("https://tamoura.github.io", true);
    expect(originAllowed("https://tamoura.github.io", ["relay.fly.dev"], p)).toBe(true);
    expect(originAllowed("https://tamoura.github.io/", ["relay.fly.dev"], p)).toBe(true);
    expect(originAllowed("https://TAMOURA.github.io", ["relay.fly.dev"], p)).toBe(true);
    expect(originAllowed("https://evil.example", ["relay.fly.dev"], p)).toBe(false);
    expect(originAllowed("http://tamoura.github.io", ["relay.fly.dev"], p)).toBe(false);
  });

  it("allows the page the server itself served: Origin host equals the Host header", () => {
    expect(originAllowed("http://localhost:3310", ["localhost:3310"], prod)).toBe(true);
    expect(originAllowed("https://my-game.onrender.com", ["my-game.onrender.com"], prod)).toBe(true);
    // Default ports are implied on either side.
    expect(originAllowed("https://my-game.onrender.com", ["my-game.onrender.com:443"], prod)).toBe(true);
    expect(originAllowed("http://192.168.1.20", ["192.168.1.20:80"], prod)).toBe(true);
    expect(originAllowed("http://[::1]:3310", ["[::1]:3310"], prod)).toBe(true);
    // Host names are case-insensitive.
    expect(originAllowed("https://My-Game.onrender.com", ["my-game.ONRENDER.com"], prod)).toBe(true);
  });

  it("also accepts the host a proxy reports in X-Forwarded-Host", () => {
    expect(originAllowed("https://game.example.com", ["127.0.0.1:3110", "game.example.com"], prod)).toBe(true);
    expect(originAllowed("https://game.example.com", ["127.0.0.1:3110", ["a.example", "game.example.com"]], prod)).toBe(
      true,
    );
    expect(originAllowed("https://game.example.com", ["127.0.0.1:3110", "a.example, game.example.com"], prod)).toBe(true);
  });

  it("refuses other sites, other ports and odd origins", () => {
    expect(originAllowed("https://evil.example", ["my-game.onrender.com"], prod)).toBe(false);
    expect(originAllowed("https://my-game.onrender.com.evil.example", ["my-game.onrender.com"], prod)).toBe(false);
    expect(originAllowed("http://localhost:9999", ["localhost:3310"], prod)).toBe(false);
    // An https page on the default port is not the same as port 80.
    expect(originAllowed("https://my-game.example", ["my-game.example:80"], prod)).toBe(false);
    expect(originAllowed(undefined, ["localhost:3310"], prod)).toBe(false);
    expect(originAllowed("", ["localhost:3310"], prod)).toBe(false);
    expect(originAllowed("null", ["null"], prod)).toBe(false);
    expect(originAllowed("file://", ["localhost:3310"], prod)).toBe(false);
    expect(originAllowed("chrome-extension://abc", ["abc"], prod)).toBe(false);
    // Garbage Host headers never match.
    expect(originAllowed("https://a.example", ["a.example/evil", "a.example@b", " "], prod)).toBe(false);
    expect(originAllowed("https://a.example", [undefined, []], prod)).toBe(false);
  });
});

describe("relayOriginPolicy", () => {
  const evil = "https://evil.example";

  it("lets any site use a relay-only server outside production (LAN, dev, tunnels)", () => {
    for (const NODE_ENV of [undefined, "development", ""]) {
      const p = relayOriginPolicy({ NODE_ENV }, false);
      expect(p.any).toBe(true);
      expect(originAllowed(evil, ["relay.example"], p)).toBe(true);
    }
  });

  it("serving the game means own pages only, even with NODE_ENV unset (plain npm start)", () => {
    for (const NODE_ENV of [undefined, "development", "production"]) {
      const p = relayOriginPolicy({ NODE_ENV }, true);
      expect(p.any).toBe(false);
      expect(originAllowed(evil, ["my-game.example"], p)).toBe(false);
      expect(originAllowed("https://my-game.example", ["my-game.example"], p)).toBe(true);
      expect(originAllowed("http://192.168.1.20:3110", ["192.168.1.20:3110"], p)).toBe(true);
      expect(originAllowed("http://localhost:3101", ["localhost:3110"], p)).toBe(true);
    }
  });

  it("production is strict for a relay-only server too", () => {
    const p = relayOriginPolicy({ NODE_ENV: "production" }, false);
    expect(p.any).toBe(false);
    expect(originAllowed(evil, ["relay.fly.dev"], p)).toBe(false);
  });

  it("ALLOWED_ORIGINS always wins, and RENDER_EXTERNAL_URL is always allowed", () => {
    expect(relayOriginPolicy({ ALLOWED_ORIGINS: "*" }, true).any).toBe(true);
    const p = relayOriginPolicy(
      { ALLOWED_ORIGINS: "https://tamoura.github.io", RENDER_EXTERNAL_URL: "https://cr.onrender.com" },
      true,
    );
    expect(p.any).toBe(false);
    expect(p.allowed).toEqual(expect.arrayContaining(["https://tamoura.github.io", "https://cr.onrender.com"]));
    expect(p.allowed).not.toContain("http://localhost:3101");
  });
});

describe("originOf", () => {
  it("normalises http(s) URLs to scheme://host[:port]", () => {
    expect(originOf("https://My-Game.onrender.com/")).toBe("https://my-game.onrender.com");
    expect(originOf("https://x.example:443/path?q")).toBe("https://x.example");
    expect(originOf("http://x.example:8080")).toBe("http://x.example:8080");
    expect(originOf("wss://x.example")).toBeNull();
    expect(originOf("")).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});
