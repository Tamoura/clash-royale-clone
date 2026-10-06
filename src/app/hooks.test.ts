import { beforeEach, describe, expect, it, vi } from "vitest";

// Fresh module per test: providers are set-once, so isolation matters.
let hooks: typeof import("./hooks");
beforeEach(async () => {
  vi.resetModules();
  hooks = await import("./hooks");
});

const input = (cardId: string) => ({ kind: "select" as const, cardId });

describe("hook bus", () => {
  it("calls listeners in subscription order with the payload", () => {
    const seen: string[] = [];
    hooks.on("input", (p) => seen.push(`a:${p.cardId}`));
    hooks.on("input", (p) => seen.push(`b:${p.cardId}`));
    hooks.emit("input", input("knight"));
    expect(seen).toEqual(["a:knight", "b:knight"]);
  });

  it("keeps hooks separate", () => {
    const fn = vi.fn();
    hooks.on("screen", fn);
    hooks.emit("input", input("giant"));
    expect(fn).not.toHaveBeenCalled();
    hooks.emit("screen", { id: "home", sceneMode: "diorama" });
    expect(fn).toHaveBeenCalledWith({ id: "home", sceneMode: "diorama" });
  });

  it("unsubscribes only the returned listener", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = hooks.on("input", a);
    hooks.on("input", b);
    offA();
    offA(); // idempotent
    hooks.emit("input", input("archers"));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("lets a listener unsubscribe itself mid-emit without skipping others", () => {
    const seen: string[] = [];
    const off = hooks.on("input", () => {
      seen.push("once");
      off();
    });
    hooks.on("input", () => seen.push("always"));
    hooks.emit("input", input("x"));
    hooks.emit("input", input("y"));
    expect(seen).toEqual(["once", "always", "always"]);
  });

  it("isolates a throwing listener", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const after = vi.fn();
    hooks.on("input", () => {
      throw new Error("boom");
    });
    hooks.on("input", after);
    expect(() => hooks.emit("input", input("x"))).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("emitting with no listeners is a no-op", () => {
    expect(() => hooks.emit("screen", { id: "home", sceneMode: "none" })).not.toThrow();
  });
});

describe("providers", () => {
  it("default to today's behaviour", () => {
    expect(hooks.simHeld()).toBe(false);
    expect(hooks.presentTimeScale()).toBe(1);
    expect(hooks.shouldRender(0)).toBe(true);
    expect(hooks.pendingSpend()).toBe(0);
  });

  it("OR together every sim hold, and release on unregister", () => {
    let a = false;
    let b = false;
    const offA = hooks.registerSimHold(() => a);
    hooks.registerSimHold(() => b);
    expect(hooks.simHeld()).toBe(false);
    a = true;
    expect(hooks.simHeld()).toBe(true);
    a = false;
    b = true;
    expect(hooks.simHeld()).toBe(true);
    b = false;
    a = true;
    offA();
    expect(hooks.simHeld()).toBe(false);
  });

  it("route each provider to its setter", () => {
    let scale = 0.5;
    hooks.setPresentTimeScale(() => scale);
    hooks.setRenderGate((now) => now > 100);
    hooks.setPendingSpend(() => 3);
    expect(hooks.presentTimeScale()).toBe(0.5);
    scale = 0;
    expect(hooks.presentTimeScale()).toBe(0);
    expect(hooks.shouldRender(50)).toBe(false);
    expect(hooks.shouldRender(150)).toBe(true);
    expect(hooks.pendingSpend()).toBe(3);
  });

  it("can only be set once", () => {
    hooks.setPresentTimeScale(() => 2);
    expect(() => hooks.setPresentTimeScale(() => 3)).toThrow(/already set/);
    expect(hooks.presentTimeScale()).toBe(2);
    hooks.setRenderGate(() => false);
    expect(() => hooks.setRenderGate(() => true)).toThrow();
    hooks.setPendingSpend(() => 1);
    expect(() => hooks.setPendingSpend(() => 2)).toThrow();
  });
});
