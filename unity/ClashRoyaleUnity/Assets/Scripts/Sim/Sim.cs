using System;
using System.Collections.Generic;
using System.Linq;

namespace ClashRoyale.Sim
{
    /// <summary>Faithful port of <c>src/game/sim.ts</c>: the per-tick battle update.</summary>
    public static class Simulation
    {
        /// <summary>Regular time length; the final minute of it is double elixir.</summary>
        public const double BattleDuration = 180;
        public const double DoubleElixirAt = 120;

        /// <summary>Sudden-death overtime length (CR: 2 minutes, last one at 3x).</summary>
        public const double OvertimeDuration = 120;

        /// <summary>Tiles per second a ranged shot travels.</summary>
        public const double ProjectileSpeed = 9;

        /// <summary>Speed/attack-rate multiplier for troops inside a friendly rage zone.</summary>
        public const double RageBoost = 1.35;

        // Bodies can squeeze a little, like CR's soft crowds.
        private const double CollisionSlack = 0.9;

        public static int ElixirMultiplier(BattleState state)
        {
            if (state.Overtime && state.Time >= BattleDuration + OvertimeDuration / 2)
            {
                return 3;
            }

            if (state.Overtime || state.Time >= DoubleElixirAt)
            {
                return 2;
            }

            return 1;
        }

        public static bool IsDoubleElixir(BattleState state)
        {
            return ElixirMultiplier(state) >= 2;
        }

        private static List<Entity> LivingEnemiesOf(BattleState state, Entity e)
        {
            return state.Entities.Where(o => o.Side != e.Side && o.Hp > 0).ToList();
        }

        /// <summary>Distance between hull edges, used for both range and sight checks.</summary>
        private static double Gap(Entity a, Entity b)
        {
            return Battle.Distance(a, b) - a.Radius - b.Radius;
        }

        private static Entity Nearest(Entity from, IEnumerable<Entity> candidates)
        {
            Entity best = null;
            double bestDist = double.PositiveInfinity;
            foreach (Entity c in candidates)
            {
                double d = Battle.Distance(from, c);
                if (d < bestDist)
                {
                    bestDist = d;
                    best = c;
                }
            }

            return best;
        }

        private static Entity FindById(BattleState state, int? id)
        {
            if (id == null)
            {
                return null;
            }

            Entity e = state.Entities.FirstOrDefault(o => o.Id == id.Value);
            return e != null && e.Hp > 0 ? e : null;
        }

        /// <summary>Ground-only attackers cannot touch flyers.</summary>
        private static bool CanHit(Entity e, Entity o)
        {
            return !o.Flying || e.TargetsAir;
        }

        private static Entity AcquireTarget(BattleState state, Entity e)
        {
            List<Entity> enemies = LivingEnemiesOf(state, e);
            if (Battle.IsBuilding(e))
            {
                IEnumerable<Entity> inRange = enemies.Where(o =>
                    o.Kind == EntityKind.Troop && CanHit(e, o) && Gap(e, o) <= e.AttackRange);
                return Nearest(e, inRange);
            }

            if (e.TargetsBuildingsOnly)
            {
                return Nearest(e, enemies.Where(Battle.IsBuilding));
            }

            // Nearest enemy: any troop within sight plus every building/tower.
            IEnumerable<Entity> candidates = enemies.Where(o =>
                CanHit(e, o) &&
                (Battle.IsBuilding(o) || (o.Kind == EntityKind.Troop && Gap(e, o) <= e.SightRange)));
            return Nearest(e, candidates);
        }

        private static Entity Retarget(BattleState state, Entity e)
        {
            Entity current = FindById(state, e.TargetId);
            if (Battle.IsBuilding(e))
            {
                if (current != null && current.Kind == EntityKind.Troop && Gap(e, current) <= e.AttackRange)
                {
                    return current;
                }

                return AcquireTarget(state, e);
            }

            // Troops stay locked onto enemy troops; ones merely walking toward a
            // building re-check for closer threats.
            if (current != null && current.Kind == EntityKind.Troop)
            {
                return current;
            }

            return AcquireTarget(state, e);
        }

        /// <summary>
        /// Where should a troop walk to reach its target? Straight at it on the
        /// same half; via the nearest bridge when the river is in the way.
        /// </summary>
        public static (double X, double Y) MoveGoal(Entity e, Entity target)
        {
            if (e.Flying || e.JumpsRiver)
            {
                return (target.X, target.Y);
            }

            bool crossesRiver =
                (e.Y - Arena.RiverY) * (target.Y - Arena.RiverY) < 0 ||
                Math.Abs(e.Y - Arena.RiverY) < Arena.RiverHalfWidth;
            if (!crossesRiver)
            {
                return (target.X, target.Y);
            }

            double bx = Arena.NearestBridgeX(e.X);
            double towardEnemy = target.Y < e.Y ? -1 : 1;
            double exitY = Arena.RiverY + towardEnemy * (Arena.RiverHalfWidth + 0.4);
            if (Math.Abs(e.X - bx) <= Arena.BridgeHalfWidth)
            {
                return (bx, exitY);
            }

            return (bx, Arena.RiverY - towardEnemy * (Arena.RiverHalfWidth + 0.4));
        }

