import { SERVER_ADDR } from "./config";

import { createHash } from "sha256-uint8array";

let chans = {};

class UploadPipe {
  private addr: string;
  private ws: WebSocket | null;
  private is_connected: bool = false;
  private channels: number = 0x00;

  readonly NO_PROTOCOLS = [];
  readonly CONTROL_FLAG = 0x80;

  public constructor(addr: string) {
    this.addr = addr;
    this.connect();
  }

  private connect() {
    let ws = new WebSocket(this.addr, this.NO_PROTOCOLS);
    ws.onopen = this.connected.bind(this);
    ws.onerror = this.failed.bind(this);
    ws.onclose = this.disconnected.bind(this);
    this.ws = ws;
    this.channels = 0x00;
  }

  private connected(ev) {
    console.debug("connected", typeof ev, ev);
    this.is_connected = true;
    this.ws.onmessage = this.received.bind(this);
  }

  private failed(ev) {
    console.debug("failed", typeof ev, ev);
    this.is_connected = false;
  }

  private disconnected(ev) {
    console.debug("disconnected", typeof ev, ev);
    this.is_connected = false;
    this.ws = null;

    setTimeout(this.connect.bind(this), 5000);
  }

  public startUpload(hash: TypedArray) {
    if (!this.is_connected) {
      console.debug("NOT CONNECTED.");
      return;
    }

    const upload_message = new Uint8Array(33);
    const control_byte = this.CONTROL_FLAG | self.channels;
    upload_message[0] = this.CONTROL_FLAG | (this.channels & 0xFF);
    upload_message.set(hash, 1);

    console.debug(
      "upload",
      hash.toHex(),
      "using",
      this.channels,
      upload_message,
    );
    console.debug("send", this.ws.send(upload_message));
    chans[this.channels] = hash;
    this.channels += 1;
  }

  private async received(ev) {
    console.debug("received", typeof ev, ev);
    let msg = new Uint8Array(await ev.data.arrayBuffer());
    console.debug("msg", msg);

    let offset = (msg[1] << 24) +
      (msg[2] << 16) +
      (msg[3] << 8) +
      (msg[4]);
    console.debug("offset for uploading =", offset);
    let channelId = msg[0] ^ 0x80;
    console.debug("channel id for uploading =", channelId);
    const hash = chans[channelId];
    console.debug("hash for upload=", hash.toHex());
    const f = files[hash];
    const readableStream = f.stream();
    const reader = readableStream.getReader({ mode: "byob" });
    let buffer = new ArrayBuffer(64 * 1000 * 10);
    let read = 0;
    while (true) {
      let view = new Uint8Array(buffer, 1, buffer.byteLength - 1);
      const { value, done } = await reader.read(view);
      read += value.length;
      console.debug("chunk done=", done, "value=", value);
      let tosend = new Uint8Array(value.buffer, 0, value.length + 1);
      tosend[0] = channelId;
      // TODO(@willemvds): Fix this to deal with split chunks.
      if (offset < read) {
        ev.target.send(tosend);
      } else {
        console.debug("NOT SENDING", offset, read);
      }
      buffer = tosend.buffer;
      if (done) {
        break;
      }
    }
  }
}

class SHA256TransformStream extends TransformStream {
  private constructor() {
    const hasher = createHash();
    super({
      transform(chunk, _controller) {
        hasher.update(chunk);
      },
      flush(controller) {
        const hash = hasher.digest("binary");
        controller.enqueue(hash);
      },
    });
  }
}

async function sha256(readableStream) {
  const sha256Stream = new SHA256TransformStream();
  const reader = readableStream.pipeThrough(sha256Stream).getReader();

  let hash = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    hash = value;
  }

  return hash;
}

let files = {};

function init() {
  console.debug("Running init.");
  const up = new UploadPipe(`${SERVER_ADDR}/ws`);
  const form = document.getElementById("uploadForm");
  const fileInput = document.getElementById("fileInput");

  form.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    console.debug(fileInput);
    console.debug(fileInput.files);
    console.debug(fileInput.files[0].stream);

    const hash = await sha256(fileInput.files[0].stream());
    files[hash] = fileInput.files[0];
    up.startUpload(hash);
    console.debug(`${hash}`);
  });
}

const READY_STATE_LOADING = "loading";

if (document.readyState === READY_STATE_LOADING) {
  console.debug("Adding DOMContentLoaded listener.");
  document.addEventListener("DOMContentLoaded", init);
} else {
  console.debug("DOMContentLoaded already fired.");
  init();
}
