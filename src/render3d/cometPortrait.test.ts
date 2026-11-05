import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

// A renderer without a GPU: records what each capture rendered.
vi.mock("three", async (orig) => {
  const actual = await orig<typeof import("three")>();
  class FakeRenderer {
    /** What each render drew: names and geometry types, read before the capture clears its scene. */
    static rendered: { names: Set<string>; cones: number }[] = [];
    domElement = {};
    toneMapping = 0;
    toneMappingExposure = 1;
    dispose(): void {}
    forceContextLoss(): void {}
    setSize(): void {}
    render(scene: THREE.Object3D): void {
      const names = new Set<string>();
      let cones = 0;
      scene.traverse((o) => {
        names.add(o.name);
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.geometry as THREE.BufferGeometry).type === "ConeGeometry") cones++;
      });
      FakeRenderer.rendered.push({ names, cones });
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

type Fake = { rendered: { names: Set<string>; cones: number }[] };
const fake = (): Fake => THREE.WebGLRenderer as unknown as Fake;

describe("Comet card portrait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => {} }) }),
    });
    fake().rendered.length = 0;
  });
  afterEach(async () => {
    const { releasePortraitRenderer } = await import("./cardportraits");
    releasePortraitRenderer();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the Comet as a 3D flaming rock while other spells keep painted art", async () => {
    const { cardPortrait, SPELL_PORTRAITS } = await import("./cardportraits");
    expect(SPELL_PORTRAITS.has("comet")).toBe(true);
    expect(cardPortrait("comet")).not.toBeNull();
    const shot = fake().rendered.at(-1)!;
    expect(shot.names.has("comet-body")).toBe(true);
    expect(shot.names.has("comet-vein")).toBe(true);
    // The tail: unlit flame shells streaming off the rock.
    expect(shot.cones).toBeGreaterThanOrEqual(3);
    expect(cardPortrait("zap")).toBeNull();
  });

  it("the new troops get 3D portraits from their own rigs", async () => {
    const { cardPortrait } = await import("./cardportraits");
    for (const id of ["stone-golem", "pebble-golem", "digger"] as const) {
      expect(cardPortrait(id), id).not.toBeNull();
    }
  });
});
