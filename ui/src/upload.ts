import { SERVER_ADDR } from "./config";

import { createHash } from "sha256-uint8array";

class UploadChannel {
  hash: Uint8Array;
  offset: number;
  filesize: number;
  sending: bool;
  cb: ProgressCallback;

  constructor(hash: Uint8Array, offset: number, cb: ProgressCallback) {
    this.hash = hash;
    this.offset = offset;
    this.filesize = 0;
    this.sending = false;
    this.cb = cb;
  }
}

interface ChannelMap {
  [key: number]: UploadChannel;
}

let chans: ChannelMap = {};

class UploadPipe {
  private addr: string;
  private ws: WebSocket | null;
  private is_connected: bool = false;
  private channels: number = 0x00;

  readonly NO_PROTOCOLS = [];
  readonly CONTROL_FLAG = 0x80;

  public constructor(
    addr: string,
    connecting,
    connected,
    disconnected,
  ) {
    this.addr = addr;
    this.connectingCb = connecting;
    this.connectedCb = connected;
    this.disconnectedCb = disconnected;
    this.connect();
  }

  private connect() {
    let ws = new WebSocket(this.addr, this.NO_PROTOCOLS);
    ws.onopen = this.connected.bind(this);
    ws.onerror = this.failed.bind(this);
    ws.onclose = this.disconnected.bind(this);
    this.ws = ws;
    this.channels = 0x00;
    this.connectingCb();
  }

  private connected(ev) {
    console.debug("connected", typeof ev, ev);
    this.is_connected = true;
    this.ws.onmessage = this.received.bind(this);
    this.connectedCb();
  }

  private failed(ev) {
    console.debug("failed", typeof ev, ev);
    this.is_connected = false;
    this.disconnectedCb();
  }

  private disconnected(ev) {
    console.debug("disconnected", typeof ev, ev);
    this.is_connected = false;
    this.ws = null;
    this.disconnectedCb();

    setTimeout(this.connect.bind(this), 2000);
  }

  public startUpload(hash: TypedArray, cb: ProgessCallback) {
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
    );
    this.ws.send(upload_message);
    chans[this.channels] = new UploadChannel(hash, 0, cb);
    this.channels += 1;
  }

  private async received(ev) {
    let msg = new Uint8Array(await ev.data.arrayBuffer());

    let channelId = msg[0] ^ 0x80;
    let offset = (msg[1] << 24) +
      (msg[2] << 16) +
      (msg[3] << 8) +
      (msg[4]);
    console.debug(`channel id=${channelId}, offset=${offset}`);

    const uc = chans[channelId];

    const hash = uc.hash;
    const f = files[hash];
    const filesize = f.size;
    uc.cb(offset / filesize * 100);
    if (uc.sending || offset == filesize) {
      return;
    }

    uc.filesize = filesize;
    uc.offset = offset;
    uc.sending = true;
    const readableStream = f.stream();
    const reader = readableStream.getReader({ mode: "byob" });
    let buffer = new ArrayBuffer(64 * 1000 * 10);
    let read = 0;
    while (true) {
      let view = new Uint8Array(buffer, 1, buffer.byteLength - 1);
      const { value, done } = await reader.read(view);
      read += value.length;
      // console.debug("chunk done=", done, "value=", value);
      let tosend = new Uint8Array(value.buffer, 0, value.length + 1);
      tosend[0] = channelId;
      // TODO(@willemvds): Fix this to deal with split chunks.
      if (value.length > 0 && offset < read) {
        ev.target.send(tosend);
        // console.debug("buffer amount", ev.target.bufferedAmount);

        // await new Promise((resolve) => setTimeout(resolve, 20));
      }
      buffer = tosend.buffer;
      if (done) {
        console.debug(`Sent ${read} at ${offset}`);
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

function showProgress(pb: HTMLElement, progress: number) {
  const maxBlockNum = Math.trunc(progress / 10);
  let remainder = progress;
  for (let i = 0; i <= maxBlockNum; i++) {
    const block = pb.querySelectorAll(`.p${i}`);
    const perc = Math.min(10, progress - (i * 10));
    if (block.length > 0) {
      block[0].style.height = `${perc * 10}%`;
    }
  }
}

function init() {
  console.debug("Running init.");

  const statusConnecting = document.querySelector(
    "div#status > img#status-connecting",
  );
  const statusConnected = document.querySelector(
    "div#status > img#status-connected",
  );
  const statusDisconnected = document.querySelector(
    "div#status > img#status-disconnected",
  );

  const connecting = function () {
    statusConnecting.classList.remove("hidden");
    statusConnected.classList.add("hidden");
    statusDisconnected.classList.add("hidden");
  };
  const connected = function () {
    statusConnecting.classList.add("hidden");
    statusConnected.classList.remove("hidden");
    statusDisconnected.classList.add("hidden");
  };
  const disconnected = function () {
    statusConnecting.classList.add("hidden");
    statusConnected.classList.add("hidden");
    statusDisconnected.classList.remove("hidden");
  };

  const up = new UploadPipe(
    `${SERVER_ADDR}/ws`,
    connecting,
    connected,
    disconnected,
  );
  const form = document.getElementById("uploadForm");
  const fileInput = document.getElementById("fileInput");

  window.addEventListener("dragover", (ev) => {
    ev.preventDefault();
  });

  window.addEventListener("drop", (ev) => {
    ev.preventDefault();
  });

  async function fileHandler(file: File) {
    const hash = await sha256(file.stream());
    files[hash] = file;
    const pb = createProgressBlock(file.name, hash.toHex());
    const cb = function (progress: number) {
      showProgress(pb, progress);
    };
    up.startUpload(hash, cb);
  }

  const inputDiv = document.getElementById("input");
  inputDiv.addEventListener("drop", async function (ev) {
    ev.preventDefault();
    for (const item of ev.dataTransfer.items) {
      if (item.kind != "file") {
        const file = item.getAsFile();
        await fileHandler(file);
      }
    }
  });

  form.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    console.debug(fileInput.files);
    await fileHandler(fileInput.files[0]);
  });
}

type ProgressCallback = (progress: number) => void;

function createProgressBlock(name: string, hash: string) {
  const progressBlocks = document.getElementById("progress-blocks");
  if (progressBlocks === null) {
    return;
  }
  const progressBlockTemplate = document.getElementById(
    "progress-block-template",
  );
  if (progressBlockTemplate === null) {
    return;
  }

  const progressBlock = progressBlockTemplate.content.cloneNode(true);
  const blockId = `progress-${hash}`;
  const firstBlock = progressBlocks.firstChild;
  if (firstBlock) {
    progressBlocks.insertBefore(progressBlock, firstBlock);
  } else {
    progressBlocks.appendChild(progressBlock);
  }
  const newBlock = progressBlocks.querySelector("div.progress-block");
  newBlock.id = blockId;
  const nameP = newBlock.querySelector(
    "div.name > p",
  );
  nameP.textContent = name;
  return newBlock;
}

const READY_STATE_LOADING = "loading";

if (document.readyState === READY_STATE_LOADING) {
  console.debug("Adding DOMContentLoaded listener.");
  document.addEventListener("DOMContentLoaded", init);
} else {
  console.debug("DOMContentLoaded already fired.");
  init();
}
