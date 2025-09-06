import { serveDir } from "@std/http/file-server";
import { encodeHex } from "@std/encoding/hex";

const CONTROL_FLAG = 0x80;

interface FileProgressMap {
  [key: string]: number;
}
let files: FileProgressMap = {};

interface ChannelFileMap {
  [key: number]: Uint8Array;
}
let channels: ChannelFileMap = {};

function httpHandler(req: Request) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  if (pathname.includes("/ws")) {
    return wsHandler(req);
  }

  return serveDir(req, {
    fsRoot: "./ui/dist",
  });
}

function wsOpen(ev: Event) {
  console.debug(ev);
}

async function wsMessage(ev: MessageEvent) {
  if (ev.target === null || !(ev.target instanceof WebSocket)) {
    return;
  }

  const msg = new Uint8Array(ev.data);
  if ((msg[0] & CONTROL_FLAG) == CONTROL_FLAG) {
    if (msg.length != 33) {
      console.debug("BAD");
      return;
    }
    const channel = msg[0] ^ CONTROL_FLAG;
    const hash = msg.slice(1);
    const hashHex = encodeHex(hash);
    if (!(hashHex in files)) {
      files[hashHex] = 0;
    }
    let offset = files[hashHex];
    channels[channel] = hash;
    console.debug("channel=", channel, "offset=", offset);
    let resp = new ArrayBuffer(5);
    let dv = new DataView(resp);
    dv.setUint8(0, msg[0]);
    dv.setUint32(1, offset);
    ev.target.send(dv);
  } else {
    const channel = msg[0];
    const hash = channels[channel];
    const hashHex = encodeHex(hash);
    const l = files[hashHex];
    console.debug(
      "updating hash=",
      hashHex,
      "from=",
      l,
      "to=",
      l + msg.length - 1,
    );
    files[hashHex] += msg.length - 1;
    //await new Promise((resolve) => setTimeout(resolve, 500));
    let resp = new ArrayBuffer(5);
    let dv = new DataView(resp);
    dv.setUint8(0, channel | CONTROL_FLAG);
    dv.setUint32(1, files[hashHex]);
    ev.target.send(dv);
  }
  return;
}

function wsHandler(req: Request) {
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response("You done bad.", { status: 426 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.addEventListener("open", wsOpen);
  socket.addEventListener("message", wsMessage);

  return response;
}

Deno.serve({ port: 13080, hostname: "0.0.0.0" }, httpHandler);
