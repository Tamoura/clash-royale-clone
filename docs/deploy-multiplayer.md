# Putting multiplayer online

This guide gets two players on different networks battling each other. It is
written for someone who has never hosted a server before. Every command is
meant to be copied as-is from the repository folder.

You need three things:

1. The game page. It is already on GitHub Pages at
   <https://tamoura.github.io/clash-royale-clone/>.
2. A **relay**: a tiny Node program (`server/relay.ts`) that passes each
   player's moves to the other player.
3. The page must know the relay's address. You set this once, as a build
   variable or as a `?relay=` link.

Pick one of these paths:

| I want to…                                     | Read                                      | Time   | Cost             |
| ---------------------------------------------- | ----------------------------------------- | ------ | ---------------- |
| play on the same Wi-Fi                         | [LAN play](#b-lan-play-same-wi-fi)        | 1 min  | free             |
| try it over the internet tonight               | [Free 5-minute test](#c-free-5-minute-test-cloudflare-quick-tunnel) | 5 min  | free             |
| have it always on                              | [Fly.io](#d-flyio-the-permanent-home)     | 20 min | about $0–2/month |

> **Status:** the relay, protocol and `?relay=` resolver (`src/net/relayUrl.ts`)
> are in place. The in-game online menu uses them once the online-client
> update lands. Until then the menu only talks to the LAN relay on port 3110,
> so the LAN path below works today.

---

## (a) How it works

```
  phone A (browser)                                  phone B (browser)
 +-------------------+                              +-------------------+
 | game page         |      static files (HTTPS)    | game page         |
 | full simulation   | <---------+       +--------> | full simulation   |
 +---------+---------+           |       |          +---------+---------+
           |               +-----+-------+------+             |
           |               | GitHub Pages       |             |
           |               | tamoura.github.io  |             |
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
  second. A 3-minute match is **about 1 MB per player**. Any free tier
  handles that.
* **Single instance.** Rooms, codes and the quick-match queue live in the
  relay's memory. Two relay copies would not see each other's rooms. Always
  run exactly **one** relay.
* **The page and the relay are separate.** GitHub Pages hosts only static
  files and cannot run the relay. The relay needs a host that keeps
  WebSockets open: your PC, Fly.io, Render, Railway or a VPS.

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

* One player taps **Play a Friend → Create a game** and reads the code aloud.
* The other taps **Join** and types it in.

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
* Check it from your computer:
  `node tools/relay-smoke.mjs wss://quiet-river-1234.trycloudflare.com/ws`
* The address changes every time you restart `cloudflared`.
* Through the tunnel, every player seems to come from your own computer, so
  they share one IP's limits (8 sockets). For more than a few devices, start
  the relay with `TRUST_PROXY=cf-connecting-ip npm run relay:prod`. Then
  limits count per player, using the `CF-Connecting-IP` header that
  Cloudflare sets itself.

---

## (d) Fly.io: the permanent home

Fly.io runs the relay's Docker image close to your players, with HTTPS, and
can put it to sleep when nobody plays. The repository already has a
`Dockerfile` and a `fly.toml`.

**1. Install flyctl and sign in**

```sh
# macOS
brew install flyctl
# Linux
curl -L https://fly.io/install.sh | sh
# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex

fly auth signup        # or: fly auth login
```

Fly asks for a card even for tiny apps. A sleeping relay costs cents.

**2. Create the app**

App names are global on Fly. Try the placeholder name. If it is taken, pick
another one and change `app = "…"` in `fly.toml` to match.

```sh
fly apps create clash-royale-clone-relay
```

**3. Pick a region** close to your players. Edit `primary_region` in
`fly.toml`. Run `fly platform regions` for the full current list.

| Players mostly in…        | Region code | City           |
| ------------------------- | ----------- | -------------- |
| Gulf / Middle East        | `fra`, `bom`| Frankfurt, Mumbai |
| Western Europe            | `ams`, `lhr`, `cdg` | Amsterdam, London, Paris |
| US East / US West         | `iad`, `sjc`| Virginia, San Jose |
| South / East Asia         | `sin`, `nrt`| Singapore, Tokyo |
| Australia                 | `syd`       | Sydney         |
| South America / Africa    | `gru`, `jnb`| São Paulo, Johannesburg |

**4. Settings and secrets.** The relay has no passwords, so it needs no
real secrets. Its settings live in `fly.toml` under `[env]`:

```toml
[env]
  NODE_ENV = "production"
  ALLOWED_ORIGINS = "https://tamoura.github.io"   # scheme + host only, no path
  TRUST_PROXY = "fly-client-ip"                   # the client IP header Fly's edge sets
```

To change a value without committing it, use a Fly secret. Secrets are also
passed to the program as environment variables:

```sh
fly secrets set ALLOWED_ORIGINS="https://tamoura.github.io,http://localhost:3101"
```

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
`ALLOWED_ORIGINS`. Without it you get `FAIL … HTTP 403`, which also proves
the origin check works.

Your relay address is `wss://clash-royale-clone-relay.fly.dev/ws`. You can
try it right away with
`https://tamoura.github.io/clash-royale-clone/?relay=wss://clash-royale-clone-relay.fly.dev/ws`.
Next, bake it into the page.

---

## (e) Wiring GitHub Pages to the relay

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New repository
   variable.** Name: `RELAY_URL`. Value: `wss://clash-royale-clone-relay.fly.dev/ws`.
   This is a *variable*, not a secret. The address ends up in the public page anyway.
3. The Pages workflow (`.github/workflows/deploy.yml`) passes it to the build
   as `VITE_RELAY_URL`. Re-run it from **Actions → Deploy to GitHub Pages →
   Run workflow**, or push a commit.

Pages deploys run on pushes to `main`, `claude/game-visuals-character-balance-w122wb`
and `feature/arabesque-theme`, and on manual runs. The `github-pages`
environment may only allow some branches. If a run fails with *"not allowed
to deploy to github-pages due to environment protection rules"*, go to
**Settings → Environments → github-pages → Deployment branches** and add the
branch.

How the page picks a relay (`src/net/relayUrl.ts`), first match wins:

1. `?relay=wss://…` in the link (then remembered on that device), or a
   relay remembered earlier.
2. `VITE_RELAY_URL` from the build.
3. On a plain `http://` page (LAN), `ws://<same host>:3110`.
4. Otherwise online play is off.

On an `https://` page, `ws://` is upgraded to `wss://` automatically.

---

## (f) Automatic relay deploys (FLY_API_TOKEN and relay.yml)

`.github/workflows/relay.yml` runs when you push changes under `server/`,
`src/net/` or `fly.toml` to `main` or `claude/game-visuals-character-balance-w122wb`.
You can also run it by hand from the Actions tab. It runs the tests, builds
the relay bundle, and then deploys to Fly. It deploys **only if** a
`FLY_API_TOKEN` secret exists. Without one it skips the deploy and stays
green.

```sh
fly tokens create deploy -x 999999h
```

Copy the whole output (it starts with `FlyV1`) into **Settings → Secrets and
variables → Actions → Secrets → New repository secret** named
`FLY_API_TOKEN`. Changes to the `Dockerfile` or card list do not trigger the
workflow, so run it by hand after those.

---

## (g) Other hosts

The relay is one Node file plus the `ws` package. It reads `PORT`, answers
`GET /healthz`, and accepts WebSockets on `/ws`. Any host that keeps
WebSockets open works.

**Render** (has a free instance type):
New → Web Service → connect the GitHub repo → Runtime: **Docker**. Health
check path: `/healthz`. Environment: `ALLOWED_ORIGINS=https://tamoura.github.io`
and `TRUST_PROXY=1`. Render sets `PORT` itself. Free instances sleep after
about 15 idle minutes and take up to a minute to wake. Address:
`wss://<name>.onrender.com/ws`.

**Railway**: New Project → Deploy from GitHub repo. It finds the
`Dockerfile`. Add the same two variables, then **Settings → Networking →
Generate Domain**. Address: `wss://<name>.up.railway.app/ws`.

**A VPS with Caddy** (any $4–6/month Linux box, with a domain pointing at it):

```sh
npm ci && npm run build:relay
sudo mkdir -p /opt/relay && sudo cp dist-server/relay.mjs /opt/relay/
cd /opt/relay && sudo npm install ws@8
```

`/etc/systemd/system/relay.service`:

```ini
[Unit]
Description=Game relay
After=network.target

[Service]
WorkingDirectory=/opt/relay
ExecStart=/usr/bin/node /opt/relay/relay.mjs
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

Address: `wss://relay.example.com/ws`.

**Later: Cloudflare Durable Objects.** One Durable Object per room would
remove the single-instance limit and the server. The room logic in
`src/net/rooms.ts` is pure (it has no sockets and no clock of its own), so
it could move over. Only the socket glue would need rewriting. This is not
needed at kid-and-friends scale.

---

## (h) Configuration reference

| Setting            | Where           | Default                                   | What it does |
| ------------------ | --------------- | ----------------------------------------- | ------------ |
| `PORT`             | relay env       | `RELAY_PORT`, else `3110`                 | Port to listen on. Hosts usually set this; the Docker image uses 8080. |
| `RELAY_PORT`       | relay env       | `3110`                                    | Older name for the port; `PORT` wins if both are set. |
| `ALLOWED_ORIGINS`  | relay env       | `*`, or `http://localhost:3101` when `NODE_ENV=production` | Comma list of page origins (`https://host`, no path) allowed to connect; `*` allows any. Others get HTTP 403. |
| `MAX_CONN_PER_IP`  | relay env       | `8`                                       | Open sockets per client IP. Raise it if a whole school shares one IP. |
| `TRUST_PROXY`      | relay env       | off                                       | Where the per-IP limits get the client IP behind a proxy. `1` = the right-most `X-Forwarded-For` entry (the one your proxy appended; earlier entries come from the client and can be forged), for Render or Caddy. Any other value names a header the edge sets itself: `fly-client-ip` on Fly, `cf-connecting-ip` behind Cloudflare. Leave it off when nothing sits in front of the relay, or clients could pick their own IP. |
| `QUICK_MATCH`      | relay env       | on                                        | `off` disables the quick-match queue; codes still work. |
| `NODE_ENV`         | relay env       | unset                                     | `production` tightens the default `ALLOWED_ORIGINS`. |
| `LOG_LEVEL`        | relay env       | `info`                                    | `debug` adds IPs and invalid-message detail. Use it briefly. |
| `VITE_RELAY_URL`   | page build env  | unset                                     | Relay address baked into the page (from the `RELAY_URL` repo variable). |
| `?relay=`          | page link       | none                                      | Per-device override, remembered; `?relay=clear` forgets it. Only `ws://` and `wss://` are accepted. |

Built-in limits: 4 KB per message; 60 messages per second per socket (bursts
up to 90); 5 create/join/quick per IP per 10 seconds. A socket is closed
after 5 invalid messages. There is a heartbeat ping every 15 seconds, and
expired rooms are swept every 30 seconds.

---

## (i) Releasing protocol changes

The page and the relay must speak the same protocol. `PROTOCOL_VERSION` in
`src/net/protocol.ts` says which one.

* **Additive changes** (a new optional field or a new message the other side
  can ignore) keep the version. Old pages keep working.
* **Breaking changes** bump the version. The relay then answers older pages
  with `update-required`, and the page asks players to refresh.
* **Always deploy the relay first, then Pages.** A new relay still accepts
  older messages, but an old relay does not understand new ones. Check
  `/healthz`: its `v` shows the version the relay runs.

---

## (j) Operations and cost

* **Health:** `curl https://<relay>/healthz` shows the room, connection and
  queue counts and the uptime.
* **Logs:** `fly logs` (or your host's log view). Each line is one JSON
  event (`connect`, `create`, `match-start`, `refused`, …). IPs are not
  logged at the default level.
* **Restarts and deploys** end matches in progress. Players see "server
  restart" and can start a new game. Deploy when nobody is playing.
* **Memory:** a room keeps its match's frames so a dropped player can catch
  up. That is about 1 MB for a 3-minute match and at most about 4 MB before
  the 12-minute expiry. 256 MB is plenty for dozens of matches at once.
* **Cost on Fly:** one `shared-cpu-1x` machine with 256 MB costs about
  $2/month if it never sleeps. With `auto_stop_machines` it sleeps when idle,
  so light use costs cents. Prices change, so see <https://fly.io/docs/about/pricing/>.
  Render's free tier and the Cloudflare tunnel cost nothing.

---

## (k) Kid safety

* **No chat.** Players can only send one of 8 built-in emotes. The relay
  rejects anything else.
* **Names are cleaned** on the relay. Only letters, digits, spaces, `_` and
  `-` are kept, up to 12 characters, so links and markup cannot get through.
* **Codes are short-lived.** An unjoined room expires after 10 minutes, a
  match after 12, and a quick-match wait after 2. A finished room's code is
  freed.
* **No accounts and no storage.** The relay keeps nothing on disk and logs
  no IP addresses by default. Resume tokens are random, sent only to their
  owner, and forgotten with the room.
* **Only your page may connect** in production (`ALLOWED_ORIGINS`). Rate
  limits and connection caps stop spam.

---

## (l) Troubleshooting

**"Couldn't reach the game server" right away, on the Pages site.**
Mixed content: an `https://` page may not open a `ws://` socket. Use a `wss://`
address. The resolver upgrades `ws://` itself, but the relay must really
serve TLS (Fly, Render, a tunnel and Caddy all do).

**Smoke test or browser gets HTTP 403.** The page origin is not in
`ALLOWED_ORIGINS`. Use exactly `https://tamoura.github.io`: no
`/clash-royale-clone`, no trailing slash. Then `fly deploy` again (or
`fly secrets set …`).

**The first connection takes a few seconds, or fails once.** That is a cold
start. A sleeping Fly machine wakes in about 1–3 s, and a free Render instance
can take up to a minute. The client waits 8 seconds, so try again. To avoid
it, set `min_machines_running = 1` in `fly.toml` (about $2/month).

**"update-required".** The page and the relay are on different protocol
versions. Deploy the relay, then re-run the Pages workflow, then hard-refresh
the phones.

**Stuck on "waiting for friend".**
* The code expired (10 minutes) or the relay restarted (a deploy). Create a
  new game.
* The friend typed the code wrong. Codes are a word plus two digits, like
  `LION42`.
* The two phones use different relays. Check that both opened the same
  `?relay=` link, or neither did.
* Quick match only pairs players who picked the same mode. A queue entry
  gives up after 2 minutes.
* `fly status` shows two machines. Run `fly scale count 1`.

**"Connection out of sync" during a match.** The two phones simulated
differently. Usually one phone has an old cached version of the game, so
hard-refresh both and play again. If it keeps happening on the same version,
save a replay and report it, because that is a bug.

**HTTP 429 when connecting.** Too many sockets from one IP (a shared school
or home network). Raise `MAX_CONN_PER_IP`.

**`/healthz` works but the game will not connect.** Check the path. The
relay address must end in `/ws`, for example
`wss://clash-royale-clone-relay.fly.dev/ws`.

**Pages deploy fails with "environment protection rules".** See
[section (e)](#e-wiring-github-pages-to-the-relay). Allow the branch under
Settings → Environments → github-pages.
