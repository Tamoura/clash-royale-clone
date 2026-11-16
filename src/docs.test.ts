import { describe, expect, it } from "vitest";
import deployDoc from "../docs/deploy-multiplayer.md?raw";
import readme from "../README.md?raw";
import pkgRaw from "../package.json?raw";
import relaySource from "../server/relay.ts?raw";
import relayUrlSource from "./net/relayUrl.ts?raw";
import renderYaml from "../render.yaml?raw";
import deployYml from "../.github/workflows/deploy.yml?raw";
import { buildRelayUrl } from "./net/relayUrl";

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

  it("match the deploy gate: checks before Render, one publishing branch, a relay for Pages", () => {
    const field = (yaml: string, name: string) =>
      new RegExp(`^\\s*${name}:\\s*(.+)$`, "m").exec(yaml)?.[1].trim();
    // Render goes live only after the commit's GitHub checks pass.
    expect(field(renderYaml, "autoDeployTrigger")).toBe("checksPass");

    // Pages publishes from exactly the branch Render deploys, so both copies
    // of the game come from the same code, and that branch always has checks.
    const branch = field(renderYaml, "branch");
    const push = /^on:\n {2}push:\n(?: {4}#.*\n)* {4}branches:\s*\[([^\]]*)\]/m.exec(deployYml);
    expect(push, "deploy.yml on.push.branches").not.toBeNull();
    expect(push![1].split(",").map((b) => b.trim())).toEqual([branch]);
    expect(deployYml).toMatch(/^ {2}workflow_dispatch:/m);
    // The checks Render waits for: typecheck and tests, before the build.
    expect(deployYml).toContain("run: npx tsc --noEmit");
    expect(deployYml).toContain("run: npx vitest run");
    expect(deployYml).toMatch(/^ {2}build:\n {4}needs: verify$/m);

    // The Pages build bakes in a working relay even with no RELAY_URL
    // variable; the variable still wins when it is set.
    const relayLine = field(deployYml, "VITE_RELAY_URL") ?? "";
    const m = /^\$\{\{\s*vars\.RELAY_URL\s*\|\|\s*'([^']+)'\s*\}\}$/.exec(relayLine);
    expect(m, `VITE_RELAY_URL: ${relayLine}`).not.toBeNull();
    const fallback = m![1];
    expect(fallback).toBe(`wss://${field(renderYaml, "name")}.onrender.com/ws`);
    const pages = { search: "", protocol: "https:", hostname: "tamoura.github.io" };
    expect(buildRelayUrl(pages, { VITE_RELAY_URL: fallback, BASE_URL: "/clash-royale-clone/" })).toBe(fallback);
    // ...and that relay lets the Pages copy in.
    const origins = /- key: ALLOWED_ORIGINS\n\s+value:\s*(.+)/.exec(renderYaml)?.[1] ?? "";
    expect(origins.split(",").map((o) => o.trim())).toContain("https://tamoura.github.io");
  });

  // 520: round 2 added "Two addresses, two saves" (moving progress between
  // the Render and Pages links with a save code) and its troubleshooting line.
  // 540: Stage 0 added the checks gate and the one publishing branch.
  it("stay within the 350-540 line budget and keep the README link", () => {
    const lines = deployDoc.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(350);
    expect(lines).toBeLessThanOrEqual(540);
    expect(readme).toContain("docs/deploy-multiplayer.md");
  });
});
