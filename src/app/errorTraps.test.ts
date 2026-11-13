import { describe, expect, it } from "vitest";
import { errorFromEvent, installErrorTraps, type TrapTarget } from "./errorTraps";
import { ProblemLog, type ProblemStore } from "./problemLog";

function fakeWindow(): TrapTarget & { fire(type: string, ev: object): void; count(): number } {
  const listeners = new Map<string, Set<(ev: Event) => void>>();
  return {
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
    fire: (type, ev) => {
      for (const fn of listeners.get(type) ?? []) fn(ev as Event);
    },
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

function memLog(): ProblemLog {
  const data: Record<string, string> = {};
  const store: ProblemStore = { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  return new ProblemLog({ store: () => store, build: "b", later: () => undefined });
}

describe("page-wide error traps", () => {
  it("record uncaught errors and unhandled rejections in the same log", () => {
    const win = fakeWindow();
    const log = memLog();
    const off = installErrorTraps(win, log);
    win.fire("error", { error: new TypeError("bad thing"), message: "Uncaught TypeError: bad thing" });
    win.fire("unhandledrejection", { reason: new Error("lost promise") });
    win.fire("unhandledrejection", { reason: undefined });
    expect(log.list().map((p) => [p.kind, p.msg])).toEqual([
      ["promise", "Unhandled promise rejection (no reason given)"],
      ["promise", "Error: lost promise"],
      ["error", "TypeError: bad thing"],
    ]);
    off();
    expect(win.count()).toBe(0);
  });

  it("use what the event says when there is no error object (a cross-origin 'Script error.')", () => {
    expect(errorFromEvent({ message: "Script error.", filename: "https://x.test/a.js", lineno: 3, colno: 7 })).toEqual({
      name: "Error",
      message: "Script error.",
      stack: "at https://x.test/a.js:3:7",
    });
    const win = fakeWindow();
    const log = memLog();
    installErrorTraps(win, log);
    win.fire("error", { message: "Script error.", filename: "https://x.test/a.js", lineno: 3, colno: 7 });
    expect(log.list()[0]).toMatchObject({ msg: "Error: Script error.", stack: ["at /a.js:3:7"] });
  });

  it("skip an error the crash shield already recorded and threw on (dev server)", () => {
    const win = fakeWindow();
    const log = memLog();
    installErrorTraps(win, log);
    const err = new Error("from the frame");
    log.record("frame", err);
    win.fire("error", { error: err });
    expect(log.list()).toHaveLength(1);
    expect(log.list()[0].n).toBe(1);
  });
});
