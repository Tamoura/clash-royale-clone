import { describe, expect, it } from "vitest";
import {
  checkDeploy,
  createBattle,
  deployCard,
  effectiveCard,
  type BattleState,
} from "./battle";
import { createHand } from "./hand";
import type { CardId } from "./cards";

function giveHand(b: BattleState, cards: CardId[], elixir = 10): void {
  b.player.hand = createHand(
    ([...cards, "knight", "archers", "giant", "fireball", "arrows", "zap", "rage"] as CardId[]).slice(0, 8),
  );
  b.player.elixir = { amount: elixir };
}

describe("Mirror", () => {
  it("is dead until something has been played, then costs the copy +1", () => {
    const b = createBattle();
    giveHand(b, ["mirror", "knight"]);
    expect(effectiveCard(b, "player", "mirror")).toBeNull();
    expect(deployCard(b, "player", "mirror", 9, 24)).toBe(false);

    expect(deployCard(b, "player", "knight", 9, 24)).toBe(true); // costs 3
    giveHand(b, ["mirror"]); // refill hand + elixir
    const eff = effectiveCard(b, "player", "mirror")!;
    expect(eff.card.id).toBe("knight");
    expect(eff.cost).toBe(4); // knight 3 + 1
  });

  it("replays the last troop at the target for cost +1", () => {
    const b = createBattle();
    giveHand(b, ["mirror", "knight"]);
    deployCard(b, "player", "knight", 9, 24);
    giveHand(b, ["mirror"], 10);
    expect(deployCard(b, "player", "mirror", 6, 24)).toBe(true);
    const knights = b.entities.filter(
      (e) => e.side === "player" && e.cardId === "knight",
    );
    expect(knights).toHaveLength(2); // the original + the mirrored copy
    expect(b.player.elixir.amount).toBeCloseTo(6, 5); // paid 4, not 3
  });

  it("keeps copying the same card — a Mirror never mirrors itself", () => {
    const b = createBattle();
    giveHand(b, ["mirror", "knight"]);
    deployCard(b, "player", "knight", 9, 24);
    giveHand(b, ["mirror"], 10);
    deployCard(b, "player", "mirror", 6, 24);
    expect(b.player.lastPlayed).toBe("knight"); // unchanged by the mirror
    giveHand(b, ["mirror"], 10);
    const eff = effectiveCard(b, "player", "mirror")!;
    expect(eff.card.id).toBe("knight");
  });

  it("mirrors spells with the copied card's placement rules", () => {
    const b = createBattle();
    giveHand(b, ["mirror", "fireball"]);
    deployCard(b, "player", "fireball", 3.5, 6.5);
    giveHand(b, ["mirror"], 10);
    // Spell copies can land anywhere — deep in enemy territory included.
    expect(deployCard(b, "player", "mirror", 3.5, 6.5)).toBe(true);
    // But a mirrored TROOP still obeys troop deploy zones:
    giveHand(b, ["mirror", "knight"], 10);
    deployCard(b, "player", "knight", 9, 24);
    giveHand(b, ["mirror"], 10);
    expect(checkDeploy(b, "player", "mirror", 3.5, 6.5)).toBe("bad-spot");
  });

  it("rejects the mirror when elixir covers the copy but not the +1", () => {
    const b = createBattle();
    giveHand(b, ["mirror", "knight"]);
    deployCard(b, "player", "knight", 9, 24);
    giveHand(b, ["mirror"], 3); // knight is 3; the mirror needs 4
    expect(checkDeploy(b, "player", "mirror", 9, 24)).toBe("no-elixir");
  });
});
