/**
 * Online lobby: Quick match against anyone, or Play a friend with a short
 * code or an invite link. Shows who you are (name, crest, tower troop and
 * ability), the mode, and a four-step status for every attempt — with a
 * Cancel at each step and every relay error in plain words.
 */
import "../styles/online.css";
import type { AppCtx, LobbyOpts } from "../../app/ctx";
import { on } from "../../app/hooks";
import { ABILITIES } from "../../game/abilities";
import type { CardId } from "../../game/cards";
import { TOWER_TROOPS } from "../../game/towers";
import type { FailReason, MatchInfo, OnlineSession } from "../../net/session";
import {
  ONLINE_MODE_IDS,
  beginOnlineMatch,
  cleanCode,
  inviteLink,
  leaveOnline,
  newOnlineSession,
  onOnlineChange,
  onlineDeck,
  onlineMode,
  relayTarget,
  type OnlineModeId,
} from "../../match/online";
import { cardDisplayName } from "../../render/cardNames";
import { ARABIC } from "../../render3d/theme";
import { button, screenHeader, segmented, toast } from "../components";
import { fmtNum, fmtTime, tr } from "../i18n";
import { icon, type CrestIndex } from "../icons";
import { getPrefs, reducedMotion } from "../prefs";

const TAB_KEY = "cr-clone-lobby-tab";
/** Quick-match searches longer than this offer the bot instead. */
const OFFER_BOT_AFTER_S = 30;
/** How long "Opponent found" shows before the match takes over. */
const FOUND_MS = 1100;

type Tab = "quick" | "friend";
type Flow = "quick" | "create" | "join";
/** The four steps every attempt walks through. */
type Step = 0 | 1 | 2 | 3;

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === "friend" ? "friend" : "quick";
  } catch {
    return "quick";
  }
}