        private static double MoveToward(Entity e, (double X, double Y) goal, double dt)
        {
            double d = Battle.Distance(e.X, e.Y, goal.X, goal.Y);
            if (d < 1e-6)
            {
                return 0;
            }

            double step = Math.Min(e.Speed * dt, d);
            e.X += (goal.X - e.X) / d * step;
            e.Y += (goal.Y - e.Y) / d * step;
            return step;
        }

        private static void DealDamage(BattleState state, Entity e, Entity target)
        {
            bool charged = e.ChargeDistance > 0 && e.ChargeProgress >= e.ChargeDistance;
            double damage = e.Damage * (charged ? 2 : 1);
            bool ranged = e.AttackRange > 1;
            if (ranged)
            {
                state.Projectiles.Add(new Projectile
                {
                    Id = state.NextEntityId++,
                    Side = e.Side,
                    CardId = e.CardId,
                    SourceKind = e.Kind,
                    Sx = e.X,
                    Sy = e.Y,
                    X = e.X,
                    Y = e.Y,
                    TargetId = target.Id,
                    Speed = ProjectileSpeed,
                    Damage = damage,
                    SplashRadius = e.SplashRadius,
                    TargetsAir = e.TargetsAir,
                });
            }
            else
            {
                SideStats myStats = Battle.SideState(state, e.Side).Stats;
                target.Hp -= damage;
                myStats.DamageDealt += damage;
                if (e.SplashRadius > 0)
                {
                    foreach (Entity o in LivingEnemiesOf(state, e))
                    {
                        if (ReferenceEquals(o, target) || !CanHit(e, o))
                        {
                            continue;
                        }

                        if (Battle.Distance(o, target) <= e.SplashRadius + o.Radius)
                        {
                            o.Hp -= damage;
                            myStats.DamageDealt += damage;
                        }
                    }
                }
            }

            e.ChargeProgress = 0;
            e.Cooldown = e.HitSpeed;
            state.Events.Add(new AttackEvent
            {
                Kind = e.Kind,
                CardId = e.CardId,
                Ranged = ranged,
                X = e.X,
                Y = e.Y,
                TargetX = target.X,
                TargetY = target.Y,
            });
        }

        private static void TickProjectiles(BattleState state, double dt)
        {
            var survivors = new List<Projectile>();
            foreach (Projectile p in state.Projectiles)
            {
                Entity target = state.Entities.FirstOrDefault(o => o.Id == p.TargetId);
                if (target == null || target.Hp <= 0)
                {
                    continue; // fizzle mid-air
                }

                double dx = target.X - p.X;
                double dy = target.Y - p.Y;
                double d = Math.Sqrt(dx * dx + dy * dy);
                double step = p.Speed * dt;
                if (d <= step + target.Radius * 0.5)
                {
                    SideStats myStats = Battle.SideState(state, p.Side).Stats;
                    target.Hp -= p.Damage;
                    myStats.DamageDealt += p.Damage;
                    if (p.SplashRadius > 0)
                    {
                        foreach (Entity o in state.Entities)
                        {
                            if (o.Side == p.Side || o.Hp <= 0 || ReferenceEquals(o, target))
                            {
                                continue;
                            }

                            if (o.Flying && !p.TargetsAir)
                            {
                                continue;
                            }

                            if (Battle.Distance(o, target) <= p.SplashRadius + o.Radius)
                            {
                                o.Hp -= p.Damage;
                                myStats.DamageDealt += p.Damage;
                            }
                        }
                    }

                    continue;
                }

                p.X += dx / d * step;
                p.Y += dy / d * step;
                survivors.Add(p);
            }

            state.Projectiles = survivors;
        }

        public static bool IsRaged(BattleState state, Entity e)
        {
            return state.BuffZones.Any(z =>
                z.Side == e.Side && Battle.Distance(e.X, e.Y, z.X, z.Y) <= z.Radius + e.Radius);
        }

        private static double RageBoostFor(BattleState state, Entity e)
        {
            return IsRaged(state, e) ? RageBoost : 1;
        }

        private static void TickSpawner(BattleState state, Entity e, double dt)
        {
            if (e.SpawnUnitId == null)
            {
                return;
            }

            e.SpawnTimer -= dt;
            if (e.SpawnTimer > 0)
            {
                return;
            }

            double toward = e.Side == Side.Player ? -1 : 1;
            Battle.SpawnUnits(state, e.Side, e.SpawnUnitId.Value, e.X, e.Y + toward * (e.Radius + 0.5));
            e.SpawnTimer += e.SpawnInterval;
        }

