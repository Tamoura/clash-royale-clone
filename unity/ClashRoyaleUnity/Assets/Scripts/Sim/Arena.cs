using System;

namespace ClashRoyale.Sim
{
    public enum Side
    {
        Player,
        Enemy,
    }

    public enum TowerKind
    {
        Princess,
        King,
    }

    public readonly struct TowerSpot
    {
        public readonly TowerKind Kind;
        public readonly double X;
        public readonly double Y;

        public TowerSpot(TowerKind kind, double x, double y)
        {
            Kind = kind;
            X = x;
            Y = y;
        }
    }

    /// <summary>Lanes (by side) opened into enemy territory by a fallen tower.</summary>
    public struct OpenLanes
    {
        public bool Left;
        public bool Right;

        public OpenLanes(bool left, bool right)
        {
            Left = left;
            Right = right;
        }
    }

    /// <summary>
    /// Faithful port of <c>src/game/arena.ts</c>. All coordinates are in tile
    /// units; y=0 is the enemy back line.
    /// </summary>
    public static class Arena
    {
        public const double ArenaWidth = 18;
        public const double ArenaHeight = 32;
        public const double RiverY = 16;

        /// <summary>The river is impassable except within half a tile of a bridge.</summary>
        public const double RiverHalfWidth = 1;

        public static readonly double[] BridgeXs = { 3.5, 14.5 };
        public const double BridgeHalfWidth = 1;

        public static TowerSpot[] TowerSpots(Side side)
        {
            Func<double, double> mirror = y => side == Side.Player ? ArenaHeight - y : y;
            return new[]
            {
                new TowerSpot(TowerKind.Princess, BridgeXs[0], mirror(6.5)),
                new TowerSpot(TowerKind.Princess, BridgeXs[1], mirror(6.5)),
                new TowerSpot(TowerKind.King, ArenaWidth / 2, mirror(2.5)),
            };
        }

        public static Side Opposite(Side side)
        {
            return side == Side.Player ? Side.Enemy : Side.Player;
        }

        public static bool InArena(double x, double y)
        {
            return x >= 0 && x <= ArenaWidth && y >= 0 && y <= ArenaHeight;
        }

        public static bool InRiver(double y)
        {
            return Math.Abs(y - RiverY) < RiverHalfWidth;
        }

        public static bool CanDeployTroopAt(Side side, double x, double y, OpenLanes open)
        {
            if (!InArena(x, y) || InRiver(y))
            {
                return false;
            }

            bool ownHalf = side == Side.Player ? y > RiverY : y < RiverY;
            if (ownHalf)
            {
                return true;
            }

            // Enemy half is deployable only on a lane whose princess tower fell.
            bool leftLane = x < ArenaWidth / 2;
            return leftLane ? open.Left : open.Right;
        }

        public static bool CanDeployTroopAt(Side side, double x, double y)
        {
            return CanDeployTroopAt(side, x, y, new OpenLanes(false, false));
        }

        public static double NearestBridgeX(double x)
        {
            return Math.Abs(x - BridgeXs[0]) <= Math.Abs(x - BridgeXs[1])
                ? BridgeXs[0]
                : BridgeXs[1];
        }

        public static bool OnBridge(double x)
        {
            foreach (double bx in BridgeXs)
            {
                if (Math.Abs(x - bx) <= BridgeHalfWidth)
                {
                    return true;
                }
            }

            return false;
        }
    }
}
