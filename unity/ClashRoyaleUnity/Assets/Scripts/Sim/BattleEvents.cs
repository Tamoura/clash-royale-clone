namespace ClashRoyale.Sim
{
    public enum EntityKind
    {
        Troop,
        Building,
        PrincessTower,
        KingTower,
    }

    public enum BattleWinner
    {
        Player,
        Enemy,
        Draw,
    }

    /// <summary>
    /// Gameplay moments recorded during deploys and ticks. The render/audio
    /// layer drains <see cref="BattleState.Events"/> each frame. Ported from
    /// the <c>BattleEvent</c> union in battle.ts.
    /// </summary>
    public abstract class BattleEvent
    {
    }

    public sealed class DeployEvent : BattleEvent
    {
        public Side Side;
        public CardId CardId;
    }

    public sealed class SpellEvent : BattleEvent
    {
        public Side Side;
        public CardId CardId;
        public double X;
        public double Y;
    }

    public sealed class AttackEvent : BattleEvent
    {
        public EntityKind Kind;
        public CardId? CardId;
        public bool Ranged;
        public double X;
        public double Y;
        public double TargetX;
        public double TargetY;
    }

    public sealed class DeathEvent : BattleEvent
    {
        public EntityKind Kind;
        public CardId? CardId;
        public Side Side;
        public double X;
        public double Y;
    }

    public sealed class CrownEvent : BattleEvent
    {
        public Side Winner;
    }

    public sealed class KingWakeEvent : BattleEvent
    {
        public Side Side;
    }

    public sealed class FinishEvent : BattleEvent
    {
        public BattleWinner Winner;
    }
}
