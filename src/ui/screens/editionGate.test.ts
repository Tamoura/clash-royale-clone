import { describe, expect, it } from "vitest";
import { joinCodeIn } from "./editionGate";

describe("joinCodeIn: the invite code a first visit carries", () => {
  it("reads and cleans ?join=", () => {
    expect(joinCodeIn("?join=carp86")).toBe("CARP86");
    expect(joinCodeIn("?quality=low&join=WASP94&relay=x")).toBe("WASP94");
  });
  it("is null with no code or a malformed one", () => {
    expect(joinCodeIn("")).toBeNull();
    expect(joinCodeIn("?quality=low")).toBeNull();
    expect(joinCodeIn("?join=")).toBeNull();
    expect(joinCodeIn("?join=%3Cscript%3E")).toBeNull();
  });
});
