/** Friend lobby: create or join a LAN room, then hand off to the online match. */
import type { AppCtx, LobbyOpts } from "../../app/ctx";
import type { CardId } from "../../game/cards";
import { RoomClient, type NetSocket } from "../../net/roomClient";
import { resolveRelayUrl } from "../../net/relayUrl";
import { netGameMode, onlineSession, startOnlineMatch } from "../../match/online";

/** The relay for this page: ?relay=, the build's VITE_RELAY_URL, or the LAN relay. */
function relayTarget() {
  let store: Storage | undefined;
  try {
    store = localStorage;
  } catch {
    /* storage blocked */
  }
  return resolveRelayUrl(location, { VITE_RELAY_URL: import.meta.env.VITE_RELAY_URL }, store);
}

function connectRoom(): RoomClient | null {
  const url = relayTarget().url;
  if (!url) return null;
  return new RoomClient(new WebSocket(url) as unknown as NetSocket);
}

export function openFriendLobby(ctx: AppCtx, deck: CardId[], opts: LobbyOpts = {}): void {
  const { pickerRoot, meta, tr } = ctx;
  pickerRoot.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = tr("Play a Friend", "العب مع صديق");
  pickerRoot.appendChild(title);

  const hint = document.createElement("p");
  hint.className = "lobby-hint";
  const lan = relayTarget().lan;
  hint.innerHTML = lan
    ? tr(
        `Mode: <b>${netGameMode(meta.gameMode).name}</b><br/>You both need to be on the same Wi-Fi.`,
        `النمط: <b>${netGameMode(meta.gameMode).nameAr}</b><br/>يجب أن تكونا على شبكة الواي فاي نفسها.`,
      )
    : tr(
        `Mode: <b>${netGameMode(meta.gameMode).name}</b><br/>Play a friend anywhere online.`,
        `النمط: <b>${netGameMode(meta.gameMode).nameAr}</b><br/>العب مع صديق من أي مكان عبر الإنترنت.`,
      );
  pickerRoot.appendChild(hint);

  const status = document.createElement("div");
  status.className = "lobby-status";
  pickerRoot.appendChild(status);

  const createBtn = document.createElement("button");
  createBtn.className = "battle-btn";
  createBtn.textContent = tr("Create a game", "أنشئ مباراة");
  pickerRoot.appendChild(createBtn);

  const joinRow = document.createElement("div");
  joinRow.className = "join-row";
  const codeInput = document.createElement("input");
  codeInput.className = "code-input";
  codeInput.placeholder = tr("CODE", "الرمز");
  codeInput.maxLength = 5;
  codeInput.autocapitalize = "characters";
  const joinBtn = document.createElement("button");
  joinBtn.className = "battle-btn join";
  joinBtn.textContent = tr("Join", "انضم");
  joinRow.append(codeInput, joinBtn);
  pickerRoot.appendChild(joinRow);

  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = tr("← Back", "→ رجوع");
  pickerRoot.appendChild(backBtn);

  let client: RoomClient | null = null;
  const wire = (c: RoomClient): void => {
    client = c;
    c.onCreated = (code) => {
      status.innerHTML =
        `Your code: <b class="big-code">${code}</b><br/>Tell your friend, then wait…`;
    };
    c.onStart = (p) => {
      ctx.closeDeckPicker();
      startOnlineMatch(ctx, c, p.role, p.hostDeck, p.guestDeck, p.mode);
    };
    c.onError = (reason) => {
      createBtn.disabled = false;
      status.textContent =
        reason === "no-such-room"
          ? "No game with that code."
          : reason === "room-full"
            ? "That game is already full."
            : "Couldn't join that game.";
    };
    c.onPeerLeft = () => {
      status.textContent = tr("Your friend left the game.", "غادر صديقك المباراة.");
    };
    c.onClose = () => {
      if (!onlineSession()) status.textContent = tr("Couldn't reach the game server.", "تعذّر الوصول إلى خادم اللعبة.");
    };
  };

  createBtn.addEventListener("click", () => {
    if (client) return;
    status.textContent = tr("Connecting…", "جارٍ الاتصال…");
    const c = connectRoom();
    if (!c) {
      status.textContent = tr("Online play isn't set up for this page.", "اللعب عبر الإنترنت غير مفعّل لهذه الصفحة.");
      return;
    }
    createBtn.disabled = true;
    wire(c);
    const netMode = netGameMode(meta.gameMode);
    const hostDeck = netMode.mirror ? ctx.botDeck() : deck;
    c.create(hostDeck, { elixirRate: netMode.elixirRate, mirror: netMode.mirror });
  });
  joinBtn.addEventListener("click", () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) {
      status.textContent = tr("Type your friend's code first.", "اكتب رمز صديقك أولًا.");
      return;
    }
    const c = connectRoom();
    if (!c) {
      status.textContent = tr("Online play isn't set up for this page.", "اللعب عبر الإنترنت غير مفعّل لهذه الصفحة.");
      return;
    }
    status.textContent = tr("Connecting…", "جارٍ الاتصال…");
    wire(c);
    c.join(code, deck);
  });
  backBtn.addEventListener("click", () => {
    client?.leave();
    ctx.openDeckPicker({ mode: "battle" });
  });
  if (opts.code) codeInput.value = opts.code;
  ctx.showPicker("lobby");
}
