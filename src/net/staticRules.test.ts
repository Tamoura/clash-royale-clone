import { describe, expect, it } from "vitest";
import {
  cacheControl,
  compressible,
  contentType,
  etagFor,
  etagMatches,
  fallbackLocation,
  hasExtension,
  pickEncoding,
  staticRelPath,
} from "./staticRules";

describe("staticRelPath", () => {
  it("maps request paths to root-relative files", () => {
    expect(staticRelPath("/")).toBe("");
    expect(staticRelPath("/index.html")).toBe("index.html");
    expect(staticRelPath("/assets/index-CxuJavZ1.js")).toBe("assets/index-CxuJavZ1.js");
    expect(staticRelPath("/models/kaykit/Knight.glb")).toBe("models/kaykit/Knight.glb");
    expect(staticRelPath("/models/")).toBe("models/");
    expect(staticRelPath("//models///kaykit/Knight.glb")).toBe("models/kaykit/Knight.glb");
    expect(staticRelPath("/my%20file.png")).toBe("my file.png");
  });

  it("refuses anything that could climb out of the root", () => {
    for (const bad of [
      "/../package.json",
      "/assets/../../package.json",
      "/%2e%2e/package.json",
      "/%2E%2E/package.json",
      "/assets/..%2f..%2fpackage.json",
      "/assets/..%2F..%2Fpackage.json",
      "/assets/%2e%2e%2f%2e%2e%2fpackage.json",
      "/./index.html",
      "/..",
      "/assets/..\\..\\package.json",
      "/assets/%5c..%5cpackage.json",
      "/index.html%00.png",
      "/%00",
      "/%E0%A4%A", // broken escape
      "relative/path",
      "",
      `/${"a".repeat(2000)}`,
    ]) {
      expect(staticRelPath(bad), bad).toBeNull();
    }
  });

  it("never serves dotfiles or dot-directories", () => {
    for (const bad of ["/.env", "/.git/config", "/assets/.hidden.js", "/%2egit/HEAD", "/.well-known/x"]) {
      expect(staticRelPath(bad), bad).toBeNull();
    }
  });

  it("does not decode twice", () => {
    // %252f is a literal "%2f" inside one file name (which simply won't exist).
    expect(staticRelPath("/assets/a%252f..%252fb.js")).toBe("assets/a%2f..%2fb.js");
    // A name starting with ".." is refused like any other dotfile.
    expect(staticRelPath("/assets/..%252f..%252fpackage.json")).toBeNull();
  });
});

describe("hasExtension", () => {
  it("looks at the last segment only", () => {
    expect(hasExtension("assets/x-abc.js")).toBe(true);
    expect(hasExtension("favicon.ico")).toBe(true);
    expect(hasExtension("clash-royale-clone/")).toBe(false);
    expect(hasExtension("v1.2/play")).toBe(false);
    expect(hasExtension("")).toBe(false);
  });
});

describe("contentType", () => {
  it("knows every type the game ships", () => {
    expect(contentType("index.html")).toBe("text/html; charset=utf-8");
    expect(contentType("assets/index-CxuJavZ1.js")).toBe("text/javascript; charset=utf-8");
    expect(contentType("assets/index-BVAvV-MZ.css")).toBe("text/css; charset=utf-8");
    expect(contentType("sw.js")).toBe("text/javascript; charset=utf-8");
    expect(contentType("manifest.webmanifest")).toBe("application/manifest+json; charset=utf-8");
    expect(contentType("data.json")).toBe("application/json; charset=utf-8");
    expect(contentType("icon-192.png")).toBe("image/png");
    expect(contentType("photo.JPG")).toBe("image/jpeg");
    expect(contentType("x.webp")).toBe("image/webp");
    expect(contentType("x.svg")).toBe("image/svg+xml");
    expect(contentType("favicon.ico")).toBe("image/x-icon");
    expect(contentType("assets/lilita-one-latin-400-normal-87r-Z-Re.woff2")).toBe("font/woff2");
    expect(contentType("a.woff")).toBe("font/woff");
    expect(contentType("models/kaykit/Knight.glb")).toBe("model/gltf-binary");
    expect(contentType("m.gltf")).toBe("model/gltf+json");
    expect(contentType("x.wasm")).toBe("application/wasm");
    expect(contentType("a.mp3")).toBe("audio/mpeg");
    expect(contentType("a.ogg")).toBe("audio/ogg");
    expect(contentType("a.wav")).toBe("audio/wav");
    expect(contentType("robots.txt")).toBe("text/plain; charset=utf-8");
    expect(contentType("mystery.xyz")).toBe("application/octet-stream");
    expect(contentType("noext")).toBe("application/octet-stream");
  });
});

