export const ELIXIR_MAX = 10;
export const ELIXIR_START = 5;
export const SECONDS_PER_ELIXIR = 2.8;

export interface ElixirState {
  readonly amount: number;
}

export function createElixir(): ElixirState {
  return { amount: ELIXIR_START };
}

export function tickElixir(
  state: ElixirState,
  dt: number,
  multiplier: number,
): ElixirState {
  const rate = multiplier / SECONDS_PER_ELIXIR;
  return { amount: Math.min(ELIXIR_MAX, state.amount + dt * rate) };
}

export function trySpend(state: ElixirState, cost: number): ElixirState | null {
  if (state.amount < cost) return null;
  return { amount: state.amount - cost };
}
