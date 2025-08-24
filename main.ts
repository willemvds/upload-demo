import { serveDir } from "@std/http/file-server";
import { encodeHex } from "@std/encoding/hex";

const CONTROL_FLAG = 0x80;

interface FileProgressMap {
  [key: Uint8Array]: number;
}
let files: FileProgressMap = {};

interface ChannelFileMap {
  [key: number]: Uint8Array;
}
let channels: ChannelFileMap = {};

function httpHandler(req: Request) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  if (pathname == "/ws") {
    return wsHandler(req);
  }

  return serveDir(req, {
    fsRoot: "./ui/dist",
  });
}

function wsOpen(ev) {
  console.debug(ev);
}

function wsMessage(ev) {
  const msg = new Uint8Array(ev.data);
  if ((msg[0] & CONTROL_FLAG) == CONTROL_FLAG) {
    if (msg.length != 33) {
      console.debug("BAD");
      return;
    }
    const channel = msg[0] ^ CONTROL_FLAG;
    let hash = msg.slice(1);
    if (!(hash in files)) {
      files[hash] = 0;
    }
    let offset = files[hash];
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
    const l = files[hash];
    console.debug(
      "updating hash=",
      encodeHex(hash),
      "from=",
      l,
      "to=",
      l + msg.length - 1,
    );
    files[hash] += msg.length - 1;
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

Deno.serve(httpHandler);
