import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStaticSite, type StaticSite } from "./static";

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

let dir: string;
let root: string;
let site: StaticSite;
let server: Server;
let port: number;

const JS = `console.log(${JSON.stringify("x".repeat(5000))});\n`;

/** A raw request: the path goes out exactly as written (no URL clean-up). */
function get(path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "static-test-"));
  root = join(dir, "dist");
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(join(root, "models"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<!doctype html><title>game</title>");
  writeFileSync(join(root, "sw.js"), "self.addEventListener('fetch', () => {});");
  writeFileSync(join(root, "manifest.webmanifest"), '{"name":"game"}');
  writeFileSync(join(root, "assets", "index-CxuJavZ1.js"), JS);
  writeFileSync(join(root, "assets", "font-87r-Z-Re.woff2"), Buffer.alloc(4000, 7));
  writeFileSync(join(root, "models", "Knight.glb"), Buffer.alloc(8000, 1));
  writeFileSync(join(root, ".env"), "SECRET=1");
  writeFileSync(join(root, ".git", "config"), "secret");
  writeFileSync(join(dir, "package.json"), '{"secret":true}');
  symlinkSync(join(dir, "package.json"), join(root, "leak.json"));
  symlinkSync(dir, join(root, "up"));
  symlinkSync(join(root, ".env"), join(root, "peek.txt"));
  symlinkSync(join(root, "assets", "index-CxuJavZ1.js"), join(root, "alias.js"));

  const opened = openStaticSite(root, () => {});
  if (!opened) throw new Error("site did not open");
  site = opened;
  server = createServer((req, res) => {
    const raw = req.url ?? "/";
    void site.serve(req, res, new URL(raw.startsWith("/") ? `http://t${raw}` : `http://t/${raw}`));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("openStaticSite", () => {
  it("is off when the folder or its index.html is missing", () => {
    expect(openStaticSite(join(dir, "nope"))).toBeNull();
    expect(openStaticSite(join(root, "assets"))).toBeNull();
  });

  it("serves the page at / and /index.html, never cached without revalidating", async () => {
    for (const path of ["/", "/index.html"]) {
      const r = await get(path);
      expect(r.status, path).toBe(200);
      expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(r.headers["cache-control"]).toBe("no-cache");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.body.toString()).toContain("<title>game</title>");
    }
  });

  it("serves sw.js and the manifest with no-cache", async () => {
    const sw = await get("/sw.js");
    expect(sw.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(sw.headers["cache-control"]).toBe("no-cache");
    const mf = await get("/manifest.webmanifest");
    expect(mf.headers["content-type"]).toBe("application/manifest+json; charset=utf-8");
    expect(mf.headers["cache-control"]).toBe("no-cache");
  });

  it("compresses hashed JS with brotli or gzip and caches it for a year", async () => {
    const plain = await get("/assets/index-CxuJavZ1.js");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body.toString()).toBe(JS);
    expect(plain.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(plain.headers.vary).toBe("accept-encoding");

    const br = await get("/assets/index-CxuJavZ1.js", { "accept-encoding": "gzip, deflate, br" });
    expect(br.headers["content-encoding"]).toBe("br");
    expect(Number(br.headers["content-length"])).toBe(br.body.length);
    expect(br.body.length).toBeLessThan(JS.length / 5);
    expect(brotliDecompressSync(br.body).toString()).toBe(JS);

    const gz = await get("/assets/index-CxuJavZ1.js", { "accept-encoding": "gzip" });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gz.body).toString()).toBe(JS);
  });

  it("compresses .glb models but not fonts", async () => {
    const glb = await get("/models/Knight.glb", { "accept-encoding": "gzip" });
    expect(glb.headers["content-type"]).toBe("model/gltf-binary");
    expect(glb.headers["content-encoding"]).toBe("gzip");
    expect(glb.headers["cache-control"]).toBe("public, max-age=3600");
    const font = await get("/assets/font-87r-Z-Re.woff2", { "accept-encoding": "gzip, br" });
    expect(font.headers["content-type"]).toBe("font/woff2");
    expect(font.headers["content-encoding"]).toBeUndefined();
    expect(font.body.length).toBe(4000);
  });

  it("answers HEAD with headers only, and If-None-Match with 304", async () => {
    const head = await get("/assets/index-CxuJavZ1.js", { "accept-encoding": "br" }, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers["content-encoding"]).toBe("br");
    expect(Number(head.headers["content-length"])).toBeGreaterThan(0);
    expect(head.body.length).toBe(0);
    const etag = head.headers.etag as string;
    expect(etag).toMatch(/^W\//);
    const again = await get("/assets/index-CxuJavZ1.js", { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it("refuses other methods", async () => {
    const r = await get("/index.html", {}, "POST");
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe("GET, HEAD");
  });

  it("never leaves the root: traversal, encoded slashes, NUL, backslashes", async () => {
    for (const path of [
      "/../package.json",
      "/%2e%2e/package.json",
      "/assets/..%2f..%2fpackage.json",
      "/assets/%2e%2e%2f%2e%2e%2fpackage.json",
      "/assets/..%5c..%5cpackage.json",
      "/index.html%00.js",
      "/up/package.json",
      "/leak.json",
    ]) {
      const r = await get(path);
      expect(r.status, path).toBeGreaterThanOrEqual(300);
      expect(r.body.toString(), path).not.toContain("secret");
    }
  });

  it("never serves dotfiles, even through a symlink", async () => {
    for (const path of ["/.env", "/.git/config", "/%2eenv", "/peek.txt"]) {
      const r = await get(path);
      expect(r.status, path).toBe(404);
      expect(r.body.toString(), path).not.toContain("SECRET");
      expect(r.body.toString(), path).not.toContain("secret");
    }
  });

  it("follows symlinks that stay inside the root", async () => {
    const r = await get("/alias.js");
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe(JS);
  });

  it("sends unknown pages to the game and unknown files to 404", async () => {
    const page = await get("/clash-royale-clone/?join=LION42");
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe("/?join=LION42");
    const deep = await get("//evil.example/x");
    expect(deep.status).toBe(302);
    expect(deep.headers.location).toBe("/");
    const dirNoIndex = await get("/models/");
    expect(dirNoIndex.status).toBe(302);
    const missing = await get("/assets/nope-12345678.js");
    expect(missing.status).toBe(404);
  });
});