        private static void TickCollector(BattleState state, Entity e, double dt)
        {
            if (e.ElixirInterval <= 0)
            {
                return;
            }

            e.ElixirTimer -= dt;
            if (e.ElixirTimer > 0)
            {
                return;
            }

            e.ElixirTimer += e.ElixirInterval;
            SideState owner = Battle.SideState(state, e.Side);
            owner.Elixir = new ElixirState(Math.Min(Elixir.ElixirMax, owner.Elixir.Amount + 1));
            state.Effects.Add(new SpellEffect { CardId = e.CardId.Value, X = e.X, Y = e.Y, Radius = 0.8, Ttl = 0.5 });
        }

        private static void ActEntity(BattleState state, Entity e, double dt)
        {
            double boostedDt = dt * RageBoostFor(state, e);
            e.Cooldown = Math.Max(0, e.Cooldown - boostedDt);
            if (!e.Active)
            {
                return;
            }

            if (e.StunTimer > 0)
            {
                e.StunTimer -= dt;
                return;
            }

            Entity target = Retarget(state, e);
            e.TargetId = target?.Id;

            if (e.DeployTimer > 0)
            {
                e.DeployTimer -= dt;
                return;
            }

            TickSpawner(state, e, dt);
            TickCollector(state, e, dt);
            if (target == null)
            {
                return;
            }

            if (Gap(e, target) <= e.AttackRange)
            {
                if (e.Cooldown == 0)
                {
                    DealDamage(state, e, target);
                }
            }
            else if (e.Kind == EntityKind.Troop)
            {
                double step = MoveToward(e, MoveGoal(e, target), boostedDt);
                if (e.ChargeDistance > 0)
                {
                    e.ChargeProgress += step;
                }
            }
        }

        private static void ExplodeOnDeath(BattleState state, Entity e)
        {
            if (e.DeathDamage <= 0)
            {
                return;
            }

            foreach (Entity o in LivingEnemiesOf(state, e))
            {
                if (Battle.Distance(o, e) <= e.DeathRadius + o.Radius)
                {
                    o.Hp -= e.DeathDamage;
                    Battle.SideState(state, e.Side).Stats.DamageDealt += e.DeathDamage;
                }
            }

            state.Effects.Add(new SpellEffect
            {
                CardId = e.CardId ?? CardId.Fireball,
                X = e.X,
                Y = e.Y,
                Radius = e.DeathRadius,
                Ttl = 0.6,
            });
        }

        private static void ResolveCollisions(BattleState state)
        {
            List<Entity> solids = state.Entities.Where(e => e.Hp > 0).ToList();
            for (int pass = 0; pass < 2; pass++)
            {
                for (int i = 0; i < solids.Count; i++)
                {
                    for (int j = i + 1; j < solids.Count; j++)
                    {
                        Entity a = solids[i];
                        Entity b = solids[j];
                        if (a.Flying != b.Flying)
                        {
                            continue;
                        }

                        double minDist = (a.Radius + b.Radius) * CollisionSlack;
                        double dx = b.X - a.X;
                        double dy = b.Y - a.Y;
                        double d = Math.Sqrt(dx * dx + dy * dy);
                        if (d >= minDist)
                        {
                            continue;
                        }

                        if (d < 1e-6)
                        {
                            dx = 0.01 * (((a.Id + b.Id) % 7 - 3) != 0 ? (a.Id + b.Id) % 7 - 3 : 1);
                            dy = 0.01 * (((a.Id * 3 + b.Id) % 5 - 2) != 0 ? (a.Id * 3 + b.Id) % 5 - 2 : 1);
                            d = Math.Sqrt(dx * dx + dy * dy);
                        }

                        double overlap = minDist - d;
                        double nx = dx / d;
                        double ny = dy / d;
                        bool aMoves = a.Kind == EntityKind.Troop;
                        bool bMoves = b.Kind == EntityKind.Troop;
                        if (aMoves && bMoves)
                        {
                            double aShare = b.Radius / (a.Radius + b.Radius);
                            a.X -= nx * overlap * aShare;
                            a.Y -= ny * overlap * aShare;
                            b.X += nx * overlap * (1 - aShare);
                            b.Y += ny * overlap * (1 - aShare);
                        }
                        else if (aMoves)
                        {
                            a.X -= nx * overlap;
                            a.Y -= ny * overlap;
                        }
                        else if (bMoves)
                        {
                            b.X += nx * overlap;
                            b.Y += ny * overlap;
                        }
                    }
                }
            }
        }

