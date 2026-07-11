using System.Collections.Generic;
using System.Linq;
using ClashRoyale.Sim;
using NUnit.Framework;

namespace ClashRoyale.Tests
{
    /// <summary>
    /// NUnit EditMode tests mirroring the TypeScript sim suite. They verify the
    /// C# port matches the original deterministic simulation. Run them via
    /// Window &gt; General &gt; Test Runner (EditMode) in the Unity Editor.
    /// </summary>
    public class ElixirTests
    {
        [Test]
        public void StartsAtFive()
        {
            Assert.AreEqual(5, Elixir.Create().Amount);
        }

        [Test]
        public void RegeneratesOnePer2Point8Seconds()
        {
            ElixirState e = Elixir.Tick(Elixir.Create(), 2.8, 1);
            Assert.AreEqual(6, e.Amount, 1e-9);
        }

        [Test]
        public void CapsAtTen()
        {
            ElixirState e = Elixir.Tick(Elixir.Create(), 1000, 1);
            Assert.AreEqual(10, e.Amount);
        }

        [Test]
        public void DoubleElixirIsTwiceAsFast()
        {
            ElixirState e = Elixir.Tick(Elixir.Create(), 1.4, 2);
            Assert.AreEqual(6, e.Amount, 1e-9);
        }

        [Test]
        public void SpendsWhenAffordable()
        {
            ElixirState? after = Elixir.TrySpend(Elixir.Create(), 3);
            Assert.IsNotNull(after);
            Assert.AreEqual(2, after.Value.Amount, 1e-9);
        }

        [Test]
        public void RefusesOverspend()
        {
            Assert.IsNull(Elixir.TrySpend(Elixir.Create(), 6));
        }
    }

    public class HandTests
    {
        private static readonly List<CardId> Deck = Cards.Deck.Take(8).ToList();

        [Test]
        public void DealsFourKeepingRestInOrder()
        {
            HandState h = HandState.Create(Deck);
            CollectionAssert.AreEqual(Deck.Take(4).ToList(), h.Cards.ToList());
            CollectionAssert.AreEqual(Deck.Skip(4).ToList(), h.Queue.ToList());
        }

        [Test]
        public void PlayingReplacesWithNextQueued()
        {
            HandState after = HandState.Create(Deck).Play(Deck[1]);
            Assert.AreEqual(Deck[4], after.Cards[1]);
            Assert.AreEqual(0, after.Cards.Count(c => c == Deck[1]));
        }

        [Test]
        public void PlayedCardGoesToBackOfQueue()
        {
            HandState after = HandState.Create(Deck).Play(Deck[0]);
            Assert.AreEqual(Deck[0], after.Queue[after.Queue.Count - 1]);
            Assert.AreEqual(4, after.Queue.Count);
        }

        [Test]
        public void ThrowsWhenCardNotInHand()
        {
            Assert.Throws<System.InvalidOperationException>(() => HandState.Create(Deck).Play(Deck[5]));
        }
    }

    public class ArenaTests
    {
        [Test]
        public void OwnHalfIsDeployable()
        {
            Assert.IsTrue(Arena.CanDeployTroopAt(Side.Player, 9, 20));
            Assert.IsFalse(Arena.CanDeployTroopAt(Side.Player, 9, 10));
        }

        [Test]
        public void RiverIsNotDeployable()
        {
            Assert.IsTrue(Arena.InRiver(16));
            Assert.IsFalse(Arena.CanDeployTroopAt(Side.Player, 9, 16));
        }

        [Test]
        public void FallenLaneOpensEnemyHalf()
        {
            Assert.IsTrue(Arena.CanDeployTroopAt(Side.Player, 3, 10, new OpenLanes(true, false)));
            Assert.IsFalse(Arena.CanDeployTroopAt(Side.Player, 15, 10, new OpenLanes(true, false)));
        }
    }

    public class CardTests
    {
        [Test]
        public void DefaultDeckIsValid()
        {
            Assert.IsTrue(Battle.IsValidDeck(Cards.DefaultDeck));
        }

        [Test]
        public void DeckWithDuplicatesIsInvalid()
        {
            var dupe = new List<CardId>
            {
                CardId.Knight, CardId.Knight, CardId.Giant, CardId.Fireball,
                CardId.Musketeer, CardId.MiniPekka, CardId.BabyDragon, CardId.Arrows,
            };
            Assert.IsFalse(Battle.IsValidDeck(dupe));
        }
    }

