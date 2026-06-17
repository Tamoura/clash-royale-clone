using System;
using System.Collections.Generic;
using System.Linq;

namespace ClashRoyale.Sim
{
    /// <summary>A live unit, building, or tower. Mutated in place each tick.</summary>
    public sealed class Entity
    {
        public int Id;
        public Side Side;
        public EntityKind Kind;

        /// <summary>Which card spawned this entity (null for towers).</summary>
        public CardId? CardId;
        public double X;
        public double Y;
        public double Hp;
        public double MaxHp;
        public double Damage;

        /// <summary>Seconds between attacks.</summary>
        public double HitSpeed;
        public double AttackRange;
        public double SightRange;

        /// <summary>Tiles per second; 0 for towers.</summary>
        public double Speed;
        public bool TargetsBuildingsOnly;
        public bool TargetsAir;
        public bool Flying;
        public bool JumpsRiver;
        public double SplashRadius;
        public double ChargeDistance;
        public double ChargeProgress;
        public double DeployTimer;
        public double StunTimer;
        public double DecayPerSec;
        public double DeathDamage;
        public double DeathRadius;
        public CardId? SpawnUnitId;
        public double SpawnInterval;
        public double SpawnTimer;
        public double ElixirInterval;
        public double ElixirTimer;
        public double Radius;
        public double Cooldown;
        public int? TargetId;

        /// <summary>King towers start inactive and wake when damaged or a princess falls.</summary>
        public bool Active;
    }

    /// <summary>Running battle statistics shown on the result screen.</summary>
    public sealed class SideStats
    {
        public double DamageDealt;
        public double ElixirSpent;
    }

    public sealed class SideState
    {
        public ElixirState Elixir;
        public HandState Hand;
        public int Crowns;
        public SideStats Stats = new();

        /// <summary>Card upgrade levels (absent = level 1).</summary>
        public Dictionary<CardId, int> Levels = new();
    }

    public sealed class SpellEffect
    {
        public CardId CardId;
        public double X;
        public double Y;
        public double Radius;

        /// <summary>Seconds left to display.</summary>
        public double Ttl;
    }

    /// <summary>A ranged shot in flight; damage lands on arrival.</summary>
    public sealed class Projectile
    {
        public int Id;
        public Side Side;
        public CardId? CardId;
        public EntityKind SourceKind;
        public double Sx;
        public double Sy;
        public double X;
        public double Y;
        public int TargetId;
        public double Speed;
        public double Damage;
        public double SplashRadius;
        public bool TargetsAir;
    }

    /// <summary>A lingering area that boosts one side's troops (Rage).</summary>
    public sealed class BuffZone
    {
        public Side Side;
        public double X;
        public double Y;
        public double Radius;
        public double Ttl;
    }

    public sealed class BattleResult
    {
        public BattleWinner Winner;
        public int PlayerCrowns;
        public int EnemyCrowns;
    }

    public sealed class BattleState
    {
        public List<Entity> Entities = new();
        public SideState Player = new();
        public SideState Enemy = new();

        /// <summary>Elapsed battle time in seconds.</summary>
        public double Time;
        public bool Overtime;
        public BattleResult Result;
        public List<SpellEffect> Effects = new();
        public List<Projectile> Projectiles = new();
        public List<BuffZone> BuffZones = new();
        public List<BattleEvent> Events = new();
        public int NextEntityId = 1;
    }

    public enum DeployCheck
    {
        Ok,
        Finished,
        NotInHand,
        BadSpot,
        NoElixir,
    }

    /// <summary>Faithful port of <c>src/game/battle.ts</c>.</summary>
    public static class Battle
    {
        /// <summary>Seconds a freshly deployed troop or building stands frozen.</summary>
        public const double DeployDelay = 1;

        /// <summary>Spawners summon their first wave quickly, then every spawnInterval.</summary>
        public const double FirstSpawnDelay = 1;

        /// <summary>Spells hit crown towers for a fraction of their listed damage.</summary>
        public const double TowerSpellDamageFactor = 0.4;

        private readonly struct TowerStats
        {
            public readonly double Hp;
            public readonly double Damage;
            public readonly double HitSpeed;
            public readonly double Range;
            public readonly double Radius;

            public TowerStats(double hp, double damage, double hitSpeed, double range, double radius)
            {
                Hp = hp;
                Damage = damage;
                HitSpeed = hitSpeed;
                Range = range;
                Radius = radius;
            }
        }

