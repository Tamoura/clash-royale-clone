import { describe, expect, it } from "vitest";
import deployDoc from "../docs/deploy-multiplayer.md?raw";
import readme from "../README.md?raw";
import pkgRaw from "../package.json?raw";
import relaySource from "../server/relay.ts?raw";
import relayUrlSource from "./net/relayUrl.ts?raw";
import renderYaml from "../render.yaml?raw";

/**
 * Keeps the multiplayer docs honest: every `npm run <script>` they tell the
 * reader to type exists, and every setting in the configuration table is
 * actually read by the relay or the page's relay resolver.
 */
const scripts = Object.keys((JSON.parse(pkgRaw) as { scripts: Record<string, string> }).scripts);

function npmRuns(text: string): string[] {
  return [...text.matchAll(/npm run(?:\s+--?[\w-]+)*\s+([\w:.-]+)/g)].map((m) => m[1]);
}

function configTableVars(doc: string): string[] {
  const start = doc.indexOf("## (h) Configuration reference");
  const end = doc.indexOf("\n## ", start + 1);
  const table = doc.slice(start, end);
  return [...table.matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`/gm)].map((m) => m[1]);
}

describe("multiplayer docs", () => {
  it("only mention npm scripts that exist", () => {
    const used = [...npmRuns(deployDoc), ...npmRuns(readme)];
    expect(used).toEqual(expect.arrayContaining(["play", "build:relay", "relay:prod"]));
    for (const name of used) expect(scripts, `npm run ${name}`).toContain(name);
  });

  it("keep the relay scripts relay-only and npm start serving the game", () => {
    // A leftover dist/ must not turn `npm run relay:prod` (the tunnel path,
    // any origin allowed) into a game server that only takes its own pages.
    const pkgScripts = (JSON.parse(pkgRaw) as { scripts: Record<string, string> }).scripts;
    expect(pkgScripts.relay).toMatch(/server\/relay\.ts --relay-only$/);
    expect(pkgScripts["relay:prod"]).toMatch(/dist-server\/relay\.mjs --relay-only$/);
    expect(pkgScripts.start).not.toContain("--relay-only");
    expect(relaySource).toContain('includes("--relay-only")');
  });

  it("list only settings the code reads", () => {
    const vars = configTableVars(deployDoc);
    expect(vars).toEqual(
      expect.arrayContaining([
        "PORT",
        "RELAY_PORT",
        "ALLOWED_ORIGINS",
        "MAX_CONN_PER_IP",
        "TRUST_PROXY",
        "QUICK_MATCH",
        "NODE_ENV",
        "VITE_RELAY_URL",
      ]),
    );
    for (const v of vars) {
      const read = new RegExp(`\\b${v}\\b`).test(relaySource) || new RegExp(`\\b${v}\\b`).test(relayUrlSource);
      expect(read, `${v} is documented but not read by server/relay.ts or src/net/relayUrl.ts`).toBe(true);
    }
    expect(deployDoc).toContain("`?relay=`");
  });

  it("match render.yaml: real scripts, the start command, one branch everywhere", () => {
    const field = (name: string) => new RegExp(`^\\s*${name}:\\s*(.+)$`, "m").exec(renderYaml)?.[1].trim();
    expect(field("plan")).toBe("free");
    expect(field("healthCheckPath")).toBe("/healthz");
    for (const name of npmRuns(field("buildCommand") ?? "")) expect(scripts, `npm run ${name}`).toContain(name);
    expect(field("buildCommand")).toContain("npm run build:all");
    const pkgScripts = (JSON.parse(pkgRaw) as { scripts: Record<string, string> }).scripts;
    expect(field("startCommand")).toBe(pkgScripts.start);
    // The Deploy to Render buttons and the dashboard steps name the branch render.yaml deploys.
    const branch = field("branch") ?? "";
    expect(branch).not.toBe("");
    for (const text of [readme, deployDoc]) {
      expect(text).toContain(`https://render.com/deploy?repo=https://github.com/tamoura/clash-royale-clone/tree/${branch}`);
    }
    expect(deployDoc).toContain(`\`${branch}\``);
  });

  it("stay within the 350-500 line budget and keep the README link", () => {
    const lines = deployDoc.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(350);
    expect(lines).toBeLessThanOrEqual(500);
    expect(readme).toContain("docs/deploy-multiplayer.md");
  });
});
