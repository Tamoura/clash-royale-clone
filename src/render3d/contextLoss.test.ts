import { describe, expect, it, vi } from "vitest";

describe("WebGL context loss", () => {
  it("cancels the loss, stops drawing, and rebuilds the arena on restore", async () => {
    const { Battle3D } = await import("./scene3d");
    const canvas = new EventTarget();
    const shadowMap = { needsUpdate: false };
    const b = Object.assign(Object.create(Battle3D.prototype), {
      renderer: { domElement: canvas, shadowMap },
      setArenaLook: vi.fn(),
      reset: vi.fn(),
      resize: vi.fn(),
      composer: { render: vi.fn() },
    }) as InstanceType<typeof Battle3D>;
    let arena = "forest";
    b.recoverFromContextLoss(() => arena);

    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true); // lets the browser restore the context

    // While the context is gone, a frame draws nothing (and does not throw).
    b.render(0.016);
    expect(b.composer.render).not.toHaveBeenCalled();

    arena = "bazaar"; // the arena in play when the context returns
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    // Same arena id forced through (a look the scene already shows is rebuilt),
    // every view dropped so the next sync recreates them, shadows and size redone.
    expect(b.setArenaLook).toHaveBeenCalledWith("bazaar", true);
    expect(b.reset).toHaveBeenCalledTimes(1);
    expect(b.resize).toHaveBeenCalledTimes(1);
    expect(shadowMap.needsUpdate).toBe(true);
  });
});
