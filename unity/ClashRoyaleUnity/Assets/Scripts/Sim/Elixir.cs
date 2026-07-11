using System;

namespace ClashRoyale.Sim
{
    /// <summary>Immutable elixir amount, ported from <c>src/game/elixir.ts</c>.</summary>
    public readonly struct ElixirState
    {
        public readonly double Amount;

        public ElixirState(double amount)
        {
            Amount = amount;
        }
    }

    public static class Elixir
    {
        public const double ElixirMax = 10;
        public const double ElixirStart = 5;
        public const double SecondsPerElixir = 2.8;

        public static ElixirState Create()
        {
            return new ElixirState(ElixirStart);
        }

        public static ElixirState Tick(ElixirState state, double dt, double multiplier)
        {
            double rate = multiplier / SecondsPerElixir;
            return new ElixirState(Math.Min(ElixirMax, state.Amount + dt * rate));
        }

        /// <summary>Returns the post-spend state, or null when unaffordable.</summary>
        public static ElixirState? TrySpend(ElixirState state, double cost)
        {
            if (state.Amount < cost)
            {
                return null;
            }

            return new ElixirState(state.Amount - cost);
        }
    }
}
