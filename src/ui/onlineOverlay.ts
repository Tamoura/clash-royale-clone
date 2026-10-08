/**
 * The online match overlay: a DOM layer at --z-modal over the battle that
 * explains every network hiccup in plain words — waiting on the opponent,
 * the opponent reconnecting, our own reconnect, a paused friend, a pending
 * rematch, and matches that end without a winner — plus a small RTT pip
 * under the top bar. It reads OnlineSession.view() once per frame and only
 * touches the DOM when what it shows changes.
 */
import "./styles/online.css";
import { on } from "../app/hooks";
import type { OnlineSession, SessionView } from "../net/session";
import { RESUME_BACKOFF_MS } from "../net/session";
import { button } from "./components";
import { fmtNum, fmtTime, tr } from "./i18n";
import { icon, type IconName } from "./icons";
import { reducedMotion } from "./prefs";

/** A stall shorter than this is ordinary jitter and shows nothing. */
export const STALL_SHOW_MS = 400;
/** Waits longer than this offer a way out. */
const OFFER_LEAVE_MS = 10_000;

export interface OverlayActions {
  onHome(): void;
  onLobby(): void;
  onLeave(): void;
  /** The opponent left mid-match (the result screen shows our win). */
  onOpponentLeft(): void;
}

type Action = "home" | "lobby" | "leave" | "cancel";

interface Card {
  /** Stable identity: the DOM is rebuilt only when this changes. */
  key: string;
  icon: IconName | "spinner";
  title: string;
  body?: string;
  timer?: string;
  actions: Action[];
  /** Ended states block the arena; waits don't. */
  blocking: boolean;
  tone: "wait" | "end";
}

/** RTT quality bands for the pip. */
export function rttBand(ms: number): "good" | "ok" | "bad" {
  return ms < 120 ? "good" : ms < 250 ? "ok" : "bad";
}

/** What the overlay card shows for a session view (null: no card). */
export function overlayCard(v: SessionView, prev: SessionView["t"] | null): Card | null {
  switch (v.t) {
    case "stalled": {
      if (v.ms < STALL_SHOW_MS) return null;
      return {
        key: `stalled${v.ms >= OFFER_LEAVE_MS ? "+" : ""}`,
        icon: "spinner",
        title: tr("Waiting for opponent…", "بانتظار الخصم…"),
        timer: fmtTime(v.ms / 1000),
        actions: v.ms >= OFFER_LEAVE_MS ? ["leave"] : [],
        blocking: false,
        tone: "wait",
      };
    }
    case "peerDropped":
      return {
        key: "dropped",
        icon: "spinner",
        title: tr("Opponent reconnecting…", "الخصم يعيد الاتصال…"),
        timer: tr(`${v.graceLeft}s`, `${fmtNum(v.graceLeft)} ث`),
        actions: ["leave"],
        blocking: false,
        tone: "wait",
      };
    case "peerPaused":
      return {
        key: "paused",
        icon: "pause",
        title: tr("Opponent paused", "خصمك أوقف اللعبة مؤقتًا"),
        body: tr("They left the game for a moment.", "خرج من اللعبة للحظة."),
        actions: ["leave"],
        blocking: false,
        tone: "wait",
      };
    case "reconnecting":
      return {
        key: `reconnecting${v.attempt}`,
        icon: "spinner",
        title: tr("Reconnecting…", "جارٍ إعادة الاتصال…"),
        body: tr(
          `Attempt ${v.attempt} of ${RESUME_BACKOFF_MS.length}`,
          `المحاولة ${fmtNum(v.attempt)} من ${fmtNum(RESUME_BACKOFF_MS.length)}`,
        ),
        actions: ["leave"],
        blocking: false,
        tone: "wait",
      };
    case "rematchWait":
      return {
        key: "rematch",
        icon: "spinner",
        title: tr("Waiting for rematch…", "بانتظار مباراة الإعادة…"),
        body: tr("Your opponent needs to tap Rematch too.", "يجب أن يضغط خصمك «إعادة» أيضًا."),
        actions: ["cancel"],
        blocking: true,
        tone: "wait",
      };
    case "ended":
      switch (v.reason) {
        case "desync":
          return {
            key: "desync",
            icon: "flag",
            title: tr("No contest — out of sync", "لا نتيجة — فقدنا التزامن"),
            body: tr(
              "Your two games stopped matching, so this one doesn't count.",
              "لم تعد اللعبتان متطابقتين، لذلك لا تُحتسب هذه المباراة.",
            ),
            actions: ["home", "lobby"],
            blocking: true,
            tone: "end",
          };
        case "no-contest":
          return {
            key: "no-contest",
            icon: "flag",
            title: tr("No contest — connection stalled", "لا نتيجة — توقف الاتصال"),
            body: tr(
              "Neither side could tell who dropped, so this one doesn't count.",
              "لم يتمكن أي طرف من معرفة من انقطع، لذلك لا تُحتسب هذه المباراة.",
            ),
            actions: ["home", "lobby"],
            blocking: true,
            tone: "end",
          };
        case "connection-lost":
          return {
            key: "lost",
            icon: "wifi",
            title: tr("Connection lost", "انقطع الاتصال"),
            body: tr("We couldn't get back into the match.", "لم نتمكن من العودة إلى المباراة."),
            actions: ["home", "lobby"],
            blocking: true,
            tone: "end",
          };
        case "server-restart":
          return {
            key: "restart",
            icon: "wrench",
            title: tr("The game server restarted", "أُعيد تشغيل خادم اللعبة"),
            body: tr("This match was stopped. Start a new one in a moment.", "توقفت هذه المباراة. ابدأ واحدة جديدة بعد قليل."),
            actions: ["home", "lobby"],
            blocking: true,
            tone: "end",
          };
        case "expired":
          return {
            key: "expired",
            icon: "info",
            title: tr("This match expired", "انتهت مهلة هذه المباراة"),
            actions: ["home", "lobby"],
            blocking: true,
            tone: "end",
          };
        case "opponent-left":
          // Mid-match the result screen shows the win; while waiting for a
          // rematch there is no result to fall back on, so say it here.
          if (prev !== "rematchWait") return null;
          return {
            key: "left-rematch",
            icon: "handshake",
            title: tr("Your opponent left", "غادر خصمك"),
            body: tr("No rematch this time.", "لا مباراة إعادة هذه المرة."),
            actions: ["home", "lobby"],
            blocking: true,
            tone: "end",
          };
        default:
          return null;
      }
    default:
      return null;
  }
}

