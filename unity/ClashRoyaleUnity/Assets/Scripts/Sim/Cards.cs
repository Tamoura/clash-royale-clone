using System.Collections.Generic;

namespace ClashRoyale.Sim
{
    public enum CardId
    {
        Knight,
        Archers,
        Giant,
        Musketeer,
        MiniPekka,
        Skeletons,
        Fireball,
        Arrows,
        Zap,
        Rage,
        Freeze,
        Wizard,
        Witch,
        HogRider,
        Balloon,
        BabyDragon,
        Gargoyles,
        Valkyrie,
        Prince,
        Pekka,
        Cannon,
        Tombstone,
        ElixirCollector,
    }

    public enum Speed
    {
        Slow,
        Medium,
        Fast,
    }

    /// <summary>CR-style card rarity, shown as the card frame color.</summary>
    public enum Rarity
    {
        Common,
        Rare,
        Epic,
    }

    public enum CardKind
    {
        Troop,
        Building,
        Spell,
    }

    /// <summary>Per-unit combat stats, ported from <c>UnitStats</c> in cards.ts.</summary>
    public sealed class UnitStats
    {
        public double MaxHp;
        public double Damage;

        /// <summary>Seconds between attacks.</summary>
        public double HitSpeed;

        /// <summary>Distance (tiles) at which the unit can attack. Melee ~= 0.8.</summary>
        public double AttackRange;

        /// <summary>Distance (tiles) at which the unit notices enemy troops.</summary>
        public double SightRange = 5.5;

        public Speed Speed;
        public bool TargetsBuildingsOnly;
        public bool TargetsAir;
        public bool Flying;
        public bool JumpsRiver;
        public double SplashRadius;
        public double ChargeDistance;
        public double DeathDamage;
        public double DeathRadius;
        public CardId? SpawnUnitId;
        public double SpawnInterval;
        public double ElixirInterval;
        public double Radius = 0.5;
    }

    public abstract class Card
    {
        public CardId Id;
        public string Name;
        public Rarity Rarity;
        public CardKind Kind;
        public int Cost;
    }

    public sealed class TroopCard : Card
    {
        /// <summary>Number of units spawned per deploy.</summary>
        public int Count;
        public UnitStats Unit;
    }

    public sealed class BuildingCard : Card
    {
        /// <summary>Seconds before the building expires on its own.</summary>
        public double Lifetime;
        public UnitStats Unit;
    }

    public sealed class SpellCard : Card
    {
        public double Damage;
        public double Radius;
        public double StunSeconds;
        public double RageSeconds;
        public double Knockback;
    }

    public static class Cards
    {
        public const double Melee = 0.8;

        /// <summary>Tiles per second for each named speed.</summary>
        public static readonly Dictionary<Speed, double> SpeedTilesPerSec = new()
        {
            { Speed.Slow, 0.75 },
            { Speed.Medium, 1.1 },
            { Speed.Fast, 1.6 },
        };

        public static readonly Dictionary<CardId, Card> All = BuildCards();

        public static Card Get(CardId id)
        {
            return All[id];
        }

        /// <summary>
        /// Deck order doubles as the starting draw: the first 4 are the opening hand.
        /// </summary>
        public static readonly List<CardId> Deck = new()
        {
            CardId.Knight, CardId.Archers, CardId.Giant, CardId.Fireball,
            CardId.Musketeer, CardId.MiniPekka, CardId.BabyDragon, CardId.Valkyrie,
            CardId.Skeletons, CardId.Wizard, CardId.Witch, CardId.HogRider,
            CardId.Balloon, CardId.Prince, CardId.Pekka, CardId.Cannon,
            CardId.Tombstone, CardId.ElixirCollector, CardId.Gargoyles, CardId.Arrows,
            CardId.Zap, CardId.Rage, CardId.Freeze,
        };

        /// <summary>CR-style 8-card battle deck; first 4 are the opening hand.</summary>
        public static readonly List<CardId> DefaultDeck = new()
        {
            CardId.Knight, CardId.Archers, CardId.Giant, CardId.Fireball,
            CardId.Musketeer, CardId.MiniPekka, CardId.BabyDragon, CardId.Arrows,
        };