        private static readonly Dictionary<TowerKind, TowerStats> TowerStatsByKind = new()
        {
            { TowerKind.Princess, new TowerStats(1400, 110, 0.8, 7.5, 1.0) },
            { TowerKind.King, new TowerStats(2600, 110, 1.0, 7.0, 1.3) },
        };

        // Spawn offsets so multi-unit cards don't stack on one point.
        private static readonly Dictionary<int, (double, double)[]> SpawnOffsets = new()
        {
            { 1, new[] { (0.0, 0.0) } },
            { 2, new[] { (-0.7, 0.0), (0.7, 0.0) } },
            { 3, new[] { (0.0, -0.6), (-0.7, 0.5), (0.7, 0.5) } },
        };

        public static bool IsValidDeck(IReadOnlyList<CardId> cards)
        {
            return cards.Count == 8 &&
                   cards.Distinct().Count() == 8 &&
                   cards.All(id => Cards.All.ContainsKey(id));
        }

        /// <summary>Stat multiplier for a side playing cardId: +10% per level.</summary>
        public static double LevelMultiplier(Dictionary<CardId, int> levels, CardId cardId)
        {
            int level = levels != null && levels.TryGetValue(cardId, out int l) ? l : 1;
            return 1 + 0.1 * (level - 1);
        }

        public static SideState SideState(BattleState state, Side side)
        {
            return side == Side.Player ? state.Player : state.Enemy;
        }

        public static bool IsBuilding(Entity e)
        {
            return e.Kind != EntityKind.Troop;
        }

