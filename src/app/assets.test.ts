import { describe, expect, it } from "vitest";
import notices from "../../THIRD_PARTY_NOTICES.md?raw";

/** Only the glob's keys are read: no asset is loaded. */
const modelFiles = Object.keys(import.meta.glob("../../public/models/**/*.{glb,gltf,bin,png,jpg,ktx2}"));
const credits = import.meta.glob("../../public/models/*/CREDITS.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("asset licences (art direction shared rules 7)", () => {
  it("every public/models folder carries a CREDITS.txt with source, licence and SHA-256", () => {
    const folders = new Set(modelFiles.map((f) => /public\/models\/([^/]+)\//.exec(f)![1]));
    expect(folders.size).toBeGreaterThan(0);
    for (const folder of folders) {
      const text = credits[`../../public/models/${folder}/CREDITS.txt`];
      expect(text, folder).toBeDefined();
      expect(text).toMatch(/https:\/\/github\.com\//);
      expect(text).toMatch(/CC0 1\.0/);
      expect(text).toMatch(/\b[0-9a-f]{64}\b/);
    }
  });

  it("THIRD_PARTY_NOTICES.md names every pack, the fonts and the shipped files", () => {
    expect(notices).toContain("KayKit Adventurers Character Pack");
    expect(notices).toContain("KayKit Skeletons Character Pack");
    expect(notices).toContain("Lilita One");
    expect(notices).toContain("Baloo Bhaijaan 2");
    for (const f of modelFiles) expect(notices, f).toContain(f.split("/").pop()!);
  });
});