        private static TroopCard Troop(CardId id, string name, Rarity rarity, int cost, int count, UnitStats unit)
        {
            return new TroopCard
            {
                Id = id, Name = name, Rarity = rarity, Kind = CardKind.Troop,
                Cost = cost, Count = count, Unit = unit,
            };
        }

        private static BuildingCard Building(CardId id, string name, Rarity rarity, int cost, double lifetime, UnitStats unit)
        {
            return new BuildingCard
            {
                Id = id, Name = name, Rarity = rarity, Kind = CardKind.Building,
                Cost = cost, Lifetime = lifetime, Unit = unit,
            };
        }

        private static SpellCard Spell(CardId id, string name, Rarity rarity, int cost,
            double damage, double radius, double stunSeconds, double rageSeconds, double knockback)
        {
            return new SpellCard
            {
                Id = id, Name = name, Rarity = rarity, Kind = CardKind.Spell, Cost = cost,
                Damage = damage, Radius = radius, StunSeconds = stunSeconds,
                RageSeconds = rageSeconds, Knockback = knockback,
            };
        }

        private static Dictionary<CardId, Card> BuildCards()
        {
            return new Dictionary<CardId, Card>
            {
                [CardId.Knight] = Troop(CardId.Knight, "Knight", Rarity.Common, 3, 1, new UnitStats
                {
                    MaxHp = 1400, Damage = 160, HitSpeed = 1.2, AttackRange = Melee, Speed = Speed.Medium,
                }),
                [CardId.Archers] = Troop(CardId.Archers, "Archers", Rarity.Common, 3, 2, new UnitStats
                {
                    MaxHp = 250, Damage = 90, HitSpeed = 1.2, AttackRange = 5, Speed = Speed.Medium,
                    TargetsAir = true, Radius = 0.4,
                }),
                [CardId.Giant] = Troop(CardId.Giant, "Giant", Rarity.Rare, 5, 1, new UnitStats
                {
                    MaxHp = 3300, Damage = 210, HitSpeed = 1.5, AttackRange = Melee, SightRange = 7.5,
                    Speed = Speed.Slow, TargetsBuildingsOnly = true, Radius = 0.75,
                }),
                [CardId.Musketeer] = Troop(CardId.Musketeer, "Musketeer", Rarity.Rare, 4, 1, new UnitStats
                {
                    MaxHp = 600, Damage = 180, HitSpeed = 1.1, AttackRange = 6, SightRange = 6,
                    Speed = Speed.Medium, TargetsAir = true,
                }),
                [CardId.MiniPekka] = Troop(CardId.MiniPekka, "Mini P.E.K.K.A", Rarity.Rare, 4, 1, new UnitStats
                {
                    MaxHp = 1100, Damage = 600, HitSpeed = 1.8, AttackRange = Melee, Speed = Speed.Fast,
                }),
                [CardId.Skeletons] = Troop(CardId.Skeletons, "Skeletons", Rarity.Common, 1, 3, new UnitStats
                {
                    MaxHp = 80, Damage = 80, HitSpeed = 1.0, AttackRange = Melee, Speed = Speed.Fast, Radius = 0.3,
                }),
                [CardId.Wizard] = Troop(CardId.Wizard, "Wizard", Rarity.Rare, 5, 1, new UnitStats
                {
                    MaxHp = 600, Damage = 230, HitSpeed = 1.4, AttackRange = 5.5, SightRange = 6,
                    Speed = Speed.Medium, TargetsAir = true, SplashRadius = 1.2,
                }),
                [CardId.Witch] = Troop(CardId.Witch, "Witch", Rarity.Epic, 5, 1, new UnitStats
                {
                    MaxHp = 700, Damage = 130, HitSpeed = 1.1, AttackRange = 5, SightRange = 5.5,
                    Speed = Speed.Medium, TargetsAir = true, SplashRadius = 1.0,
                    SpawnUnitId = CardId.Skeletons, SpawnInterval = 7,
                }),
                [CardId.HogRider] = Troop(CardId.HogRider, "Hog Rider", Rarity.Rare, 4, 1, new UnitStats
                {
                    MaxHp = 1500, Damage = 260, HitSpeed = 1.6, AttackRange = Melee, SightRange = 7.5,
                    Speed = Speed.Fast, TargetsBuildingsOnly = true, JumpsRiver = true, Radius = 0.6,
                }),
                [CardId.Balloon] = Troop(CardId.Balloon, "Balloon", Rarity.Epic, 5, 1, new UnitStats
                {
                    MaxHp = 1500, Damage = 600, HitSpeed = 3, AttackRange = Melee, SightRange = 7.5,
                    Speed = Speed.Medium, TargetsBuildingsOnly = true, Flying = true,
                    DeathDamage = 300, DeathRadius = 1.5, Radius = 0.7,
                }),
                [CardId.BabyDragon] = Troop(CardId.BabyDragon, "Baby Dragon", Rarity.Epic, 4, 1, new UnitStats
                {
                    MaxHp = 1050, Damage = 130, HitSpeed = 1.5, AttackRange = 3.5, Speed = Speed.Fast,
                    TargetsAir = true, Flying = true, SplashRadius = 1.0, Radius = 0.6,
                }),
                [CardId.Gargoyles] = Troop(CardId.Gargoyles, "Gargoyles", Rarity.Common, 3, 3, new UnitStats
                {
                    MaxHp = 190, Damage = 85, HitSpeed = 1.0, AttackRange = Melee, Speed = Speed.Fast,
                    TargetsAir = true, Flying = true, Radius = 0.35,
                }),
                [CardId.Valkyrie] = Troop(CardId.Valkyrie, "Valkyrie", Rarity.Rare, 4, 1, new UnitStats
                {
                    MaxHp = 1500, Damage = 220, HitSpeed = 1.5, AttackRange = Melee, Speed = Speed.Medium,
                    SplashRadius = 1.2,
                }),
                [CardId.Prince] = Troop(CardId.Prince, "Prince", Rarity.Epic, 5, 1, new UnitStats
                {
                    MaxHp = 1500, Damage = 325, HitSpeed = 1.4, AttackRange = Melee, Speed = Speed.Medium,
                    ChargeDistance = 2.5, Radius = 0.6,
                }),
                [CardId.Pekka] = Troop(CardId.Pekka, "P.E.K.K.A", Rarity.Epic, 7, 1, new UnitStats
                {
                    MaxHp = 2900, Damage = 650, HitSpeed = 1.8, AttackRange = Melee, Speed = Speed.Slow, Radius = 0.7,
                }),
                [CardId.Cannon] = Building(CardId.Cannon, "Cannon", Rarity.Common, 3, 30, new UnitStats
                {
                    MaxHp = 800, Damage = 130, HitSpeed = 0.9, AttackRange = 5.5, Speed = Speed.Slow, Radius = 0.6,
                }),
                [CardId.Tombstone] = Building(CardId.Tombstone, "Tombstone", Rarity.Rare, 3, 30, new UnitStats
                {
                    MaxHp = 600, Damage = 0, HitSpeed = 1, AttackRange = 0, Speed = Speed.Slow,
                    SpawnUnitId = CardId.Skeletons, SpawnInterval = 6, Radius = 0.6,
                }),
                [CardId.ElixirCollector] = Building(CardId.ElixirCollector, "Elixir Collector", Rarity.Rare, 6, 70, new UnitStats
                {
                    MaxHp = 900, Damage = 0, HitSpeed = 1, AttackRange = 0, Speed = Speed.Slow,
                    ElixirInterval = 8.5, Radius = 0.6,
                }),
                [CardId.Fireball] = Spell(CardId.Fireball, "Fireball", Rarity.Rare, 4, 570, 2.5, 0, 0, 0.8),
                [CardId.Arrows] = Spell(CardId.Arrows, "Arrows", Rarity.Common, 3, 240, 4, 0, 0, 0),
                [CardId.Zap] = Spell(CardId.Zap, "Zap", Rarity.Common, 2, 250, 2, 0.5, 0, 0),
                [CardId.Rage] = Spell(CardId.Rage, "Rage", Rarity.Epic, 2, 0, 2.5, 0, 6, 0),
                [CardId.Freeze] = Spell(CardId.Freeze, "Freeze", Rarity.Epic, 4, 0, 3, 4, 0, 0),
            };
        }
    }
}
