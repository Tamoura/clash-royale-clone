import { describe, expect, it } from "vitest";
import { GFX_NOTE_KEY, QualityGovernor, gfxBuildTag, type StorageLike } from "./quality";
import { LowNote, lowNoteText } from "./gfxNote";
import { autoGraphicsLabel } from "../ui/screens/settings";
import { tr } from "../ui/i18n";

const LOW = tr("Auto (now: Low)", "تلقائي (الآن: منخفض)");

function store(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = String(v)) };
}

describe("the one-time 'Graphics set to Low' note", () => {
  it("waits for a calm screen after a battle, then shows once per device", () => {
    const shown: string[] = [];
    const s = store();
    const note = new LowNote({ store: s, show: (t) => shown.push(t) });
    note.screen("diorama");
    note.low(); // the step happened mid-battle
    expect(note.screen("battle")).toBe(false); // never mid-fight
    expect(shown).toEqual([]);
    expect(note.screen("diorama")).toBe(true); // back on Home
    expect(shown).toEqual([lowNoteText()]);
    expect(s.data[GFX_NOTE_KEY]).toBe("1");
    note.low();
    note.screen("battle");
    expect(note.screen("none")).toBe(false);
    // A new session on the same device: already seen.
    const again = new LowNote({ store: s, show: (t) => shown.push(t) });
    again.low();
    again.screen("battle");
    expect(again.screen("diorama")).toBe(false);
    expect(shown).toHaveLength(1);
  });

  it("a guess at boot waits for the end of the first battle", () => {
    const shown: string[] = [];
    const note = new LowNote({ store: store(), show: (t) => shown.push(t) });
    note.low();
    expect(note.screen("diorama")).toBe(false); // first-run Home: not yet
    note.screen("battle");
    expect(note.screen("diorama")).toBe(true);
  });

  it("still shows only once a session when storage is blocked", () => {
    const shown: string[] = [];
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const note = new LowNote({ store: broken, show: (t) => shown.push(t) });
    for (let i = 0; i < 3; i++) {
      note.low();
      note.screen("battle");
      note.screen("diorama");
    }
    expect(shown).toHaveLength(1);
  });

  it("says it in the edition's words", () => {
    expect(lowNoteText()).toBe(tr("Graphics set to Low so the game runs smoother.", "ضبطنا الرسوميات على منخفض لتعمل اللعبة بسلاسة."));
  });
});

describe("Settings > Graphics: Auto says what it picked", () => {
  it("names the live level under Auto, and is plain Auto under a pin", () => {
    expect(autoGraphicsLabel({ index: 4, mode: "auto" })).toBe(LOW);
    expect(autoGraphicsLabel({ index: 3, mode: "auto" })).toBe(tr("Auto (now: Medium)", "تلقائي (الآن: متوسط)"));
    expect(autoGraphicsLabel({ index: 1, mode: "auto" })).toBe(tr("Auto (now: High)", "تلقائي (الآن: عالٍ)"));
    expect(autoGraphicsLabel({ index: 4, mode: "low" })).toBe(tr("Auto", "تلقائي"));
    const gov = new QualityGovernor();
    gov.configure({ level: 4, helped: true, reprobe: false, source: "guess" });
    expect(autoGraphicsLabel()).toBe(LOW); // read live
  });
});

describe("the build tag stored with the memory", () => {
  it("is the hashed script name in a build, and 'dev' on the dev server", () => {
    expect(gfxBuildTag("https://x.onrender.com/assets/index-CgoAUPGQ.js", false)).toBe("index-CgoAUPGQ");
    expect(gfxBuildTag("https://x.github.io/clash-royale-clone/assets/index-AbC_12-x.js?v=1", false)).toBe("index-AbC_12-x");
    expect(gfxBuildTag("http://localhost:3404/src/render3d/scene/post.ts", true)).toBe("dev");
    expect(gfxBuildTag("blob:nothing", false)).toBe("");
  });
});
