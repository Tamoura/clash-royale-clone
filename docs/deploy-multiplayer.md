# Putting multiplayer online

This guide gets two players on different networks battling each other, for
someone who has never hosted a server. Online play needs a **relay**: a tiny
Node program (`server/relay.ts`) that passes each player's moves to the
other. It can also hand out the game, so **one service at one address** is
the whole setup. Commands are meant to be copied as-is from the repo folder.

Pick one of these paths:

| I want to…                                     | Read                                      | Time   | Cost             |
| ---------------------------------------------- | ----------------------------------------- | ------ | ---------------- |
| **the easiest: one address, nothing to wire**  | [One click on Render](#easiest-one-click-on-render) | 10 min | free |
| play on the same Wi-Fi                         | [LAN play](#b-lan-play-same-wi-fi)        | 1 min  | free             |
| try it over the internet tonight               | [Free 5-minute test](#c-free-5-minute-test-cloudflare-quick-tunnel) | 5 min  | free             |
| have the relay on Fly.io, game on GitHub Pages | [Fly.io](#d-flyio-the-permanent-home)     | 20 min | about $0–2/month |

---

## Easiest: one click on Render

You get one web address, like `https://clash-royale-clone.onrender.com`. It
is the game **and** the online server. There is no relay address to copy
and no settings to change: the page finds the server it came from.

**1. Make a Render account.** Go to <https://render.com>, choose **Get
Started**, then **GitHub**. Signing up with GitHub lets Render rebuild the
game by itself whenever the code changes. Render's free plan has not needed
a credit card so far. If the sign-up asks for one anyway, you can still keep
this service on the Free plan.

**2. Click the button.**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tamoura/clash-royale-clone/tree/claude/game-visuals-character-balance-w122wb)

Or paste this into your browser: `https://render.com/deploy?repo=https://github.com/tamoura/clash-royale-clone/tree/claude/game-visuals-character-balance-w122wb`

Render reads `render.yaml` from that branch and shows one service,
`clash-royale-clone`, on the **Free** plan. Type any Blueprint name and
click **Deploy Blueprint** (or **Apply**).

> If Render cannot find `render.yaml`, the branch on GitHub does not have it
> yet: push this work to `claude/game-visuals-character-balance-w122wb` first.
> By hand: **New → Blueprint** → `tamoura/clash-royale-clone` → that branch.

**3. Wait for the first build** (about 5–10 minutes). When the service says
**Live**, its address is at the top of its page (Render may add a few letters
if the name is taken). `https://<your-address>/healthz` should say
`{"ok":true,...}`, and `https://<your-address>` is the game.

**4. Play.** Both kids open the same address, on any network, and tap the
sliders row under **Battle** → **Play online** → **Play a friend**. One taps
**Create a game** and reads the code aloud (or sends the invite link, which
joins by itself). The other types the code and taps **Join**. If **Play
online** is greyed out, take the Champion out of the deck (bot battles only).

Good to know about the free plan:

* **It sleeps** after 15 minutes with nobody on it. The next visit wakes it:
  Render shows a loading page for about a minute, then the game appears. A
  match in progress keeps it awake.
* **Updates are automatic.** Every push to the branch rebuilds and restarts
  the server (docs-only pushes are skipped), which ends matches in progress.
  To update only when you choose, set `autoDeployTrigger: "off"` in
  `render.yaml`, then use **Manual Deploy → Deploy latest commit**.
* **Limits:** 750 free hours a month (enough to run all month) and a limited
  amount of outbound traffic (5 GB a month when this was written). A first
  visit downloads about 0.5 MB (3 MB more with the optional `?models=kaykit`
  3D models); return visits mostly use the device's cache. With a card on
  file, going over may be billed: check **Billing**.
* **One server.** Rooms live in its memory, and the free plan always runs
  exactly one instance, which is what the relay needs.

**Optional: let the GitHub Pages copy play online too.** `render.yaml`
already allows pages from `https://tamoura.github.io`. Set the repository
variable `RELAY_URL` to `wss://<your-address>/ws` and re-run the Pages
workflow ([section (e)](#e-wiring-github-pages-to-the-relay)). The first
connection to a sleeping server can time out, so try again after a minute.

**Any other Node host or your own computer.** Build once, then start:

```sh
npm ci --include=dev
npm run build:all   # the game (dist/) + the relay bundle (dist-server/)
npm start           # game and relay on $PORT (default 3110): http://localhost:3110
```

It only lets in pages from its own address (add others with `ALLOWED_ORIGINS`).
Behind a host's HTTPS proxy, set `TRUST_PROXY` ([section (h)](#h-configuration-reference)).
The `Dockerfile` builds the same thing for container hosts.

---

## (a) How it works

```
  phone A (browser)                                  phone B (browser)
 +-------------------+                              +-------------------+
 | game page         |      static files (HTTPS)    | game page         |
 | full simulation   | <---------+       +--------> | full simulation   |
 +---------+---------+           |       |          +---------+---------+
           |               +-----+-------+------+             |
           |               | page host: Render, |             |
           |               | or GitHub Pages    |             |
           |               +--------------------+             |
           |                                                  |
           |  wss://relay/ws   moves only, ~30 small          |
           +------------->  frames per second  <--------------+
                       +---------------------+
                       | relay (Node)        |
                       | rooms in memory     |
                       | ONE instance only   |
                       +---------------------+
```

* **Lockstep.** Both phones run the same, fully deterministic battle. The
  relay never simulates anything. It only forwards each player's *inputs*
  ("deploy Knight at x, y on tick 120"). Both phones apply the same inputs
  on the same tick, so their battles stay identical. Every second they
  compare a checksum to catch drift.
* **Small traffic.** A frame is about 60–80 bytes and each side sends 30 per
  second: **about 1 MB per player** for a 3-minute match.
* **Single instance.** Rooms, codes and the quick-match queue live in the
  relay's memory, unseen by any other copy: run exactly **one** relay.
* **One box or two.** On Render (or `npm start`, or the Docker image) the
  relay also serves the page, so both boxes above are the same server. GitHub
  Pages hosts only static files and cannot run the relay, so the Pages copy
  needs a relay somewhere else (Render, Fly.io, a tunnel or a VPS).

---

## (b) LAN play (same Wi-Fi)

```sh
npm install
npm run play
```

`npm run play` builds the relay bundle (`dist-server/relay.mjs`) when it is
missing or out of date. It then starts the game on port 3101 and the relay on
port 3110, and prints a link like `http://192.168.1.20:3101`. Open that link
on each device on the same Wi-Fi. It works on Node 20 and Node 22.

Then play as in [step 4 of the Render section](#easiest-one-click-on-render).

On a plain `http://` page the game connects to `ws://<same host>:3110` by
itself. If a device cannot connect, allow Node through your computer's
firewall for private networks.

---

## (c) Free 5-minute test (Cloudflare quick tunnel)

This puts the relay on your own computer and gives it a temporary public
`wss://` address. You need no account. It lasts until you close the terminal.

```sh
npm install
npm run build:relay        # bundles server/relay.ts into dist-server/relay.mjs
npm run relay:prod         # relay on port 3110 (any origin allowed by default)
```

In a **second** terminal:

```sh
npx cloudflared tunnel --url http://localhost:3110
```

Wait for a line like `https://quiet-river-1234.trycloudflare.com`. Then open
this on both phones, with your tunnel name:

```
https://tamoura.github.io/clash-royale-clone/?relay=wss://quiet-river-1234.trycloudflare.com/ws
```

* Use `wss://` (not `https://`) and keep `/ws` at the end.
* The game remembers the relay on that device, so later visits need no
  `?relay=`. Open `?relay=clear` once to forget it.
* Check it: `node tools/relay-smoke.mjs wss://quiet-river-1234.trycloudflare.com/ws`
* The address changes every time you restart `cloudflared`.
* Through the tunnel every player shares your computer's IP limits (8
  sockets). For more devices, start the relay with
  `TRUST_PROXY=cf-connecting-ip npm run relay:prod` (Cloudflare sets that header).
* Shortcut: run `npm run build:all && npm start` instead of the two relay
  commands. Then the tunnel address itself is the game, with no `?relay=`.

---

## (d) Fly.io: the permanent home

Fly.io runs the repository's `Dockerfile` (game + relay) close to your
players, with HTTPS, and sleeps when nobody plays. This path gives the GitHub
Pages copy a relay; `fly.toml` holds the settings.

**1. Install flyctl and sign in**

```sh
curl -L https://fly.io/install.sh | sh   # macOS/Linux (or: brew install flyctl)
iwr https://fly.io/install.ps1 -useb | iex   # Windows (PowerShell)
fly auth signup                          # or: fly auth login
```

Fly asks for a card even for tiny apps. A sleeping relay costs cents.

**2. Create the app.** App names are global on Fly. If the placeholder name is
taken, pick another one and change `app = "…"` in `fly.toml` to match.

```sh
fly apps create clash-royale-clone-relay
```

**3. Pick a region** close to your players: edit `primary_region` in
`fly.toml` (`fra` Frankfurt, `bom` Mumbai, `ams`/`lhr` Europe, `iad`/`sjc`
US, `sin`/`nrt` Asia, `syd` Australia). `fly platform regions` lists them all.

**4. Settings and secrets.** The relay has no passwords, so it needs no
real secrets. Its settings live in `fly.toml` under `[env]`:

```toml
[env]
  NODE_ENV = "production"
  ALLOWED_ORIGINS = "https://tamoura.github.io"   # scheme + host only, no path
  TRUST_PROXY = "fly-client-ip"                   # the client IP header Fly's edge sets
```

To change one without a commit, use a Fly secret (it reaches the relay as an
environment variable too): `fly secrets set ALLOWED_ORIGINS="https://tamoura.github.io,http://localhost:3101"`.

**5. Deploy as ONE machine**

```sh
fly deploy --ha=false
fly scale count 1      # makes sure; Fly sometimes starts 2 for "high availability"
fly status             # should list exactly one machine
```

`--ha=false` matters. With two machines, two kids could land on different
relays and never find each other's room.

**6. Verify**

```sh
curl https://clash-royale-clone-relay.fly.dev/healthz
# {"ok":true,"v":2,"rooms":0,"conns":0,"queue":0,"uptime":42}

node tools/relay-smoke.mjs wss://clash-royale-clone-relay.fly.dev/ws --origin https://tamoura.github.io
# ... PASS: relay is healthy
```

The smoke test needs `--origin`, because the relay only accepts pages from
`ALLOWED_ORIGINS` and from its own address. Without it you get
`FAIL … HTTP 403`, which also proves the origin check works.

Your relay is `wss://clash-royale-clone-relay.fly.dev/ws`. Try it with
`https://tamoura.github.io/clash-royale-clone/?relay=wss://clash-royale-clone-relay.fly.dev/ws`, then bake it into the page.

---

## (e) Wiring GitHub Pages to the relay

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New repository
   variable.** Name: `RELAY_URL`. Value: your relay, e.g.
   `wss://clash-royale-clone-relay.fly.dev/ws` or `wss://<name>.onrender.com/ws`.
   This is a *variable*, not a secret. The address ends up in the public page anyway.
3. The Pages workflow (`.github/workflows/deploy.yml`) passes it to the build
   as `VITE_RELAY_URL`. Re-run it from **Actions → Deploy to GitHub Pages →
   Run workflow**, or push a commit.

Pages deploys run on pushes to `main`, `claude/game-visuals-character-balance-w122wb`
and `feature/arabesque-theme`, and on manual runs. If a run fails with *"not
allowed to deploy to github-pages due to environment protection rules"*, add
the branch under **Settings → Environments → github-pages → Deployment branches**.

How the page picks a relay (`src/net/relayUrl.ts`), first match wins:

1. `?relay=wss://…` in the link (then remembered on that device), or a
   relay remembered earlier.
2. `VITE_RELAY_URL` from the build: a `wss://` address, or `same-origin`
   (what `npm run build:all` sets) for the server the page came from.
3. On a plain `http://` page (LAN), `ws://<same host>:3110`.
4. Otherwise online play is off.

On an `https://` page, `ws://` is upgraded to `wss://` automatically.

---

## (f) Automatic relay deploys (FLY_API_TOKEN and relay.yml)

`.github/workflows/relay.yml` runs when you push changes under `server/`,
`src/net/` or `fly.toml` to `main` or `claude/game-visuals-character-balance-w122wb`,
or by hand from the Actions tab. It runs the tests, builds the relay bundle,
and deploys to Fly **only if** a `FLY_API_TOKEN` secret exists (otherwise it
skips the deploy and stays green). Render needs none of this.

```sh
fly tokens create deploy -x 999999h
```

Copy the whole output (it starts with `FlyV1`) into **Settings → Secrets and
variables → Actions → Secrets → New repository secret** named
`FLY_API_TOKEN`. Changes to the `Dockerfile` or card list do not trigger the
workflow, so run it by hand after those.

---

## (g) Other hosts

The server is one Node file plus the `ws` package (and the built `dist/` next
to it, to serve the game). It reads `PORT`, answers `GET /healthz` and accepts
WebSockets on `/ws`. Any host that keeps WebSockets open works; run one instance.

**Railway** (or any container host): New Project → Deploy from GitHub repo.
It finds the `Dockerfile`, which serves the game and the relay. Set
`TRUST_PROXY` for the host's proxy, then **Settings → Networking → Generate
Domain**. Open `https://<name>.up.railway.app`.

**A VPS with Caddy** (any $4–6/month Linux box, with a domain pointing at it):

```sh
npm ci && npm run build:all
sudo mkdir -p /opt/relay && sudo cp -r dist dist-server /opt/relay/
cd /opt/relay && sudo npm install ws@8
```

`/etc/systemd/system/relay.service`:

```ini
[Unit]
Description=Game relay
After=network.target

[Service]
WorkingDirectory=/opt/relay
ExecStart=/usr/bin/node /opt/relay/dist-server/relay.mjs
Environment=NODE_ENV=production
Environment=PORT=3110
Environment=ALLOWED_ORIGINS=https://tamoura.github.io
Environment=TRUST_PROXY=1
Restart=always
DynamicUser=yes

[Install]
WantedBy=multi-user.target
```

`/etc/caddy/Caddyfile` (Caddy gets the TLS certificate and passes WebSockets
through by itself):

```
relay.example.com {
	reverse_proxy localhost:3110
}
```

```sh
sudo systemctl enable --now relay && sudo systemctl reload caddy
```

The game is at `https://relay.example.com`, the relay at
`wss://relay.example.com/ws`.

**Later: Cloudflare Durable Objects.** One Durable Object per room would
remove the single-instance limit. `src/net/rooms.ts` is pure, so only the
socket glue would need rewriting. Not needed at kid-and-friends scale.

---

## (h) Configuration reference

| Setting            | Where           | Default                                   | What it does |
| ------------------ | --------------- | ----------------------------------------- | ------------ |
| `PORT`             | relay env       | `RELAY_PORT`, else `3110`                 | Port to listen on. Hosts usually set this (Render uses 10000); the Docker image uses 8080. |
| `RELAY_PORT`       | relay env       | `3110`                                    | Older name for the port; `PORT` wins if both are set. |
| `ALLOWED_ORIGINS`  | relay env       | `http://localhost:3101`; `*` for a relay-only server without `NODE_ENV=production` | Comma list of extra page origins (`https://host`, no path) allowed to connect; `*` allows any. Others get HTTP 403. A page from the relay's own host is always allowed. |
| `RENDER_EXTERNAL_URL` | set by Render | none                                    | The service's public address. It is always an allowed origin, and its presence makes `TRUST_PROXY` default to `true-client-ip`. |
| `STATIC_DIR`       | relay env       | the `dist/` beside the relay's folder     | Folder of the built game to serve at `/` (used when it has an `index.html`). `off`, or the `--relay-only` flag that `npm run relay:prod` passes, serves only the relay. |
| `MAX_CONN_PER_IP`  | relay env       | `8`                                       | Open sockets per client IP. Raise it if a whole school shares one IP. |
| `TRUST_PROXY`      | relay env       | off (`true-client-ip` on Render)          | Where the per-IP limits get the client IP behind a proxy. `1` = the right-most `X-Forwarded-For` entry (the one your proxy appended), for Caddy or nginx. Any other value names a header the edge sets itself: `true-client-ip` on Render (observed; Render does not document it, see [(j)](#j-operations-and-cost)), `fly-client-ip` on Fly, `cf-connecting-ip` behind Cloudflare. Leave it off when nothing sits in front of the relay, or clients could pick their own IP. |
| `QUICK_MATCH`      | relay env       | on                                        | `off` disables the quick-match queue; codes still work. |
| `NODE_ENV`         | relay env       | unset                                     | `production` tightens the default `ALLOWED_ORIGINS` of a relay-only server too. |
| `LOG_LEVEL`        | relay env       | `info`                                    | `debug` adds IPs and invalid-message detail. Use it briefly. |
| `VITE_RELAY_URL`   | page build env  | unset (`same-origin` in `npm run build:all`) | Relay baked into the page: a `wss://` address (from the `RELAY_URL` repo variable), or `same-origin` for the server the page came from. |
| `?relay=`          | page link       | none                                      | Per-device override, remembered; `?relay=clear` forgets it. Only `ws://` and `wss://` are accepted. |

Built-in limits: 4 KB per message; 60 messages per second per socket (bursts
up to 90); 5 create/join/quick per IP per 10 seconds. A socket is closed
after 5 invalid messages. There is a heartbeat ping every 15 seconds, and
expired rooms are swept every 30 seconds.

Serving the game, the relay compresses text and 3D models (brotli/gzip), caches
hashed `assets/` for a year and revalidates `index.html`, `sw.js` and the manifest.

---

## (i) Releasing protocol changes

The page and the relay must speak the same protocol. `PROTOCOL_VERSION` in
`src/net/protocol.ts` says which one.

* **Additive changes** (a new optional field or a new message the other side
  can ignore) keep the version. Old pages keep working.
* **Breaking changes** bump the version. The relay then answers older pages
  with `update-required`, and the page asks players to refresh.
* **Always deploy the relay first, then Pages.** A new relay accepts older
  messages; an old relay does not understand new ones. `/healthz` shows the
  relay's `v`. (On Render the game and the relay always ship together.)

---

## (j) Operations and cost

* **Health:** `curl https://<relay>/healthz` shows the room, connection and
  queue counts and the uptime.
* **Logs:** Render's **Logs** tab, `fly logs`, or your host's log view. Each
  line is one JSON event (`connect`, `create`, `match-start`, `refused`, …).
  IPs are not logged at the default level.
* **Check the per-player limits once (Render).** They read `True-Client-IP`,
  which Render's edge sets (observed; Render does not document it). Add
  `LOG_LEVEL` = `debug` under **Environment**, open the game on two networks
  (Wi-Fi and mobile data), and compare the `ip` of the two `connect-ip` lines
  in **Logs**. If it is the same, every player shares one limit: set
  `MAX_CONN_PER_IP` to `50`. Then delete `LOG_LEVEL`.
* **Restarts and deploys** end matches in progress. Players see "server
  restart" and can start a new game. Deploy when nobody is playing.
* **Memory:** a room keeps its match's frames so a dropped player can catch
  up: about 1 MB per 3-minute match, at most 4 MB before the 12-minute
  expiry. The served game adds about 50 MB (the files plus their compressed
  copies). 256 MB is plenty.
* **Cost:** Render's free plan and the Cloudflare tunnel cost nothing. On Fly,
  one `shared-cpu-1x` 256 MB machine is about $2/month if it never sleeps,
  cents with `auto_stop_machines`. Prices change: see
  <https://render.com/pricing> and <https://fly.io/docs/about/pricing/>.

---

## (k) Kid safety

* **No chat.** Players can only send one of 8 built-in emotes. The relay
  rejects anything else.
* **Names are cleaned** on the relay. Only letters, digits, spaces, `_` and
  `-` are kept, up to 12 characters, so links and markup cannot get through.
* **Codes are short-lived.** An unjoined room expires after 10 minutes, a
  match after 12, a quick-match wait after 2. Finished rooms free their code.
* **No accounts and no storage.** The relay keeps nothing on disk and logs
  no IP addresses by default. Resume tokens are random, sent only to their
  owner, and forgotten with the room.
* **Only your pages may connect** when the server hands out the game, and
  in production: its own address and `ALLOWED_ORIGINS`. Rate limits and
  connection caps stop spam. Quick match pairs anyone on the same server;
  set `QUICK_MATCH=off` to allow only code games.

---

## (l) Troubleshooting

**Render build failed.** Open the deploy's log. A red `npm ci` step is usually
a network hiccup: **Manual Deploy → Deploy latest commit**. If `tsc` or `vite
build` failed, the branch has an error; the last good version keeps running.

**"Couldn't reach the game server" right away, on the Pages site.**
Mixed content: an `https://` page may not open a `ws://` socket. Use a `wss://`
address. The resolver upgrades `ws://` itself, but the relay must really
serve TLS (Render, Fly, a tunnel and Caddy all do).

**Smoke test or browser gets HTTP 403.** The page origin is not allowed. Use
exactly `https://tamoura.github.io` in `ALLOWED_ORIGINS`: no
`/clash-royale-clone`, no trailing slash. Then redeploy (`fly deploy`,
`fly secrets set …`, or edit the variable under Render's **Environment**).

**A loading page, a slow first visit, or a first connection that fails
once.** The server was asleep. A free Render service takes about a minute to
wake (its loading page then opens the game by itself); a Fly machine takes
1–3 s. The client waits 8 seconds for a socket, so try again. To avoid it on
Fly, set `min_machines_running = 1` in `fly.toml` (about $2/month).

**"update-required".** The page and the relay speak different protocol
versions. Deploy the relay, re-run the Pages workflow, hard-refresh the phones.

**Stuck on "waiting for friend".**
* The code expired (10 minutes) or the relay restarted (a deploy). Create a
  new game.
* The friend typed the code wrong. Codes are a word plus two digits (`LION42`).
* The two phones use different relays. Check that both opened the same
  address (or the same `?relay=` link).
* Quick match only pairs players who picked the same mode. A queue entry
  gives up after 2 minutes.
* `fly status` shows two machines. Run `fly scale count 1`.

**"Connection out of sync" during a match.** Usually one phone has an old
cached version of the game: hard-refresh both and play again. If it keeps
happening on the same version, save a replay and report it (that is a bug).

**HTTP 429 when connecting.** Too many sockets from one IP (a shared school
or home network). Raise `MAX_CONN_PER_IP`. Behind a proxy, check that
`TRUST_PROXY` is set, or every player shares the proxy's IP.

**`/healthz` works but the game will not connect.** The relay address must
end in `/ws`, for example `wss://clash-royale-clone-relay.fly.dev/ws`.
