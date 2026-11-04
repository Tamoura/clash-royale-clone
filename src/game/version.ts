/**
 * Version of the simulation's rules: what a match computes from its decks,
 * seeds and inputs. Bump it whenever sim output changes on purpose (the
 * golden fixture in golden.test.ts records it and must be re-captured), and
 * bump PROTOCOL_VERSION (net/protocol.ts) with it, so pages running
 * different sims never meet online, plus the replay tape version in main.ts.
 *
 * v3: death blasts settle to a fixed point, spawned units take the
 * spawner's level, the rebalance, one-minute triple-elixir overtime,
 * princess towers at 100, and the Stone Golem, Digger and Comet.
 */
export const SIM_VERSION = 3;
