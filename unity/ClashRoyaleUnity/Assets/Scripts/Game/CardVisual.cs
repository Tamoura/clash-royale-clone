using System.Collections.Generic;
using ClashRoyale.Sim;
using UnityEngine;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Per-card and per-side colors for the primitive renderer. Loosely mirrors
    /// the web build's palette so the two editions feel like the same game.
    /// </summary>
    public static class CardVisual
    {
        public static readonly Color PlayerTint = new Color(0.36f, 0.72f, 1.0f);
        public static readonly Color EnemyTint = new Color(1.0f, 0.42f, 0.42f);
        public static readonly Color PlayerTower = new Color(0.30f, 0.60f, 0.95f);
        public static readonly Color EnemyTower = new Color(0.90f, 0.32f, 0.32f);

        private static readonly Dictionary<CardId, Color> Colors = new()
        {
            { CardId.Knight, Hex(0x8d9bb5) },
            { CardId.Archers, Hex(0x6fae5a) },
            { CardId.Giant, Hex(0xc89b6b) },
            { CardId.Musketeer, Hex(0x9a5fb0) },
            { CardId.MiniPekka, Hex(0x4a5568) },
            { CardId.Skeletons, Hex(0xd8d8d0) },
            { CardId.Fireball, Hex(0xff7a3c) },
            { CardId.Arrows, Hex(0xc7d36b) },
            { CardId.Zap, Hex(0x7fd4ff) },
            { CardId.Rage, Hex(0xc964e0) },
            { CardId.Freeze, Hex(0x6fd0ff) },
            { CardId.Wizard, Hex(0xff8a4c) },
            { CardId.Witch, Hex(0x7a52a8) },
            { CardId.HogRider, Hex(0xb5783f) },
            { CardId.Balloon, Hex(0xd24b6a) },
            { CardId.BabyDragon, Hex(0x5fbf7a) },
            { CardId.Gargoyles, Hex(0x8a7fb0) },
            { CardId.Valkyrie, Hex(0xd07a4a) },
            { CardId.Prince, Hex(0xd9b24a) },
            { CardId.Pekka, Hex(0x3a4458) },
            { CardId.Cannon, Hex(0x9aa0a8) },
            { CardId.Tombstone, Hex(0xaeb6c2) },
            { CardId.ElixirCollector, Hex(0xc764d0) },
        };

        public static Color ForCard(CardId id)
        {
            return Colors.TryGetValue(id, out Color c) ? c : Color.gray;
        }

        public static Color SideTint(Side side)
        {
            return side == Side.Player ? PlayerTint : EnemyTint;
        }

        private static Color Hex(int rgb)
        {
            return new Color(
                ((rgb >> 16) & 0xff) / 255f,
                ((rgb >> 8) & 0xff) / 255f,
                (rgb & 0xff) / 255f);
        }
    }
}