    public class BattleTests
    {
        [Test]
        public void CreatesSixTowers()
        {
            BattleState s = Battle.CreateBattle();
            Assert.AreEqual(6, s.Entities.Count(e =>
                e.Kind == EntityKind.PrincessTower || e.Kind == EntityKind.KingTower));
        }

        [Test]
        public void DeployingSpendsElixirAndRotatesHand()
        {
            BattleState s = Battle.CreateBattle();
            CardId card = s.Player.Hand.Cards[0];
            double before = s.Player.Elixir.Amount;
            Assert.IsTrue(Battle.DeployCard(s, Side.Player, card, 9, 22));
            Assert.AreEqual(before - Cards.Get(card).Cost, s.Player.Elixir.Amount, 1e-9);
            Assert.IsFalse(s.Player.Hand.Cards.Contains(card));
        }

        [Test]
        public void SpellsHitTowersForReducedDamage()
        {
            BattleState s = Battle.CreateBattle();
            Entity enemyKing = s.Entities.First(e => e.Side == Side.Enemy && e.Kind == EntityKind.KingTower);
            double before = enemyKing.Hp;
            // Drop a fireball squarely on the enemy king tower.
            Battle.ApplySpell(s, Side.Player, CardId.Fireball, enemyKing.X, enemyKing.Y, 570, 2.5);
            double dealt = before - enemyKing.Hp;
            Assert.AreEqual(570 * Battle.TowerSpellDamageFactor, dealt, 1e-6);
        }

        [Test]
        public void UnaffordableDeployIsRejected()
        {
            BattleState s = Battle.CreateBattle();
            // P.E.K.K.A costs 7; opening elixir is 5, and it isn't in the hand.
            Assert.IsFalse(Battle.DeployCard(s, Side.Player, CardId.Pekka, 9, 22));
        }
    }

    public class SimTests
    {
        [Test]
        public void ElixirMultiplierFollowsTheClock()
        {
            BattleState s = Battle.CreateBattle();
            Assert.AreEqual(1, Simulation.ElixirMultiplier(s));
            s.Time = 130;
            Assert.AreEqual(2, Simulation.ElixirMultiplier(s));
            s.Overtime = true;
            s.Time = Simulation.BattleDuration + 70;
            Assert.AreEqual(3, Simulation.ElixirMultiplier(s));
        }

        [Test]
        public void TickAdvancesTime()
        {
            BattleState s = Battle.CreateBattle();
            Simulation.Tick(s, 0.5);
            Assert.AreEqual(0.5, s.Time, 1e-9);
        }

        [Test]
        public void RunIsDeterministicAndReproducible()
        {
            int Run()
            {
                BattleState s = Battle.CreateBattle();
                BotState bot = Bot.CreateBot(777);
                bool deployed = false;
                for (int i = 0; i < 30 * 40; i++)
                {
                    Simulation.Tick(s, 1.0 / 30.0);
                    Bot.TickBot(s, bot, 1.0 / 30.0);
                    if (!deployed && s.Time > 3)
                    {
                        deployed = Battle.DeployCard(s, Side.Player, CardId.Giant, 3.5, 20);
                    }
                }

                return s.Entities.Count * 1000 + s.Enemy.Crowns;
            }

            Assert.AreEqual(Run(), Run());
        }
    }

    public class BotRngTests
    {
        // Values captured from the JS mulberry32 in src/game/bot.ts.
        [Test]
        public void MatchesJsReferenceForSeed12345()
        {
            var rng = new Mulberry32(12345);
            double[] expected =
            {
                0.979728267760947, 0.306752264499664, 0.484205421525985, 0.817934412509203,
                0.509428369347006, 0.347471860470250, 0.073757541831583, 0.766396467341110,
            };
            foreach (double e in expected)
            {
                Assert.AreEqual(e, rng.Next(), 1e-12);
            }
        }

        [Test]
        public void MatchesJsReferenceForSeed1()
        {
            var rng = new Mulberry32(1);
            double[] expected =
            {
                0.627073940588161, 0.002735721180215, 0.527447039959952,
                0.981050967471674, 0.968377898214385,
            };
            foreach (double e in expected)
            {
                Assert.AreEqual(e, rng.Next(), 1e-12);
            }
        }
    }
}
