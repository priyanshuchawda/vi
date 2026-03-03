export interface StreamCoalescerOptions {
  flushIntervalMs?: number;
  maxBufferedChars?: number;
  onFlush: (text: string) => void;
}

const DEFAULT_FLUSH_INTERVAL_MS = 32;
const DEFAULT_MAX_BUFFERED_CHARS = 256;

export class StreamCoalescer {
  private readonly flushIntervalMs: number;
  private readonly maxBufferedChars: number;
  private readonly onFlush: (text: string) => void;
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: StreamCoalescerOptions) {
    this.flushIntervalMs = Math.max(0, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.maxBufferedChars = Math.max(1, options.maxBufferedChars ?? DEFAULT_MAX_BUFFERED_CHARS);
    this.onFlush = options.onFlush;
  }

  push(text: string): void {
    if (!text) {
      return;
    }
    this.buffer += text;

    if (this.buffer.length >= this.maxBufferedChars) {
      this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.flushIntervalMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.buffer) {
      return;
    }

    const nextChunk = this.buffer;
    this.buffer = '';
    this.onFlush(nextChunk);
  }

  dispose(): void {
    this.flush();
  }
}

export function createStreamCoalescer(options: StreamCoalescerOptions): StreamCoalescer {
  return new StreamCoalescer(options);
}
