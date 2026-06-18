// LAN relay for online 1v1. Pure pairing/relay logic lives in the tested
// src/net/rooms.ts; this file is only the socket glue around it.
//
// Run with:  node --experimental-transform-types server/relay.ts
import { WebSocketServer, type WebSocket } from "ws";
import { RoomHub, type Outbound } from "../src/net/rooms.ts";
import { makeCodeGen } from "../src/net/codewords.ts";
import type { ClientMsg } from "../src/net/protocol.ts";

const PORT = Number(process.env.RELAY_PORT ?? 3110);

const hub = new RoomHub(makeCodeGen(Math.random));
const sockets = new Map<string, WebSocket>();
let nextId = 1;

const wss = new WebSocketServer({ port: PORT });

function deliver(actions: Outbound[]): void {
  for (const { to, msg } of actions) {
    const ws = sockets.get(to);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}

wss.on("connection", (ws) => {
  const id = `c${nextId++}`;
  sockets.set(id, ws);

  ws.on("message", (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // ignore malformed input
    }
    switch (msg.t) {
      case "create":
        deliver(hub.create(id, msg.deck, msg.mode));
        break;
      case "join":
        deliver(hub.join(id, msg.code.toUpperCase(), msg.deck));
        break;
      case "frame":
        deliver(hub.relayFrame(id, msg.frame));
        break;
      case "sync":
        deliver(hub.relaySync(id, msg.tick, msg.checksum));
        break;
    }
  });

  ws.on("close", () => {
    deliver(hub.leave(id));
    sockets.delete(id);
  });
});

wss.on("listening", () => {
  console.log(`[relay] listening on ws://0.0.0.0:${PORT}`);
});
