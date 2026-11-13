import { describe, expect, it } from "vitest";
import { resolveBuildId, BUILD_ID } from "./buildInfo";
import {
  addProblem,
  cleanText,
  describeError,
  loadProblems,
  MAX_MESSAGE_CHARS,
  MAX_PROBLEMS,
  MAX_STACK_LINE_CHARS,
  MAX_STORED_CHARS,
  PROBLEM_LOG_KEY,
  problemReport,
  ProblemLog,
  sanitizeProblem,
  SAVE_GAP_MS,
  serializeProblems,
  shortenUrls,
  STACK_LINES,
  type NewProblem,
  type Problem,
  type ProblemStore,
} from "./problemLog";

function memStore(seed: Record<string, string> = {}): ProblemStore & { data: Record<string, string>; writes: number } {
  const data = { ...seed };
  const s = {
    data,
    writes: 0,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      s.writes++;
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
  return s;
}

const CTX = { screen: "battle/playing", quality: "auto L2", edition: "classic", online: false };

function entry(msg: string, at: number): NewProblem {
  return { at, kind: "frame", msg, stack: [], build: "abc-1", ...CTX };
}

describe("build id", () => {
  it("is 'dev' on the dev server and in vitest", () => {
    expect(BUILD_ID).toBe("dev");
    expect(resolveBuildId("abc123-xyz", true)).toBe("dev");
  });
  it("is the stamped id in a production build", () => {
    expect(resolveBuildId("abc123-xyz", false)).toBe("abc123-xyz");
    expect(resolveBuildId(undefined, false)).toBe("dev");
    expect(resolveBuildId("  ", false)).toBe("dev");
  });
});

describe("describeError", () => {
  it("keeps the name, message and the first few stack lines without the site's address", () => {
    const err = new TypeError("x is undefined");
    err.stack = [
      "TypeError: x is undefined",
      "    at frameBody (https://clash-royale-clone.onrender.com/assets/index-Abc.js:12:345)",
      "    at frame (https://clash-royale-clone.onrender.com/assets/index-Abc.js:12:999)",
      "    at http://localhost:3402/src/main.ts?t=1700000000:1600:5",
      "    at four (x.js:1:1)",
      "    at five (x.js:1:2)",
    ].join("\n");
    const d = describeError(err);
    expect(d.msg).toBe("TypeError: x is undefined");
    expect(d.stack).toHaveLength(STACK_LINES);
    expect(d.stack[0]).toBe("at frameBody (/assets/index-Abc.js:12:345)");
    expect(d.stack[2]).toBe("at /src/main.ts:1600:5");
    expect(d.stack.join(" ")).not.toContain("onrender.com");
  });

  it("reads Firefox/Safari stacks", () => {
    const d = describeError({ name: "Error", message: "boom", stack: "draw@https://x.test/a.js:1:2\n@https://x.test/b.js:3:4" });
    expect(d.stack).toEqual(["draw@/a.js:1:2", "@/b.js:3:4"]);
  });

  it("handles strings, nulls, odd objects and hostile toString without throwing", () => {
    expect(describeError("plain").msg).toBe("plain");
    expect(describeError(null).msg).toBe("Thrown: null");
    expect(describeError(undefined).msg).toBe("Thrown: undefined");
    expect(describeError(42).msg).toBe("Thrown: 42");
    expect(describeError({ a: 1 }).msg).toBe('Thrown: {"a":1}');
    const hostile = {
      get message(): string {
        throw new Error("no");
      },
    };
    expect(describeError(hostile).msg).toBeTruthy();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(describeError(cyclic).msg).toBe("Thrown: [object Object]");
  });

  it("cleans control and direction characters and caps the length", () => {
    expect(cleanText(`a\nb${String.fromCharCode(0x202e)}c${String.fromCharCode(0)}d`, 50)).toBe("a b c d");
    const long = describeError(new Error("x".repeat(1000))).msg;
    expect(long.length).toBe(MAX_MESSAGE_CHARS);
    expect(long.endsWith("…")).toBe(true);
    expect(shortenUrls("at f (https://a.b:8080/c.js?v=2:1:2)")).toBe("at f (/c.js:1:2)");
  });
});

describe("the list", () => {
  it("is newest first and capped", () => {
    let list: Problem[] = [];
    for (let i = 0; i < MAX_PROBLEMS + 5; i++) list = addProblem(list, entry(`E${i}`, 1000 + i));
    expect(list).toHaveLength(MAX_PROBLEMS);
    expect(list[0].msg).toBe(`E${MAX_PROBLEMS + 4}`);
    expect(list.at(-1)!.msg).toBe("E5");
  });

  it("counts an identical message instead of adding a row, and moves it to the front", () => {
    let list = addProblem([], entry("A", 1000));
    list = addProblem(list, entry("B", 2000));
    list = addProblem(list, entry("A", 3000));
    list = addProblem(list, entry("A", 4000));
    expect(list.map((p) => [p.msg, p.n])).toEqual([
      ["A", 3],
      ["B", 1],
    ]);
    expect(list[0].at).toBe(1000);
    expect(list[0].last).toBe(4000);
  });

  it("drops the oldest entries when the stored JSON would be too big", () => {
    const big: Problem[] = [];
    for (let i = 0; i < MAX_PROBLEMS; i++) {
      big.push({
        ...entry(`${i}`.padEnd(MAX_MESSAGE_CHARS, "m"), 1000 - i),
        n: 1,
        last: 1000 - i,
        stack: Array.from({ length: STACK_LINES }, () => "s".repeat(MAX_STACK_LINE_CHARS)),
      });
    }
    const json = serializeProblems(big);
    expect(json.length).toBeLessThanOrEqual(MAX_STORED_CHARS);
    const back = JSON.parse(json) as Problem[];
    expect(back[0].msg.startsWith("0")).toBe(true); // the newest stays
  });
});

describe("loading what was stored", () => {
  it("never throws on broken values and keeps what is sound", () => {
    for (const raw of ["", "{", "null", "42", '"x"', "{}", "[null, 1, \"x\", []]", "x".repeat(MAX_STORED_CHARS * 5)]) {
      expect(loadProblems(memStore({ [PROBLEM_LOG_KEY]: raw }))).toEqual([]);
    }
    const throwing: ProblemStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    expect(loadProblems(throwing)).toEqual([]);
    expect(loadProblems(null)).toEqual([]);
  });

  it("sanitises each field", () => {
    const p = sanitizeProblem({
      at: 5,
      last: 2,
      n: -3,
      kind: "nope",
      msg: `bad${String.fromCharCode(0x202e)}line\n<b>`,
      stack: ["at x", 7, "y".repeat(500), "z", "w", "v"],
      build: { evil: true },
      screen: "s".repeat(100),
      online: "yes",
    })!;
    expect(p.last).toBe(5);
    expect(p.n).toBe(1);
    expect(p.kind).toBe("error");
    expect(p.msg).toBe("bad line <b>");
    expect(p.stack.length).toBeLessThanOrEqual(STACK_LINES);
    expect(p.stack.every((l) => l.length <= MAX_STACK_LINE_CHARS)).toBe(true);
    expect(p.build).toBe("[object Object]");
    expect(p.screen.length).toBeLessThanOrEqual(48);
    expect(p.online).toBe(false);
    expect(sanitizeProblem({ at: "1", msg: "x" })).toBeNull();
    expect(sanitizeProblem({ at: 1, msg: "" })).toBeNull();
  });

  it("keeps where it was caught clean and short, and leaves it out when there is none", () => {
    const p = sanitizeProblem({ at: 1, msg: "x", where: `battle event 'death'${String.fromCharCode(0x202e)}\n${"w".repeat(200)}` })!;
    expect(p.where!.startsWith("battle event 'death' w")).toBe(true);
    expect(p.where!.length).toBeLessThanOrEqual(48);
    expect(p.where).not.toMatch(/[\u202e\n]/);
    // Entries stored before the field existed, or with nothing in it.
    expect(sanitizeProblem({ at: 1, msg: "x" })).not.toHaveProperty("where");
    expect(sanitizeProblem({ at: 1, msg: "x", where: " \u0000 " })).not.toHaveProperty("where");
    expect(sanitizeProblem({ at: 1, msg: "x", where: { evil: true } })!.where).toBe("[object Object]");
  });

  it("sorts newest first and caps a long stored list", () => {
    const stored = Array.from({ length: 60 }, (_, i) => ({ at: i, last: i, msg: `m${i}` }));
    const list = loadProblems(memStore({ [PROBLEM_LOG_KEY]: JSON.stringify(stored) }));
    expect(list).toHaveLength(MAX_PROBLEMS);
    expect(list[0].last).toBeGreaterThan(list[1].last);
  });
});

describe("ProblemLog", () => {
  function setup(seed: Record<string, string> = {}) {
    const store = memStore(seed);
    let t = 10_000;
    const timers: Array<() => void> = [];
    const log = new ProblemLog({
      store: () => store,
      now: () => t,
      build: "abc-1",
      later: (fn) => void timers.push(fn),
    });
    log.setContext(() => CTX);
    return {
      store,
      log,
      timers,
      advance: (ms: number) => {
        t += ms;
      },
    };
  }

  it("records with the build and the context, and stores it", () => {
    const { store, log } = setup();
    const p = log.record("frame", new Error("boom"))!;
    expect(p).toMatchObject({ msg: "Error: boom", build: "abc-1", screen: "battle/playing", quality: "auto L2", edition: "classic", online: false, n: 1, kind: "frame" });
    expect(JSON.parse(store.data[PROBLEM_LOG_KEY])).toHaveLength(1);
  });

  it("records which part of the game caught it, through storage and into the report", () => {
    const { store, log } = setup();
    expect(log.record("frame", new Error("tower"), "battle event 'death'")!.where).toBe("battle event 'death'");
    // A whole frame says nothing more than its kind; no label says nothing either.
    expect(log.record("frame", new Error("whole"), "frame")).not.toHaveProperty("where");
    expect(log.record("error", new Error("page"))).not.toHaveProperty("where");
    // The same message again keeps where it was first caught.
    expect(log.record("frame", new Error("tower"), "settling the match")!.where).toBe("battle event 'death'");
    log.flush();
    const back = loadProblems(store);
    expect(back.find((p) => p.msg === "Error: tower")!.where).toBe("battle event 'death'");
    const lines = problemReport(back, {
      build: "b",
      browser: "x",
      screen: "1x1",
      quality: "q",
      edition: "e",
      now: 0,
    }).split("\n");
    expect(lines.filter((l) => / · frame \(battle event 'death'\)$/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => / · frame$/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => / · error$/.test(l))).toHaveLength(1);
  });

  it("writes at most once per SAVE_GAP_MS while an error repeats every frame, and loses no count", () => {
    const { store, log, timers, advance } = setup();
    for (let i = 0; i < 120; i++) {
      log.record("frame", new Error("every frame"));
      advance(16);
    }
    expect(store.writes).toBeLessThanOrEqual(1 + Math.ceil((120 * 16) / SAVE_GAP_MS));
    expect(timers.length).toBe(1); // one deferred write queued, not 119
    timers.shift()!();
    const saved = JSON.parse(store.data[PROBLEM_LOG_KEY]) as Problem[];
    expect(saved).toHaveLength(1);
    expect(saved[0].n).toBe(120);
  });

  it("boots from a broken stored value without throwing, then works", () => {
    const { log } = setup({ [PROBLEM_LOG_KEY]: "{not json" });
    expect(log.list()).toEqual([]);
    expect(log.record("error", "x")).not.toBeNull();
    expect(log.list()).toHaveLength(1);
  });

  it("survives a context provider that throws and storage that refuses writes", () => {
    const log = new ProblemLog({
      store: () => ({
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      }),
      build: "b",
    });
    log.setContext(() => {
      throw new Error("not ready");
    });
    const p = log.record("promise", new Error("late"))!;
    expect(p.screen).toBe("?");
    expect(log.list()).toHaveLength(1);
  });

  it("ignores the gallery's deliberate stop and remembers which errors it recorded", () => {
    const { log } = setup();
    expect(log.record("error", new Error("gallery mode"))).toBeNull();
    const e = new Error("real");
    expect(log.wasRecorded(e)).toBe(false);
    log.record("frame", e);
    expect(log.wasRecorded(e)).toBe(true);
  });

  it("clears memory and storage", () => {
    const { store, log } = setup();
    log.record("frame", new Error("a"));
    let changes = 0;
    log.onChange(() => changes++);
    log.clear();
    expect(log.list()).toEqual([]);
    expect(store.data[PROBLEM_LOG_KEY]).toBeUndefined();
    expect(changes).toBe(1);
  });
});

describe("the copied report", () => {
  const header = {
    build: "abc1234-xyz",
    browser: "Mozilla/5.0 (Test)",
    screen: "390x844, pixel ratio 2",
    quality: "auto L2",
    edition: "Golden Age",
    now: Date.UTC(2026, 10, 13, 10, 30, 0),
  };

  it("has a header, then each problem newest first with its count and where it happened", () => {
    let list = addProblem([], { ...entry("Error: first", Date.UTC(2026, 10, 13, 10, 0, 0)), stack: ["at a (/x.js:1:2)"] });
    list = addProblem(list, { ...entry("TypeError: second", Date.UTC(2026, 10, 13, 10, 5, 0)), online: true });
    list = addProblem(list, entry("TypeError: second", Date.UTC(2026, 10, 13, 10, 6, 0)));
    list = addProblem(list, { ...entry("Error: third", Date.UTC(2026, 10, 13, 10, 7, 0)), kind: "hook", where: "battleEvent listener" });
    const text = problemReport(list, header);
    expect(text).toBe(
      [
        "Crown Rush problem report",
        "Build: abc1234-xyz",
        "Browser: Mozilla/5.0 (Test)",
        "Screen: 390x844, pixel ratio 2",
        "Graphics: auto L2",
        "Edition: Golden Age",
        "Made: 2026-11-13 10:30:00 UTC",
        "",
        "3 problems, newest first. Kept on this device only.",
        "",
        "#1 2026-11-13 10:07:00 UTC · hook (battleEvent listener)",
        "Error: third",
        "Where: battle/playing · auto L2 · classic · abc-1",
        "",
        "#2 2026-11-13 10:05:00 UTC · seen 2 times, last 2026-11-13 10:06:00 UTC · frame",
        "TypeError: second",
        "Where: battle/playing · auto L2 · classic · online · abc-1",
        "",
        "#3 2026-11-13 10:00:00 UTC · frame",
        "Error: first",
        "  at a (/x.js:1:2)",
        "Where: battle/playing · auto L2 · classic · abc-1",
      ].join("\n"),
    );
  });

  it("says so when there is nothing to report", () => {
    expect(problemReport([], header).split("\n").at(-1)).toBe("No problems so far!");
  });
});
