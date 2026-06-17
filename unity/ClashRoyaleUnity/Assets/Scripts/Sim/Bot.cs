using System;
using System.Collections.Generic;
using System.Linq;

namespace ClashRoyale.Sim
{
    /// <summary>Tuning knobs that make the bot easier or harder.</summary>
    public struct BotProfile
    {
        /// <summary>Seconds between decisions.</summary>
        public double ThinkInterval;

        /// <summary>Elixir level at which the bot starts a push.</summary>
        public double PushAt;
    }

    /// <summary>
    /// Deterministic mulberry32 PRNG, bit-for-bit identical to the JS version in
    /// <c>src/game/bot.ts</c> so battles are reproducible across both editions.
    /// </summary>
    public sealed class Mulberry32
    {
        private uint a;

        public Mulberry32(uint seed)
        {
            a = seed;
        }

        private static int Imul(int x, int y)
        {
            unchecked
            {
                return x * y;
            }
        }

        public double Next()
        {
            unchecked
            {
                a = (uint)((int)a + 0x6d2b79f5);
                uint au = a;
                int t = Imul((int)(au ^ (au >> 15)), (int)(au | 1u));
                int inner = Imul(t ^ (int)((uint)t >> 7), t | 61);
                long sum = (long)t + inner;
                t = (int)sum ^ t;
                uint result = (uint)t ^ ((uint)t >> 14);
                return result / 4294967296.0;
            }
        }
    }

    public sealed class BotState
    {
        public Mulberry32 Rng;
        public double SinceThink;
        public double ThinkInterval;
        public double PushAt;
    }

    /// <summary>Faithful port of <c>src/game/bot.ts</c>.</summary>
    public static class Bot
    {
        /// <summary>Seconds between bot decisions.</summary>
        public const double ThinkInterval = 1.0;

        /// <summary>Elixir level at which the bot starts a push of its own.</summary>
        public const double PushElixir = 8;

        public static BotState CreateBot(uint seed, BotProfile? profile = null)
        {
            return new BotState
            {
                Rng = new Mulberry32(seed),
                SinceThink = 0,
                ThinkInterval = profile?.ThinkInterval ?? ThinkInterval,
                PushAt = profile?.PushAt ?? PushElixir,
            };
        }

        private static List<Entity> PlayerTroops(BattleState state)
        {
            return state.Entities
                .Where(e => e.Side == Side.Player && e.Kind == EntityKind.Troop)
                .ToList();
        }

        private static List<CardId> AffordableTroops(BattleState state)
        {
            return state.Enemy.Hand.Cards.Where(id =>
            {
                Card card = Cards.Get(id);
                return (card.Kind == CardKind.Troop || card.Kind == CardKind.Building) &&
                       card.Cost <= state.Enemy.Elixir.Amount;
            }).ToList();
        }

        private static List<CardId> DefenseCandidates(BattleState state, Entity threat)
        {
            return AffordableTroops(state).Where(id =>
            {
                Card card = Cards.Get(id);
                UnitStats unit = card switch
                {
                    TroopCard t => t.Unit,
                    BuildingCard b => b.Unit,
                    _ => null,
                };
                if (unit == null)
                {
                    return false;
                }

                if (unit.TargetsBuildingsOnly)
                {
                    return false;
                }

                if (threat.Flying && !unit.TargetsAir)
                {
                    return false;
                }

                return true;
            }).ToList();
        }

        private static double Clamp(double v, double lo, double hi)
        {
            return Math.Min(hi, Math.Max(lo, v));
        }

        private static (double X, double Y) DefenseSpot(Entity threat)
        {
            return (
                Clamp(threat.X, 1, 17),
                Clamp(threat.Y - 2.5, 3, Arena.RiverY - 1.5));
        }

        private static double UnitValue(Entity t)
        {
            if (t.CardId == null)
            {
                return 0;
            }

            Card card = Cards.Get(t.CardId.Value);
            return card is TroopCard troop ? (double)card.Cost / troop.Count : card.Cost;
        }

        private static (double X, double Y)? FindCluster(BattleState state, double radius, int minCount, double minValue)
        {
            List<Entity> troops = PlayerTroops(state);
            foreach (Entity center in troops)
            {
                List<Entity> hit = troops.Where(t => Battle.Distance(center, t) <= radius).ToList();
                double value = hit.Sum(UnitValue);
                if (hit.Count >= minCount && value > minValue)
                {
                    return (hit.Sum(t => t.X) / hit.Count, hit.Sum(t => t.Y) / hit.Count);
                }
            }

            return null;
        }

        private static bool TrySpellCluster(BattleState state)
        {
            foreach (CardId id in new[] { CardId.Fireball, CardId.Arrows, CardId.Zap })
            {
                if (!state.Enemy.Hand.Cards.Contains(id))
                {
                    continue;
                }

                Card card = Cards.Get(id);
                if (card is not SpellCard spell || spell.Cost > state.Enemy.Elixir.Amount)
                {
                    continue;
                }

                (double X, double Y)? cluster = FindCluster(state, spell.Radius, 3, spell.Cost);
                if (cluster != null && Battle.DeployCard(state, Side.Enemy, id, cluster.Value.X, cluster.Value.Y))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool TryDefend(BattleState state, BotState bot)
        {
            List<Entity> invaders = PlayerTroops(state).Where(e => e.Y < Arena.RiverY + 1).ToList();
            if (invaders.Count == 0)
            {
                return false;
            }

            Entity threat = invaders.Aggregate((a, b) => a.Y < b.Y ? a : b);
            List<CardId> cards = DefenseCandidates(state, threat);
            if (cards.Count == 0)
            {
                return false;
            }

            CardId card = cards[(int)Math.Floor(bot.Rng.Next() * cards.Count)];
            (double X, double Y) spot = DefenseSpot(threat);
            return Battle.DeployCard(state, Side.Enemy, card, spot.X, spot.Y);
        }

        private static bool TryPush(BattleState state, BotState bot)
        {
            if (state.Enemy.Elixir.Amount < bot.PushAt)
            {
                return false;
            }

            List<CardId> cards = AffordableTroops(state);
            if (cards.Count == 0)
            {
                return false;
            }

            CardId card = cards[(int)Math.Floor(bot.Rng.Next() * cards.Count)];
            double lane = Arena.BridgeXs[bot.Rng.Next() < 0.5 ? 0 : 1];
            return Battle.DeployCard(state, Side.Enemy, card, lane, Arena.RiverY - 4);
        }

        /// <summary>Make at most one play right now.</summary>
        public static void BotThink(BattleState state, BotState bot)
        {
            if (state.Result != null)
            {
                return;
            }

            if (TrySpellCluster(state))
            {
                return;
            }

            if (TryDefend(state, bot))
            {
                return;
            }

            TryPush(state, bot);
        }

        /// <summary>Throttled entry point: call every tick, thinks once per interval.</summary>
        public static void TickBot(BattleState state, BotState bot, double dt)
        {
            bot.SinceThink += dt;
            if (bot.SinceThink < bot.ThinkInterval)
            {
                return;
            }

            bot.SinceThink = 0;
            BotThink(state, bot);
        }
    }
}
