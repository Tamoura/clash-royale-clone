import { describe, expect, it } from "vitest";
import { CARDS, getCard, type CardId } from "../game/cards";
import { CLASSIC_NAME, cardDisplayName, cardNameIn } from "./cardNames";

const IDS = Object.keys(CARDS) as CardId[];

/** Another game's coined card names: never shown in either edition. */
const COINED = /P\.?E\.?K\.?K\.?A|Hog Rider|Mega Knight|Electro Wizard|Royal Giant|Skeleton (Barrel|Army)|Minions|Magic Archer|Elixir Collector|Executioner|Iron Guard/i;

describe("card names, Classic edition", () => {
  it("shows its own names for the coined ones, by card id", () => {
    expect(cardNameIn("pekka", false)).toBe("Steel Guard");
    expect(cardNameIn("mini-pekka", false)).toBe("Little Steel Guard");
    expect(cardNameIn("hog-rider", false)).toBe("Boar Rider");
    expect(cardNameIn("mega-knight", false)).toBe("Thunder Knight");
    expect(cardNameIn("electro-wizard", false)).toBe("Lightning Wizard");
    expect(cardNameIn("royal-giant", false)).toBe("Cannon Giant");
    expect(cardNameIn("skeleton-barrel", false)).toBe("Bone Barrel");
    expect(cardNameIn("skeleton-army", false)).toBe("Bone Swarm");
    expect(cardNameIn("minions", false)).toBe("Imps");
    expect(cardNameIn("magic-archer", false)).toBe("Arrow Mage");
    expect(cardNameIn("elixir-collector", false)).toBe("Spark Well");
    expect(cardNameIn("executioner", false)).toBe("Axe Bearer");
  });

  it("keeps the plain-word names from the sim", () => {
    for (const id of ["knight", "archers", "giant", "fireball", "arrows", "zap", "wizard", "witch", "cannon", "skeletons", "tombstone"] as const) {
      expect(cardNameIn(id, false)).toBe(getCard(id).name);
    }
  });

  it("never shows another game's coined name, in either edition", () => {
    for (const id of IDS) {
      if (id === "champion") continue; // the player's own name
      expect(cardNameIn(id, false), id).not.toMatch(COINED);
      expect(cardNameIn(id, true), id).not.toMatch(COINED);
    }
  });

  it("only renames real cards, and the sim keeps its canonical names (ids never change)", () => {
    for (const id of Object.keys(CLASSIC_NAME)) expect(IDS).toContain(id);
    expect(getCard("pekka").name).toBe("P.E.K.K.A");
    expect(getCard("elixir-collector").name).toBe("Elixir Collector");
  });

  it("gives every card its own name in each edition", () => {
    for (const arabic of [false, true]) {
      const names = IDS.filter((id) => id !== "champion").map((id) => cardNameIn(id, arabic));
      expect(new Set(names).size, arabic ? "Golden Age" : "Classic").toBe(names.length);
    }
  });

  it("only the Spark Well says Spark, so no other card reads as making the Sparks", () => {
    const sparky = IDS.filter((id) => /spark/i.test(cardNameIn(id, false)));
    expect(sparky).toEqual(["elixir-collector"]);
    expect(IDS.filter((id) => /شرار|شرر/.test(cardNameIn(id, true)))).toEqual([]);
  });

  it("the Studio champion keeps the name the player gave it", () => {
    expect(cardNameIn("champion", false)).toBe(getCard("champion").name);
    expect(cardNameIn("champion", true)).toBe(getCard("champion").name);
  });
});

describe("card names, Golden Age edition", () => {
  it("Node tests run the Golden Age edition", () => {
    expect(cardDisplayName("knight")).toBe(cardNameIn("knight", true));
  });

  it("uses the reviewed names", () => {
    expect(cardNameIn("skeletons", true)).toBe("المشاة");
    expect(cardNameIn("skeleton-army", true)).toBe("حشد المشاة");
    expect(cardNameIn("skeleton-barrel", true)).toBe("برميل المشاة");
    expect(cardNameIn("executioner", true)).toBe("حامل الفأس");
    expect(cardNameIn("princess", true)).toBe("صاحبة القوس");
    expect(cardNameIn("royal-giant", true)).toBe("عملاق المدفع");
    expect(cardNameIn("tombstone", true)).toBe("المعسكر");
    expect(cardNameIn("rage", true)).toBe("حماسة");
    // Unchanged on purpose.
    expect(cardNameIn("elixir-collector", true)).toBe("خان القوافل");
    expect(cardNameIn("electro-wizard", true)).toBe("نفّاط البرق");
  });

  it("never the names the review replaced", () => {
    const old = /ميليشيا|الجلّاد|خولة|رباط|طبول الحرب|الكشّافة|^مدفعي$|^الرامية$|برج الحراسة/;
    for (const id of IDS) expect(cardNameIn(id, true), id).not.toMatch(old);
  });

  it("Rage reads حماسة in full, never cut to حماس", () => {
    expect(cardNameIn("rage", true).endsWith("ة")).toBe(true);
  });
});
