import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchEndPayload } from "./hooks";

let slots: typeof import("./slots");
beforeEach(async () => {
  vi.resetModules();
  slots = await import("./slots");
});

// The node test env has no DOM; slots only hand the host through.
const fakeHost = (): HTMLElement & { items: string[] } =>
  ({ items: [] as string[] }) as unknown as HTMLElement & { items: string[] };
const fakeEl = (name: string): HTMLElement => ({ name }) as unknown as HTMLElement;

const summary = { kind: "ladder", winner: "player", myCrowns: 3 } as unknown as MatchEndPayload;

describe("home slots", () => {
  it("renders nothing when the slot is empty", () => {
    const host = fakeHost();
    const cleanup = slots.renderHomeSlots("shop", host);
    expect(host.items).toEqual([]);
    expect(() => cleanup()).not.toThrow();
  });

  it("renders a slot's providers in order, into the given host only", () => {
    slots.registerHomeSlot("events", (h) => void (h as unknown as { items: string[] }).items.push("a"));
    slots.registerHomeSlot("events", (h) => void (h as unknown as { items: string[] }).items.push("b"));
    slots.registerHomeSlot("profile", (h) => void (h as unknown as { items: string[] }).items.push("p"));
    const host = fakeHost();
    slots.renderHomeSlots("events", host);
    expect(host.items).toEqual(["a", "b"]);
  });

  it("runs every returned cleanup", () => {
    const c1 = vi.fn();
    const c2 = vi.fn();
    slots.registerHomeSlot("battle-top", () => c1);
    slots.registerHomeSlot("battle-top", () => undefined);
    slots.registerHomeSlot("battle-top", () => c2);
    const cleanup = slots.renderHomeSlots("battle-top", fakeHost());
    expect(c1).not.toHaveBeenCalled();
    cleanup();
    expect(c1).toHaveBeenCalledTimes(1);
    expect(c2).toHaveBeenCalledTimes(1);
  });

  it("unregisters, and survives a throwing provider", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fn = vi.fn();
    const off = slots.registerHomeSlot("battle-bottom", fn);
    slots.registerHomeSlot("battle-bottom", () => {
      throw new Error("boom");
    });
    off();
    expect(() => slots.renderHomeSlots("battle-bottom", fakeHost())).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("result extras", () => {
  it("collects non-null elements in order with the summary", () => {
    const seen: unknown[] = [];
    slots.registerResultExtra((s) => {
      seen.push(s);
      return fakeEl("pass");
    });
    slots.registerResultExtra(() => null);
    slots.registerResultExtra(() => fakeEl("road"));
    const out = slots.resultExtras(summary);
    expect(out.map((e) => (e as unknown as { name: string }).name)).toEqual(["pass", "road"]);
    expect(seen).toEqual([summary]);
  });

  it("is empty by default and after unregistering", () => {
    expect(slots.resultExtras(summary)).toEqual([]);
    const off = slots.registerResultExtra(() => fakeEl("x"));
    expect(slots.resultExtras(summary)).toHaveLength(1);
    off();
    expect(slots.resultExtras(summary)).toEqual([]);
  });
});