describe("compressible", () => {
  it("compresses text, JSON, SVG and glTF; not images, fonts or audio", () => {
    for (const f of ["index.html", "a.js", "a.css", "m.webmanifest", "a.json", "a.svg", "a.glb", "a.gltf", "a.wasm"]) {
      expect(compressible(contentType(f)), f).toBe(true);
    }
    for (const f of ["a.png", "a.jpg", "a.webp", "a.woff2", "a.woff", "a.mp3", "a.ogg", "a.bin"]) {
      expect(compressible(contentType(f)), f).toBe(false);
    }
  });
});

describe("cacheControl", () => {
  it("caches hashed assets forever and revalidates the shell every time", () => {
    const year = "public, max-age=31536000, immutable";
    expect(cacheControl("assets/index-CxuJavZ1.js")).toBe(year);
    expect(cacheControl("assets/three-kC292k7M.js")).toBe(year);
    expect(cacheControl("assets/lilita-one-latin-400-normal-87r-Z-Re.woff2")).toBe(year);
    expect(cacheControl("assets/index-BVAvV-MZ.css")).toBe(year);
    for (const f of ["", "index.html", "sw.js", "manifest.webmanifest", "other/page.html"]) {
      expect(cacheControl(f), f).toBe("no-cache");
    }
    // Unhashed files (public/ copies, or a stray assets/ file) get an hour.
    expect(cacheControl("models/kaykit/Knight.glb")).toBe("public, max-age=3600");
    expect(cacheControl("icon-192.png")).toBe("public, max-age=3600");
    expect(cacheControl("assets/logo.png")).toBe("public, max-age=3600");
  });
});

describe("pickEncoding", () => {
  it("prefers brotli, then gzip, honouring q=0", () => {
    expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(pickEncoding("gzip, deflate")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip;q=0.5")).toBe("gzip");
    expect(pickEncoding("gzip;q=0")).toBeNull();
    expect(pickEncoding("*")).toBe("br");
    expect(pickEncoding("*;q=0, gzip")).toBe("gzip");
    expect(pickEncoding("identity")).toBeNull();
    expect(pickEncoding("")).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
    expect(pickEncoding(["deflate", "gzip"])).toBe("gzip");
  });
});

describe("etags", () => {
  it("builds a weak tag and compares weakly", () => {
    const tag = etagFor(1479352, 1760895000123.7);
    expect(tag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(etagFor(1479352, 1760895000123.7)).toBe(tag);
    expect(etagFor(1479353, 1760895000123.7)).not.toBe(tag);
    expect(etagMatches(tag, tag)).toBe(true);
    expect(etagMatches(tag.replace(/^W\//, ""), tag)).toBe(true);
    expect(etagMatches(`W/"x", ${tag}`, tag)).toBe(true);
    expect(etagMatches("*", tag)).toBe(true);
    expect(etagMatches('W/"other"', tag)).toBe(false);
    expect(etagMatches(undefined, tag)).toBe(false);
  });
});

describe("fallbackLocation", () => {
  it("always points at the root of this site, keeping the query", () => {
    expect(fallbackLocation("")).toBe("/");
    expect(fallbackLocation("?join=LION42")).toBe("/?join=LION42");
    expect(fallbackLocation("//evil.example")).toBe("/");
  });
});
