/**
 * Online 1v1 (LAN lockstep): starting/ending a networked match and the
 * per-frame lockstep stepping. Both peers run the identical sim and only
 * exchange deploy frames plus a periodic drift checksum.
 */
import { createBattle, deployCard, type BattleState } from "../game/battle";
import type { Side } from "../game/arena";
import { setCardOverrides, type CardId } from "../game/cards";
import { tick } from "../game/sim";
import { stateChecksum } from "../net/checksum";
import { Lockstep } from "../net/lockstep";
import { sideForRole, type MatchMode, type Role } from "../net/protocol";
import type { RoomClient } from "../net/roomClient";
import type { AppCtx } from "../app/ctx";
import { emit } from "../app/hooks";
import { showBanner, startCountdown } from "../ui/banner";
import { GAME_MODES, type GameMode } from "./modes";

const INPUT_DELAY = 4; // ticks of input latency hidden (~133ms at 30Hz)
const SYNC_EVERY = 30; // exchange a drift checksum once a second
const SIM_DT = 1 / 30;

export interface OnlineSession {
  client: RoomClient;
  ls: Lockstep;
  side: Side;
  tick: number;
  sums: Map<number, number>; // my checksum per sync tick, for drift detection
  battle: BattleState;
}

let online: OnlineSession | null = null;
let acc = 0;

/** The live networked match, or null while playing solo. */
export const onlineSession = (): OnlineSession | null => online;

/** Forget the session without leaving the room (a solo match is starting). */
export function clearOnline(): void {
  online = null;
}

/** Sandbox is a solo practice space; friend matches fall back to Classic. */
export function netGameMode(gameMode: GameMode): GameMode {
  return gameMode.id === "sandbox" ? GAME_MODES[0] : gameMode;
}

/** Begin a networked match once the relay pairs both players. */
export function startOnlineMatch(
  ctx: AppCtx,
  client: RoomClient,
  role: Role,
  hostDeck: CardId[],
  guestDeck: CardId[],
  matchMode: MatchMode,
): void {
  const { hud, scene, sound: audio } = ctx;
  const side = sideForRole(role);
  ctx.hideSandboxReset();
  // Identical canonical battle on both peers: host=player, guest=enemy.
  // No card levels online — a fair, fully-deterministic match. Mirror mode
  // has both sides battle the host's deck. Never crazy (it uses Math.random,
  // which would desync the lockstep).
  setCardOverrides(null);
  const enemyDeck = matchMode.mirror ? hostDeck : guestDeck;
  const battle = createBattle(hostDeck, enemyDeck, {}, matchMode.elixirRate);
  const session: OnlineSession = {
    client,
    ls: new Lockstep(side, INPUT_DELAY),
    side,
    tick: 0,
    sums: new Map(),
    battle,
  };
  online = session;
  acc = 0;
  ctx.setBattle(battle);
  ctx.selectCard(null);
  hud.setReward(null);
  hud.setOpponentName("Friend");
  scene.setArenaLook(ctx.battleArenaId());
  scene.setViewpoint(side);
  scene.reset();
  audio.setIntensity(0);
  audio.restartMusic();

  // In-match networking: if the peer drops, the lockstep would stall forever,
  // so end gracefully; compare drift checksums to catch desync early.
  client.onFrame = (frame) => session.ls.receive(frame);
  client.onPeerLeft = () => endOnlineMatch(ctx, "Your friend left the game.");
  client.onClose = () => endOnlineMatch(ctx, "Lost connection to your friend.");
  client.onSync = (tick, checksum) => {
    const mine = session.sums.get(tick);
    if (mine !== undefined && mine !== checksum) {
      showBanner("Connection out of sync");
    }
  };

  // Opening frames unblock the first ticks before any deploy can be scheduled.
  for (const f of session.ls.bootstrap()) client.sendFrame(f);
  startCountdown();
  emit("matchStart", { kind: "ladder", battle, mySide: side, online: true, replay: false });
}

/** Tear down a networked match and return to the menu with a message. */
export function endOnlineMatch(ctx: AppCtx, message: string): void {
  if (!online) return;
  online.client.leave();
  online = null;
  showBanner(message);
  ctx.scene.setArenaLook(ctx.battleArenaId());
  ctx.scene.setViewpoint("player");
  ctx.hud.setOpponentName("Bot");
  setTimeout(ctx.openHome, 1800);
}

/**
 * Advance the lockstep by wall-clock dt. Returns the interpolation alpha:
 * the leftover fraction of a tick, or 1 while stalled on the peer.
 */
export function stepOnline(dt: number): number {
  const s = online;
  if (!s) return 1;
  const battle = s.battle;
  acc += dt;
  while (acc >= SIM_DT) {
    // Lockstep: advance only when the peer's frame for this tick is in hand.
    if (!s.ls.ready()) break;
    const { commands, outgoing } = s.ls.step();
    for (const c of commands) deployCard(battle, c.side, c.cardId, c.x, c.y);
    tick(battle, SIM_DT);
    s.client.sendFrame(outgoing);
    s.tick++;
    if (s.tick % SYNC_EVERY === 0) {
      const cs = stateChecksum(battle);
      s.sums.set(s.tick, cs);
      if (s.sums.size > 10) s.sums.delete([...s.sums.keys()][0]);
      s.client.sendSync(s.tick, cs);
    }
    acc -= SIM_DT;
  }
  // While stalled on the peer, don't bank a backlog that bursts on resume.
  acc = Math.min(acc, SIM_DT * 3);
  return s.ls.ready() ? Math.min(1, Math.max(0, acc / SIM_DT)) : 1;
}
