import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

// A renderer without a GPU: counts instances and records disposal.
vi.mock("three", async (orig) => {
  const actual = await orig<typeof import("three")>();
  class FakeRenderer {
    static instances: FakeRenderer[] = [];
    domElement = {};
    toneMapping = 0;
    toneMappingExposure = 1;
    dispose = vi.fn();
    forceContextLoss = vi.fn();
    constructor() {
      FakeRenderer.instances.push(this);
    }
    setSize(): void {}
    render(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock("./scene/common", async (orig) => {
  const actual = await orig<typeof import("./scene/common")>();
  return { ...actual, disposeDeep: vi.fn(actual.disposeDeep) };
});

type Fake = { instances: { dispose: ReturnType<typeof vi.fn>; forceContextLoss: ReturnType<typeof vi.fn> }[] };
const fake = (): Fake => THREE.WebGLRenderer as unknown as Fake;

describe("card portraits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => {} }) }),
    });
    fake().instances.length = 0;
  });
  afterEach(async () => {
    const { releasePortraitRenderer } = await import("./cardportraits");
    releasePortraitRenderer();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reuses one offscreen renderer for every capture", async () => {
    const { cardPortrait, portraitRendererAlive } = await import("./cardportraits");
    expect(cardPortrait("knight")).not.toBeNull();
    expect(cardPortrait("musketeer")).not.toBeNull();
    expect(cardPortrait("wizard")).not.toBeNull();
    expect(fake().instances.length).toBe(1);
    expect(portraitRendererAlive()).toBe(true);
  });

  it("disposes each capture's rig once the pixels are copied out", async () => {
    const { cardPortrait } = await import("./cardportraits");
    const { disposeDeep } = await import("./scene/common");
    vi.mocked(disposeDeep).mockClear();
    cardPortrait("pekka");
    expect(disposeDeep).toHaveBeenCalledTimes(1);
  });

  it("releases the renderer, and its GL context, when idle", async () => {
    const { PORTRAIT_IDLE_MS, cardPortrait, portraitRendererAlive } = await import("./cardportraits");
    cardPortrait("valkyrie");
    expect(portraitRendererAlive()).toBe(true);
    vi.advanceTimersByTime(PORTRAIT_IDLE_MS - 10);
    expect(portraitRendererAlive()).toBe(true);
    // A capture inside the window keeps it alive and restarts the clock.
    cardPortrait("prince");
    vi.advanceTimersByTime(PORTRAIT_IDLE_MS - 10);
    expect(portraitRendererAlive()).toBe(true);
    vi.advanceTimersByTime(20);
    expect(portraitRendererAlive()).toBe(false);
    const first = fake().instances[0];
    expect(first.dispose).toHaveBeenCalled();
    expect(first.forceContextLoss).toHaveBeenCalled();
    // The next portrait builds a fresh renderer.
    cardPortrait("archers");
    expect(fake().instances.length).toBe(2);
  });

  it("keeps spells on painted art", async () => {
    const { cardPortrait } = await import("./cardportraits");
    expect(cardPortrait("fireball")).toBeNull();
  });
});
