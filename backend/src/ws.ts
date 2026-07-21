import crypto from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';

/**
 * Minimal RFC 6455 WebSocket server implementation over a raw TCP socket.
 *
 * Why hand-written: Node has NO built-in WebSocket *server*. `globalThis.WebSocket`
 * is a client only (used elsewhere to dial Deepgram), and node:http/https/net
 * expose just the `'upgrade'` event plus a raw socket — the handshake
 * (Sec-WebSocket-Accept) and frame masking/decoding must be implemented by hand
 * or via a third-party library (e.g. `ws`). This project intentionally keeps
 * zero runtime dependencies, so we implement the small subset we need here.
 *
 * Scope: just enough to act as a transparent proxy — completes the upgrade
 * handshake, decodes inbound client frames (text/binary/close/ping) and encodes
 * outbound frames. It does NOT implement extensions/compression and assumes a
 * well-behaved browser client (which always masks frames, as required by spec).
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

type MessageHandler = (data: Buffer, isBinary: boolean) => void;
type CloseHandler = () => void;

export class WebSocketConnection {
  private socket: Duplex;
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;

  private messageHandlers: MessageHandler[] = [];
  private closeHandlers: CloseHandler[] = [];

  constructor(socket: Duplex) {
    this.socket = socket;
    this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
    this.socket.on('close', () => this.handleClose());
    this.socket.on('error', () => this.handleClose());
  }

  /** Complete the opening handshake. Returns a connection on success. */
  static accept(req: IncomingMessage, socket: Duplex): WebSocketConnection | null {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return null;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n',
    );
    return new WebSocketConnection(socket);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  /** Send a text frame. */
  sendText(text: string): void {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  /** Send a binary frame. */
  sendBinary(data: Buffer): void {
    this.sendFrame(0x2, data);
  }

  close(code = 1000): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    try {
      this.sendFrame(0x8, payload);
    } catch {
      // socket may already be gone
    }
    this.socket.end();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk] as readonly Uint8Array[]);
    this.parseFrames();
  }

  private parseFrames(): void {
    // Loop while a full frame is available in the buffer.
    for (;;) {
      if (this.buffer.length < 2) {
        return;
      }
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let len = second & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buffer.length < offset + 2) return;
        len = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (this.buffer.length < offset + 8) return;
        // Only support payloads up to 2^32-1; audio frames are tiny.
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        len = high * 0x100000000 + low;
        offset += 8;
      }

      const maskKey = masked ? this.buffer.subarray(offset, offset + 4) : null;
      if (masked) {
        offset += 4;
      }
      if (this.buffer.length < offset + len) {
        return; // wait for more data
      }

      const payload = Buffer.from(this.buffer.subarray(offset, offset + len) as Uint8Array);
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }
      this.buffer = this.buffer.subarray(offset + len);

      this.handleFrame(opcode, payload);
    }
  }

  private handleFrame(opcode: number, payload: Buffer): void {
    switch (opcode) {
      case 0x1: // text
        this.emitMessage(payload, false);
        break;
      case 0x2: // binary
        this.emitMessage(payload, true);
        break;
      case 0x8: // close
        this.close();
        break;
      case 0x9: // ping -> reply pong
        this.sendFrame(0xa, payload);
        break;
      case 0xa: // pong, ignore
        break;
      default:
        break;
    }
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    if (this.socket.destroyed) {
      return;
    }
    const len = payload.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeUInt32BE(Math.floor(len / 0x100000000), 2);
      header.writeUInt32BE(len % 0x100000000, 6);
    }
    header[0] = 0x80 | opcode; // FIN + opcode (server frames are not masked)
    this.socket.write(Buffer.concat([header, payload] as readonly Uint8Array[]));
  }

  private emitMessage(data: Buffer, isBinary: boolean): void {
    for (const handler of this.messageHandlers) {
      handler(data, isBinary);
    }
  }

  private handleClose(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const handler of this.closeHandlers) {
      handler();
    }
  }
}