        public static double Distance(double ax, double ay, double bx, double by)
        {
            double dx = ax - bx;
            double dy = ay - by;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        public static double Distance(Entity a, Entity b)
        {
            return Distance(a.X, a.Y, b.X, b.Y);
        }

        private static Entity MakeTower(BattleState state, Side side, TowerKind kind, double x, double y)
        {
            TowerStats s = TowerStatsByKind[kind];
            return new Entity
            {
                Id = state.NextEntityId++,
                Side = side,
                Kind = kind == TowerKind.King ? EntityKind.KingTower : EntityKind.PrincessTower,
                CardId = null,
                X = x,
                Y = y,
                Hp = s.Hp,
                MaxHp = s.Hp,
                Damage = s.Damage,
                HitSpeed = s.HitSpeed,
                AttackRange = s.Range,
                SightRange = s.Range,
                Speed = 0,
                TargetsBuildingsOnly = false,
                TargetsAir = true,
                Flying = false,
                JumpsRiver = false,
                SplashRadius = 0,
                ChargeDistance = 0,
                ChargeProgress = 0,
                DeployTimer = 0,
                StunTimer = 0,
                DecayPerSec = 0,
                DeathDamage = 0,
                DeathRadius = 0,
                SpawnUnitId = null,
                SpawnInterval = 0,
                SpawnTimer = 0,
                ElixirInterval = 0,
                ElixirTimer = 0,
                Radius = s.Radius,
                Cooldown = 0,
                TargetId = null,
                Active = kind != TowerKind.King,
            };
        }

        public static BattleState CreateBattle(
            IReadOnlyList<CardId> playerDeck = null,
            IReadOnlyList<CardId> enemyDeck = null,
            Dictionary<CardId, int> playerLevels = null,
            Dictionary<CardId, int> enemyLevels = null)
        {
            playerDeck ??= Cards.DefaultDeck;
            enemyDeck ??= Cards.DefaultDeck;

            var state = new BattleState
            {
                Player = new SideState
                {
                    Elixir = Elixir.Create(),
                    Hand = HandState.Create(playerDeck),
                    Crowns = 0,
                    Stats = new SideStats(),
                    Levels = playerLevels ?? new Dictionary<CardId, int>(),
                },
                Enemy = new SideState
                {
                    Elixir = Elixir.Create(),
                    Hand = HandState.Create(enemyDeck),
                    Crowns = 0,
                    Stats = new SideStats(),
                    Levels = enemyLevels ?? new Dictionary<CardId, int>(),
                },
            };

            foreach (Side side in new[] { Side.Player, Side.Enemy })
            {
                foreach (TowerSpot spot in Arena.TowerSpots(side))
                {
                    state.Entities.Add(MakeTower(state, side, spot.Kind, spot.X, spot.Y));
                }
            }

            return state;
        }

        /// <summary>
        /// Spawn the units of a troop card directly, bypassing hand/elixir/zone
        /// checks. Used by deploy and by the witch/tombstone spawners.
        /// </summary>
        public static List<Entity> SpawnUnits(BattleState state, Side side, CardId cardId, double x, double y)
        {
            Card card = Cards.Get(cardId);
            if (card is not TroopCard troop)
            {
                throw new InvalidOperationException($"{cardId} is not a troop card");
            }

            return SpawnTroops(state, side, troop, x, y);
        }

        private static List<Entity> SpawnTroops(BattleState state, Side side, TroopCard card, double x, double y)
        {
            double mult = LevelMultiplier(SideState(state, side).Levels, card.Id);
            (double, double)[] offsets = SpawnOffsets.TryGetValue(card.Count, out var o)
                ? o
                : new[] { (0.0, 0.0) };
            UnitStats u = card.Unit;
            var spawned = new List<Entity>();
            foreach ((double dx, double dy) in offsets)
            {
                spawned.Add(new Entity
                {
                    Id = state.NextEntityId++,
                    Side = side,
                    Kind = EntityKind.Troop,
                    CardId = card.Id,
                    X = x + dx,
                    Y = y + dy,
                    Hp = u.MaxHp * mult,
                    MaxHp = u.MaxHp * mult,
                    Damage = u.Damage * mult,
                    HitSpeed = u.HitSpeed,
                    AttackRange = u.AttackRange,
                    SightRange = u.SightRange,
                    Speed = Cards.SpeedTilesPerSec[u.Speed],
                    TargetsBuildingsOnly = u.TargetsBuildingsOnly,
                    TargetsAir = u.TargetsAir,
                    Flying = u.Flying,
                    JumpsRiver = u.JumpsRiver,
                    SplashRadius = u.SplashRadius,
                    ChargeDistance = u.ChargeDistance,
                    ChargeProgress = 0,
                    DeployTimer = DeployDelay,
                    StunTimer = 0,
                    Radius = u.Radius,
                    DecayPerSec = 0,
                    DeathDamage = u.DeathDamage * mult,
                    DeathRadius = u.DeathRadius,
                    SpawnUnitId = u.SpawnUnitId,
                    SpawnInterval = u.SpawnInterval,
                    SpawnTimer = FirstSpawnDelay,
                    ElixirInterval = 0,
                    ElixirTimer = 0,
                    Cooldown = 0,
                    TargetId = null,
                    Active = true,
                });
            }

            state.Entities.AddRange(spawned);
            return spawned;
        }

        private static void SpawnBuilding(BattleState state, Side side, BuildingCard card, double x, double y)
        {
            double mult = LevelMultiplier(SideState(state, side).Levels, card.Id);
            UnitStats u = card.Unit;
            state.Entities.Add(new Entity
            {
                Id = state.NextEntityId++,
                Side = side,
                Kind = EntityKind.Building,
                CardId = card.Id,
                X = x,
                Y = y,
                Hp = u.MaxHp * mult,
                MaxHp = u.MaxHp * mult,
                Damage = u.Damage * mult,
                HitSpeed = u.HitSpeed,
                AttackRange = u.AttackRange,
                SightRange = u.AttackRange,
                Speed = 0,
                TargetsBuildingsOnly = false,
                TargetsAir = u.TargetsAir,
                Flying = false,
                JumpsRiver = false,
                SplashRadius = u.SplashRadius,
                ChargeDistance = 0,
                ChargeProgress = 0,
                DeployTimer = DeployDelay,
                StunTimer = 0,
                DecayPerSec = u.MaxHp * mult / card.Lifetime,
                DeathDamage = u.DeathDamage,
                DeathRadius = u.DeathRadius,
                SpawnUnitId = u.SpawnUnitId,
                SpawnInterval = u.SpawnInterval,
                SpawnTimer = FirstSpawnDelay,
                ElixirInterval = u.ElixirInterval,
                ElixirTimer = u.ElixirInterval,
                Radius = u.Radius,
                Cooldown = 0,
                TargetId = null,
                Active = true,
            });
        }

        public static void ApplySpell(BattleState state, Side side, CardId cardId, double x, double y,
            double damage, double radius, double stunSeconds = 0, double knockback = 0)
        {
            foreach (Entity e in state.Entities)
            {
                if (e.Side == side || e.Hp <= 0)
                {
                    continue;
                }

                if (Distance(e.X, e.Y, x, y) > radius + e.Radius)
                {
                    continue;
                }

                // Only crown towers resist spells; deployed buildings take full damage.
                bool isCrownTower = e.Kind == EntityKind.PrincessTower || e.Kind == EntityKind.KingTower;
                double dealt = damage * (isCrownTower ? TowerSpellDamageFactor : 1);
                e.Hp -= dealt;
                SideState(state, side).Stats.DamageDealt += dealt;
                e.StunTimer = Math.Max(e.StunTimer, stunSeconds);

                if (knockback > 0 && e.Kind == EntityKind.Troop && e.Hp > 0)
                {
                    double d = Math.Max(0.1, Distance(e.X, e.Y, x, y));
                    e.X += (e.X - x) / d * knockback;
                    e.Y += (e.Y - y) / d * knockback;
                }
            }

            state.Effects.Add(new SpellEffect { CardId = cardId, X = x, Y = y, Radius = radius, Ttl = 0.6 });
        }

        /// <summary>
        /// Lanes where <paramref name="side"/> may push into enemy territory —
        /// opened wherever the opponent's princess tower on that side has fallen.
        /// </summary>
        public static OpenLanes OpenLanes(BattleState state, Side side)
        {
            Side opp = Arena.Opposite(side);

            bool Has(bool left) => state.Entities.Any(e =>
                e.Side == opp &&
                e.Kind == EntityKind.PrincessTower &&
                (e.X < Arena.ArenaWidth / 2) == left);

            return new OpenLanes(!Has(true), !Has(false));
        }

        public static DeployCheck CheckDeploy(BattleState state, Side side, CardId cardId, double x, double y)
        {
            if (state.Result != null)
            {
                return DeployCheck.Finished;
            }

            SideState me = SideState(state, side);
            if (!me.Hand.Cards.Contains(cardId))
            {
                return DeployCheck.NotInHand;
            }

            Card card = Cards.Get(cardId);
            bool validSpot = card.Kind == CardKind.Spell
                ? Arena.InArena(x, y)
                : Arena.CanDeployTroopAt(side, x, y, OpenLanes(state, side));
            if (!validSpot)
            {
                return DeployCheck.BadSpot;
            }

            if (Elixir.TrySpend(me.Elixir, card.Cost) == null)
            {
                return DeployCheck.NoElixir;
            }

            return DeployCheck.Ok;
        }

        /// <summary>
        /// Attempt to play a card for <paramref name="side"/> at (x, y). Returns
        /// false (with no state change) if invalid, unaffordable, or out of zone.
        /// </summary>
        public static bool DeployCard(BattleState state, Side side, CardId cardId, double x, double y)
        {
            if (CheckDeploy(state, side, cardId, x, y) != DeployCheck.Ok)
            {
                return false;
            }

            SideState me = SideState(state, side);
            Card card = Cards.Get(cardId);
            me.Elixir = Elixir.TrySpend(me.Elixir, card.Cost).Value;
            me.Stats.ElixirSpent += card.Cost;
            me.Hand = me.Hand.Play(cardId);

            switch (card)
            {
                case SpellCard spell:
                    state.Events.Add(new SpellEvent { Side = side, CardId = cardId, X = x, Y = y });
                    if (spell.RageSeconds > 0)
                    {
                        state.BuffZones.Add(new BuffZone { Side = side, X = x, Y = y, Radius = spell.Radius, Ttl = spell.RageSeconds });
                        state.Effects.Add(new SpellEffect { CardId = cardId, X = x, Y = y, Radius = spell.Radius, Ttl = spell.RageSeconds });
                    }
                    else
                    {
                        ApplySpell(state, side, cardId, x, y,
                            spell.Damage * LevelMultiplier(me.Levels, cardId),
                            spell.Radius, spell.StunSeconds, spell.Knockback);
                    }

                    break;

                case BuildingCard building:
                    state.Events.Add(new DeployEvent { Side = side, CardId = cardId });
                    SpawnBuilding(state, side, building, x, y);
                    break;

                case TroopCard troop:
                    state.Events.Add(new DeployEvent { Side = side, CardId = cardId });
                    SpawnTroops(state, side, troop, x, y);
                    break;
            }

            return true;
        }
    }
}