        private static void ProcessDeaths(BattleState state)
        {
            foreach (Entity e in state.Entities)
            {
                if (e.Hp > 0)
                {
                    continue;
                }

                ExplodeOnDeath(state, e);
                state.Events.Add(new DeathEvent
                {
                    Kind = e.Kind,
                    CardId = e.CardId,
                    Side = e.Side,
                    X = e.X,
                    Y = e.Y,
                });

                if (e.Kind == EntityKind.PrincessTower)
                {
                    Side winner = e.Side == Side.Player ? Side.Enemy : Side.Player;
                    Battle.SideState(state, winner).Crowns += 1;
                    state.Events.Add(new CrownEvent { Winner = winner });
                    WakeKing(state, e.Side);
                }
                else if (e.Kind == EntityKind.KingTower)
                {
                    Side winner = e.Side == Side.Player ? Side.Enemy : Side.Player;
                    Battle.SideState(state, winner).Crowns = 3;
                    state.Events.Add(new CrownEvent { Winner = winner });
                    Finish(state, winner == Side.Player ? BattleWinner.Player : BattleWinner.Enemy);
                }
            }

            state.Entities = state.Entities.Where(e => e.Hp > 0).ToList();
        }

        private static void WakeKing(BattleState state, Side side)
        {
            foreach (Entity e in state.Entities)
            {
                if (e.Side == side && e.Kind == EntityKind.KingTower && !e.Active)
                {
                    e.Active = true;
                    state.Events.Add(new KingWakeEvent { Side = e.Side });
                }
            }
        }

        private static void WakeDamagedKings(BattleState state)
        {
            foreach (Entity e in state.Entities)
            {
                if (e.Kind == EntityKind.KingTower && e.Hp < e.MaxHp && !e.Active)
                {
                    WakeKing(state, e.Side);
                }
            }
        }

        /// <summary>Advance the battle by dt seconds. No-op once a result is set.</summary>
        public static void Tick(BattleState state, double dt)
        {
            if (state.Result != null)
            {
                return;
            }

            state.Time += dt;

            int mult = ElixirMultiplier(state);
            state.Player.Elixir = Elixir.Tick(state.Player.Elixir, dt, mult);
            state.Enemy.Elixir = Elixir.Tick(state.Enemy.Elixir, dt, mult);

            foreach (SpellEffect effect in state.Effects)
            {
                effect.Ttl -= dt;
            }

            state.Effects = state.Effects.Where(f => f.Ttl > 0).ToList();

            foreach (BuffZone zone in state.BuffZones)
            {
                zone.Ttl -= dt;
            }

            state.BuffZones = state.BuffZones.Where(z => z.Ttl > 0).ToList();

            foreach (Entity e in state.Entities)
            {
                if (e.Kind == EntityKind.Building)
                {
                    e.Hp -= e.DecayPerSec * dt;
                }
            }

            WakeDamagedKings(state);
            foreach (Entity e in state.Entities.ToList())
            {
                if (e.Hp > 0)
                {
                    ActEntity(state, e, dt);
                }
            }

            TickProjectiles(state, dt);
            ResolveCollisions(state);
            WakeDamagedKings(state);
            ProcessDeaths(state);
            CheckClock(state);
        }

        private static void Finish(BattleState state, BattleWinner winner)
        {
            state.Result = new BattleResult
            {
                Winner = winner,
                PlayerCrowns = state.Player.Crowns,
                EnemyCrowns = state.Enemy.Crowns,
            };
            state.Events.Add(new FinishEvent { Winner = winner });
        }

        private static void CheckClock(BattleState state)
        {
            if (state.Result != null)
            {
                return;
            }

            int crownDiff = state.Player.Crowns - state.Enemy.Crowns;
            if (!state.Overtime)
            {
                if (state.Time < BattleDuration)
                {
                    return;
                }

                if (crownDiff != 0)
                {
                    Finish(state, crownDiff > 0 ? BattleWinner.Player : BattleWinner.Enemy);
                }
                else
                {
                    state.Overtime = true;
                }

                return;
            }

            if (crownDiff != 0)
            {
                Finish(state, crownDiff > 0 ? BattleWinner.Player : BattleWinner.Enemy);
            }
            else if (state.Time >= BattleDuration + OvertimeDuration)
            {
                Finish(state, TowerHpTiebreak(state));
            }
        }

        private static BattleWinner TowerHpTiebreak(BattleState state)
        {
            double Worst(Side side) => state.Entities
                .Where(e => e.Side == side && Battle.IsBuilding(e) && e.CardId == null)
                .Select(e => e.Hp)
                .DefaultIfEmpty(0)
                .Min();

            double p = Worst(Side.Player);
            double en = Worst(Side.Enemy);
            if (p == en)
            {
                return BattleWinner.Draw;
            }

            return p > en ? BattleWinner.Player : BattleWinner.Enemy;
        }
    }
}