function actionLabel(a: Action): string {
  switch (a) {
    case "home":
      return tr("Home", "الرئيسية");
    case "lobby":
      return tr("New match", "مباراة جديدة");
    case "leave":
      return tr("Leave match", "مغادرة المباراة");
    case "cancel":
      return tr("Cancel", "إلغاء");
  }
}

/** The views in which the RTT pip shows (a match is on screen). */
const PIP_VIEWS = new Set<SessionView["t"]>(["playing", "stalled", "peerDropped", "peerPaused", "reconnecting"]);

export class OnlineOverlay {
  private readonly root: HTMLElement;
  private readonly pip: HTMLElement;
  private readonly pipText: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardIcon: HTMLElement;
  private readonly cardTitle: HTMLElement;
  private readonly cardBody: HTMLElement;
  private readonly cardTimer: HTMLElement;
  private readonly cardActions: HTMLElement;
  private session: OnlineSession | null = null;
  private unsub: (() => void) | null = null;
  private cardKey = "";
  private pipKey = "";
  private lastView: SessionView["t"] | null = null;
  private prevView: SessionView["t"] | null = null;
  private topbarH = 0;
  private topbarCheckedAt = 0;

  constructor(private readonly actions: OverlayActions) {
    const root = document.createElement("div");
    root.className = "online-overlay";
    root.hidden = true;
    root.innerHTML =
      `<div class="oo-pip" hidden><i class="oo-pip__dot"></i><span class="oo-pip__text"></span></div>` +
      `<div class="oo-scrim" hidden></div>` +
      `<div class="oo-card" role="status" aria-live="polite" hidden>` +
      `<div class="oo-card__icon"></div><div class="oo-card__title"></div>` +
      `<div class="oo-card__body"></div><div class="oo-card__timer"></div>` +
      `<div class="oo-card__actions"></div></div>`;
    const q = (sel: string): HTMLElement => root.querySelector<HTMLElement>(sel)!;
    this.root = root;
    this.pip = q(".oo-pip");
    this.pipText = q(".oo-pip__text");
    this.scrim = q(".oo-scrim");
    this.card = q(".oo-card");
    this.cardIcon = q(".oo-card__icon");
    this.cardTitle = q(".oo-card__title");
    this.cardBody = q(".oo-card__body");
    this.cardTimer = q(".oo-card__timer");
    this.cardActions = q(".oo-card__actions");
  }