function saveTab(t: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // per-viewer convenience only
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Every relay refusal, in words a kid understands. */
export function failText(reason: FailReason, flow: Flow): string {
  switch (reason) {
    case "no-such-room":
      return tr("No game with that code. Check it and try again.", "لا توجد مباراة بهذا الرمز. تحقّق منه وحاول مجددًا.");
    case "room-full":
      return tr("That game already has two players.", "هذه المباراة فيها لاعبان بالفعل.");
    case "expired":
      return flow === "quick"
        ? tr("Nobody turned up this time.", "لم يحضر أحد هذه المرة.")
        : tr("That game timed out. Make a new one.", "انتهت مهلة هذه المباراة. أنشئ واحدة جديدة.");
    case "rate-limited":
      return tr("Too many tries. Wait a few seconds.", "محاولات كثيرة. انتظر بضع ثوانٍ.");
    case "server-restart":
      return tr("The game server is restarting. Try again in a minute.", "خادم اللعبة يُعاد تشغيله. حاول بعد دقيقة.");
    case "update-required":
      return tr("New version — reload", "إصدار جديد — أعد التحميل");
    case "bad-message":
      return tr("The game server didn't understand us. Reload and try again.", "لم يفهمنا خادم اللعبة. أعد التحميل وحاول مجددًا.");
    case "resume-failed":
      return tr("Couldn't rejoin that match.", "تعذّرت العودة إلى تلك المباراة.");
    case "quick-disabled":
      return tr("Quick match is off on this server. Play a friend with a code.", "المباراة السريعة متوقفة على هذا الخادم. العب مع صديق بالرمز.");
    case "unreachable":
      return tr("Couldn't reach the game server.", "تعذّر الوصول إلى خادم اللعبة.");
  }
}

/** Labels for the four status steps (step 2 depends on the flow). */
function stepLabels(flow: Flow): [string, string, string, string] {
  return [
    tr("Connecting", "الاتصال"),
    flow === "quick"
      ? tr("Searching", "البحث")
      : flow === "join"
        ? tr("Joining", "الانضمام")
        : tr("Waiting for friend", "بانتظار صديقك"),
    tr("Opponent found", "وجدنا خصمًا"),
    tr("Syncing", "المزامنة"),
  ];
}

/** Tears down the lobby that is on screen (timers, subscriptions). */
let disposeOpen: (() => void) | null = null;

export function openFriendLobby(ctx: AppCtx, deck: CardId[], opts: LobbyOpts = {}): void {
  const { pickerRoot, meta } = ctx;
  disposeOpen?.();
  leaveOnline();
  const target = relayTarget();
  const configured = target.url !== null;
  const { deck: netDeck, swappedFor } = onlineDeck(deck);

  let tab: Tab = opts.code ? "friend" : opts.quick ? "quick" : readTab();
  let modeId: OnlineModeId = (ONLINE_MODE_IDS as readonly string[]).includes(meta.gameMode.id)
    ? (meta.gameMode.id as OnlineModeId)
    : "classic";
  let session: OnlineSession | null = null;
  let flow: Flow = "quick";
  let startedAt = 0;
  let found: MatchInfo | null = null;
  let foundTimer = 0;
  let disposed = false;

  pickerRoot.innerHTML = "";
  const root = el("div", "lobby-v2");
  if (ARABIC) root.dir = "rtl";
  pickerRoot.appendChild(root);

  root.appendChild(screenHeader({ title: tr("Play online", "العب عبر الإنترنت"), onBack: () => ctx.openHome(), backLabel: tr("Back", "رجوع") }));

  // ---- Who I am
  const me = el("section", "lobby-me");
  const prefs = getPrefs();
  const crest = el("div", "lobby-me__crest");
  crest.innerHTML = icon(`crest-${(prefs.crest % 12) as CrestIndex}`);
  const meText = el("div", "lobby-me__text");
  meText.appendChild(el("div", "lobby-me__name", prefs.playerName || tr("You", "أنت")));
  const tower = TOWER_TROOPS[meta.towerTroop];
  const ability = ABILITIES[meta.abilityChoice];
  const loadoutLine = el("div", "lobby-me__loadout");
  loadoutLine.innerHTML = `${icon("shield")}<span></span>${icon("crown")}<span></span>`;
  const spans = loadoutLine.querySelectorAll("span");
  spans[0].textContent = tr(tower.name, tower.ar);
  spans[1].textContent = tr(ability.name, ability.ar);
  meText.appendChild(loadoutLine);
  me.append(crest, meText);
  root.appendChild(me);

  // ---- Not set up on this site
  if (!configured) {
    const off = el("div", "lobby-note lobby-note--off");
    off.innerHTML = icon("lock");
    off.appendChild(
      el(
        "p",
        "",
        tr(
          "Online play is not set up on this site yet. You can still battle the bot.",
          "اللعب عبر الإنترنت غير مُفعّل على هذا الموقع بعد. ما زال بإمكانك مواجهة الروبوت.",
        ),
      ),
    );
    root.appendChild(off);
  }

  // ---- Tabs
  const tabs = segmented<Tab>({
    options: [
      { value: "quick", label: tr("Quick match", "مباراة سريعة"), icon: "bolt" },
      { value: "friend", label: tr("Play a friend", "العب مع صديق"), icon: "handshake" },
    ],
    value: tab,
    ariaLabel: tr("How to find an opponent", "طريقة إيجاد خصم"),
    onChange: (t) => {
      if (session) cancel();
      tab = t;
      saveTab(t);
      render();
    },
  });
  tabs.classList.add("lobby-tabs");
  root.appendChild(tabs);

  // ---- Mode chips
  const modeWrap = el("section", "lobby-modes");
  modeWrap.appendChild(el("h3", "lobby-label", tr("Mode", "النمط")));
  const modeSeg = segmented<OnlineModeId>({
    options: ONLINE_MODE_IDS.map((id) => {
      const g = onlineMode(id).game;
      return {
        value: id,
        label:
          id === "classic"
            ? tr("Normal", "عادي")
            : id === "triple"
              ? tr("Triple", "ثلاثي")
              : id === "mega"
                ? tr("Mega", "هائل")
                : tr("Crazy", "جنون"),
        icon: id === "crazy" ? "dice" : id === "classic" ? undefined : "bolt",
        blurb: tr(g.blurb, g.blurbAr),
      };
    }),
    value: modeId,
    ariaLabel: tr("Mode", "النمط"),
    onChange: (m) => {
      modeId = m;
    },
  });
  modeWrap.appendChild(modeSeg);
  root.appendChild(modeWrap);

  // ---- Panels
  const quickPanel = el("section", "lobby-panel lobby-panel--quick");
  const findBtn = button({
    variant: "cta",
    size: "lg",
    icon: "bolt",
    label: tr("Find a match", "ابحث عن مباراة"),
    onClick: () => startQuick(),
  });
  findBtn.classList.add("lobby-wide");
  quickPanel.append(
    findBtn,
    el("p", "lobby-sub", tr("We'll pair you with someone playing the same mode.", "سنجمعك بلاعب يختار النمط نفسه.")),
  );

  const friendPanel = el("section", "lobby-panel lobby-panel--friend");
  const createBtn = button({
    variant: "cta",
    size: "lg",
    icon: "handshake",
    label: tr("Create a game", "أنشئ مباراة"),
    onClick: () => startCreate(),
  });
  createBtn.classList.add("lobby-wide");
  const orLine = el("div", "lobby-or", tr("or join with a code", "أو انضم برمز"));
  const joinRow = el("form", "lobby-join");
  const codeInput = el("input", "lobby-code-input");
  codeInput.placeholder = tr("CODE", "الرمز");
  codeInput.maxLength = 12;
  codeInput.autocomplete = "off";
  codeInput.spellcheck = false;
  codeInput.autocapitalize = "characters";
  codeInput.inputMode = "text";
  codeInput.enterKeyHint = "go";
  codeInput.dir = "ltr";
  codeInput.setAttribute("aria-label", tr("Friend's game code", "رمز مباراة صديقك"));
  codeInput.addEventListener("input", () => {
    const up = codeInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (up !== codeInput.value) codeInput.value = up;
  });
  const joinBtn = button({ variant: "primary", label: tr("Join", "انضم"), onClick: () => undefined });
  joinBtn.type = "submit";
  joinRow.append(codeInput, joinBtn);
  joinRow.addEventListener("submit", (e) => {
    e.preventDefault();
    startJoin(codeInput.value);
  });
  friendPanel.append(createBtn, orLine, joinRow);

  // The invite card (shown after Create).
  const invite = el("div", "lobby-invite");
  invite.hidden = true;
  invite.appendChild(el("div", "lobby-label", tr("Your game code", "رمز مباراتك")));
  const codeBig = el("div", "lobby-code");
  codeBig.dir = "ltr";
  invite.appendChild(codeBig);
  const inviteRow = el("div", "lobby-invite__row");
  inviteRow.append(
    button({ variant: "secondary", icon: "copy", label: tr("Copy link", "انسخ الرابط"), onClick: () => void copyLink() }),
    button({ variant: "primary", icon: "share", label: tr("Share", "مشاركة"), onClick: () => void shareLink() }),
  );
  invite.appendChild(inviteRow);
  invite.appendChild(el("p", "lobby-sub", tr("Send the link, or read the code to your friend.", "أرسل الرابط أو اقرأ الرمز لصديقك.")));

  // The status card (every attempt).
  const status = el("div", "lobby-status");
  status.hidden = true;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const steps = el("ol", "lobby-steps");
  const stepEls: HTMLLIElement[] = [];
  for (let i = 0; i < 4; i++) {
    const li = el("li", "lobby-step");
    li.innerHTML = `<span class="lobby-step__dot">${icon("check")}</span><span class="lobby-step__label"></span>`;
    stepEls.push(li);
    steps.appendChild(li);
  }
  const statusLine = el("div", "lobby-status__line");
  const statusTime = el("div", "lobby-status__time");
  const foundCard = el("div", "lobby-found");
  foundCard.hidden = true;
  const statusActions = el("div", "lobby-status__actions");
  status.append(steps, foundCard, statusLine, statusTime, statusActions);

  root.append(quickPanel, friendPanel, invite, status);

  // ---- Notes
  const notes = el("section", "lobby-notes");
  const note = (ic: "info" | "wifi" | "star", text: string): void => {
    const n = el("div", "lobby-note");
    n.innerHTML = icon(ic);
    n.appendChild(el("p", "", text));
    notes.appendChild(n);
  };
  note("info", tr("Card levels are equal online, so skill decides.", "مستويات البطاقات متساوية عبر الإنترنت، فالمهارة هي الحَكَم."));
  if (swappedFor) {
    note(
      "star",
      tr(
        `Your Champion is your own design, so it stays home online. ${cardDisplayName(swappedFor)} takes its place.`,
        `بطلك من تصميمك، لذلك يبقى خارج اللعب عبر الإنترنت. تحلّ ${cardDisplayName(swappedFor)} مكانه.`,
      ),
    );
  }
  if (target.lan) {
    note("wifi", tr("You both need to be on the same Wi-Fi.", "يجب أن تكونا على شبكة الواي فاي نفسها."));
  }
  root.appendChild(notes);

  if (!configured) {
    for (const b of [findBtn, createBtn, joinBtn]) b.disabled = true;
    codeInput.disabled = true;
  }

  // ---- Attempts --------------------------------------------------------

  function begin(f: Flow): OnlineSession | null {
    cancel();
    const s = newOnlineSession(ctx);
    if (!s) return null;
    session = s;
    flow = f;
    startedAt = performance.now();
    found = null;
    // Hold the first match on the lobby long enough to show who we met.
    s.onMatch = (m) => {
      if (disposed || session !== s) return;
      found = m;
      render();
      foundTimer = window.setTimeout(
        () => {
          foundTimer = 0;
          if (session !== s) return;
          if (s.view().t === "ended") {
            // They cancelled while we were showing "opponent found".
            leaveOnline();
            session = null;
            found = null;
            showProblem(tr("Your opponent left before the match started.", "غادر خصمك قبل بدء المباراة."));
            return;
          }
          s.onMatch = (next) => beginOnlineMatch(ctx, next);
          beginOnlineMatch(ctx, m);
        },
        reducedMotion() ? FOUND_MS / 2 : FOUND_MS,
      );
    };
    render();
    return s;
  }

  function startQuick(): void {
    const s = begin("quick");
    s?.quick(netDeck, onlineMode(modeId).match);
  }

  function startCreate(): void {
    const s = begin("create");
    s?.create(netDeck, onlineMode(modeId).match);
  }

  function startJoin(raw: string): void {
    const code = cleanCode(raw);
    if (!code) {
      codeInput.focus();
      showProblem(tr("Type your friend's code first.", "اكتب رمز صديقك أولًا."));
      return;
    }
    codeInput.value = code;
    const s = begin("join");
    s?.join(code, netDeck);
  }

  /** Abandon the current attempt (any step). */
  function cancel(): void {
    if (foundTimer) window.clearTimeout(foundTimer);
    foundTimer = 0;
    if (session) leaveOnline();
    session = null;
    found = null;
    render();
  }

  let problem: string | null = null;
  function showProblem(text: string): void {
    problem = text;
    render();
  }

  async function copyLink(): Promise<void> {
    const code = currentCode();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      toast(tr("Link copied", "نُسخ الرابط"), "success");
    } catch {
      toast(tr(`Copy failed — your code is ${code}`, `تعذّر النسخ — رمزك ${code}`), "danger");
    }
  }

  async function shareLink(): Promise<void> {
    const code = currentCode();
    if (!code) return;
    const url = inviteLink(code);
    const text = tr(`Battle me! Code ${code}`, `نازلني! الرمز ${code}`);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: document.title, text, url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return; // the player closed the sheet
      }
    }
    await copyLink();
  }

  function currentCode(): string | null {
    const v = session?.view();
    return v?.t === "waiting" ? v.code : null;
  }

  // ---- Rendering -------------------------------------------------------

  function render(): void {
    if (disposed) return;
    const v = session?.view() ?? null;
    const active = v !== null && v.t !== "failed" && v.t !== "ended" && v.t !== "idle";
    quickPanel.hidden = tab !== "quick" || active;
    friendPanel.hidden = tab !== "friend" || active;
    modeWrap.hidden = active;
    tabs.classList.toggle("is-locked", active);
    tabs.querySelectorAll("button").forEach((b) => (b.disabled = active));

    const waitingCode = v?.t === "waiting" ? v.code : null;
    invite.hidden = !waitingCode;
    if (waitingCode && codeBig.textContent !== waitingCode) codeBig.textContent = waitingCode;

    const failed = v?.t === "failed" ? v.reason : null;
    status.hidden = !active && !failed && !problem;
    if (status.hidden) return;

    // Which step are we on?
    let step: Step = 0;
    if (found) step = foundTimer ? 2 : 3;
    else if (v?.t === "waiting" || v?.t === "queued") step = 1;
    // A join has no "waiting" reply: the first pong says the socket is up,
    // and any refusal other than "unreachable" came from the relay itself.
    else if (flow === "join" && (session?.rtt != null || (failed && failed !== "unreachable"))) step = 1;
    else if (failed && failed !== "unreachable") step = 1;
    const labels = stepLabels(flow);
    stepEls.forEach((li, i) => {
      li.querySelector(".lobby-step__label")!.textContent = labels[i];
      li.dataset.state = failed || problem ? (i < step ? "done" : i === step ? "error" : "todo") : i < step ? "done" : i === step ? "now" : "todo";
    });
    status.dataset.tone = failed || problem ? "error" : "busy";
    status.classList.toggle("is-still", reducedMotion());

    // Opponent card.
    foundCard.hidden = !found;
    if (found) {
      const opp = found.opponent;
      foundCard.innerHTML = `<span class="lobby-found__crest">${icon(`crest-${((opp?.crest ?? 0) % 12) as CrestIndex}`)}</span><span class="lobby-found__name"></span>`;
      foundCard.querySelector(".lobby-found__name")!.textContent = opp?.name || tr("Friend", "صديق");
    }

    // Status line.
    let line = "";
    if (failed) line = failText(failed, flow);
    else if (problem) line = problem;
    else if (found) line = foundTimer ? tr("Get ready!", "استعد!") : tr("Setting up the arena…", "نجهّز الساحة…");
    else if (v?.t === "connecting") line = tr("Connecting…", "جارٍ الاتصال…");
    else if (v?.t === "queued")
      line = tr(`Searching… position ${v.position}`, `جارٍ البحث… الترتيب ${fmtNum(v.position)}`);
    else if (v?.t === "waiting") line = tr("Waiting for your friend to join…", "بانتظار انضمام صديقك…");
    if (statusLine.textContent !== line) statusLine.textContent = line;
    tickTime();

    // Actions: cancel while busy; retry/reload when it failed.
    const key = `${failed ?? ""}|${problem ?? ""}|${active}|${found ? 1 : 0}|${botOffered()}`;
    if (statusActions.dataset.key !== key) {
      statusActions.dataset.key = key;
      const btns: HTMLButtonElement[] = [];
      if (failed === "update-required") {
        btns.push(button({ variant: "cta", label: tr("Reload", "أعد التحميل"), onClick: () => location.reload() }));
      } else if (failed || problem) {
        btns.push(
          button({
            variant: "secondary",
            label: tr("OK", "حسنًا"),
            onClick: () => {
              problem = null;
              if (session) leaveOnline();
              session = null;
              render();
            },
          }),
        );
        if (failed && flow !== "join") {
          btns.push(button({ variant: "cta", label: tr("Try again", "حاول مجددًا"), onClick: () => (flow === "quick" ? startQuick() : startCreate()) }));
        }
        if (failed && flow === "quick") btns.push(botButton());
      } else if (active && !found) {
        if (botOffered()) btns.push(botButton());
        btns.push(button({ variant: "secondary", label: tr("Cancel", "إلغاء"), onClick: () => cancel() }));
      } else if (found) {
        btns.push(button({ variant: "ghost", label: tr("Cancel", "إلغاء"), onClick: () => cancel() }));
      }
      statusActions.replaceChildren(...btns);
    }
  }

  function botOffered(): boolean {
    return flow === "quick" && session?.view().t === "queued" && (performance.now() - startedAt) / 1000 >= OFFER_BOT_AFTER_S;
  }

  function botButton(): HTMLButtonElement {
    return button({
      variant: "cta",
      icon: "sword",
      label: tr("Play the bot instead", "العب مع الروبوت بدلًا من ذلك"),
      onClick: () => {
        cancel();
        ctx.closeDeckPicker();
        ctx.startLadder();
      },
    });
  }

  function tickTime(): void {
    const v = session?.view();
    const searching = !found && (v?.t === "queued" || v?.t === "waiting" || v?.t === "connecting");
    const text = searching ? fmtTime((performance.now() - startedAt) / 1000) : "";
    if (statusTime.textContent !== text) statusTime.textContent = text;
    statusTime.hidden = !text;
  }

  // Live updates: session changes, plus a 1 s clock for the elapsed time.
  const unChange = onOnlineChange(() => render());
  const clock = window.setInterval(() => {
    if (botOffered() && statusActions.dataset.key?.endsWith("false")) render();
    else tickTime();
  }, 1000);
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (disposeOpen === dispose) disposeOpen = null;
    if (foundTimer) window.clearTimeout(foundTimer);
    // A match that started keeps its session; an unfinished attempt is left.
    if (session && !session.inMatch) leaveOnline();
    unChange();
    unScreen();
    window.clearInterval(clock);
  };
  disposeOpen = dispose;
  const unScreen = on("screen", (e) => {
    if (e.id !== "lobby") dispose();
  });

  render();
  ctx.showPicker("lobby");

  // An invite link (or a prefilled code) joins straight away.
  if (opts.code && configured) {
    codeInput.value = opts.code;
    startJoin(opts.code);
  } else if (opts.quick && configured) {
    startQuick();
  }
}