  /** Follow a session until detach(). */
  attach(s: OnlineSession): void {
    this.detach();
    this.session = s;
    if (!this.root.isConnected) document.body.appendChild(this.root);
    this.root.hidden = false;
    this.unsub = on("frame", () => this.render());
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
    this.session = null;
    this.cardKey = "";
    this.pipKey = "";
    this.lastView = null;
    this.prevView = null;
    this.root.hidden = true;
    this.card.hidden = true;
    this.scrim.hidden = true;
    this.pip.hidden = true;
  }

  private render(): void {
    const s = this.session;
    if (!s) return;
    // Nothing to show until the match is on screen (the lobby has its own status).
    if (!s.inMatch || document.getElementById("deckpicker")?.classList.contains("show")) {
      this.showCard(null);
      this.showPip(null);
      return;
    }
    const v = s.view();
    if (v.t !== this.lastView) {
      this.prevView = this.lastView;
      this.lastView = v.t;
      if (v.t === "ended" && v.reason === "opponent-left" && this.prevView !== "rematchWait") {
        this.actions.onOpponentLeft();
      }
    }
    this.showCard(overlayCard(v, this.prevView));
    this.showPip(PIP_VIEWS.has(v.t) ? (v.t === "reconnecting" ? -1 : s.rtt) : null);
  }

  private showCard(c: Card | null): void {
    if (!c) {
      if (this.cardKey !== "") {
        this.cardKey = "";
        this.card.hidden = true;
        this.scrim.hidden = true;
      }
      return;
    }
    if (c.key !== this.cardKey) {
      this.cardKey = c.key;
      this.card.hidden = false;
      this.card.dataset.tone = c.tone;
      this.card.classList.toggle("is-still", reducedMotion());
      this.scrim.hidden = !c.blocking;
      this.card.setAttribute("role", c.blocking ? "alertdialog" : "status");
      this.cardIcon.innerHTML = c.icon === "spinner" ? '<span class="oo-spinner"></span>' : icon(c.icon);
      this.cardTitle.textContent = c.title;
      this.cardBody.textContent = c.body ?? "";
      this.cardBody.hidden = !c.body;
      this.cardActions.replaceChildren(
        ...c.actions.map((a, i) =>
          button({
            variant: c.actions.length > 1 && i === c.actions.length - 1 ? "cta" : a === "leave" ? "ghost" : "secondary",
            label: actionLabel(a),
            onClick: () => this.run(a),
          }),
        ),
      );
      this.cardActions.hidden = c.actions.length === 0;
    }
    const timer = c.timer ?? "";
    if (this.cardTimer.textContent !== timer) this.cardTimer.textContent = timer;
    this.cardTimer.hidden = !timer;
  }

  /** rtt: ms, -1 for "no link", null to hide. */
  private showPip(rtt: number | null): void {
    const key = rtt === null ? "" : rtt < 0 ? "x" : String(Math.round(rtt / 5) * 5);
    if (key === this.pipKey) return;
    this.pipKey = key;
    this.pip.hidden = rtt === null;
    if (rtt === null) return;
    // Sit just under the top bar (its height varies with safe areas).
    const now = performance.now();
    if (now - this.topbarCheckedAt > 1000) {
      this.topbarCheckedAt = now;
      this.topbarH = document.getElementById("topbar")?.getBoundingClientRect().bottom ?? 0;
      this.root.style.setProperty("--oo-top", `${Math.round(this.topbarH)}px`);
    }
    const band = rtt < 0 ? "bad" : rttBand(rtt);
    this.pip.dataset.q = band;
    const ms = Math.round(rtt);
    this.pipText.textContent = rtt < 0 ? "—" : tr(`${ms} ms`, `${fmtNum(ms)} م.ث`);
    this.pip.setAttribute(
      "aria-label",
      rtt < 0
        ? tr("Connection lost", "انقطع الاتصال")
        : tr(`Connection: ${ms} milliseconds`, `الاتصال: ${fmtNum(ms)} ملّي ثانية`),
    );
  }

  private run(a: Action): void {
    if (a === "lobby") this.actions.onLobby();
    else if (a === "leave") this.actions.onLeave();
    else this.actions.onHome();
  }
}
