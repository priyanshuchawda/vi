export type ChatQueuePriority = 'normal' | 'high';

export interface ChatQueueSnapshot {
  inFlight: boolean;
  pending: number;
  activeLabel: string | null;
}

export interface EnqueueOptions {
  priority?: ChatQueuePriority;
  label?: string;
}

type Listener = (snapshot: ChatQueueSnapshot) => void;

interface QueueItem<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  label: string | null;
}

class ChatRequestQueue {
  private readonly queue: QueueItem<unknown>[] = [];
  private readonly listeners = new Set<Listener>();
  private inFlight = false;
  private activeLabel: string | null = null;

  enqueue<T>(run: () => Promise<T>, options?: EnqueueOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        run,
        resolve,
        reject,
        label: options?.label ?? null,
      };

      if (options?.priority === 'high') {
        this.queue.unshift(item as QueueItem<unknown>);
      } else {
        this.queue.push(item as QueueItem<unknown>);
      }

      this.emit();
      void this.drain();
    });
  }

  /**
   * Force-reset the queue: reject all pending items and unlock inFlight so the
   * queue can accept new work immediately (e.g. after the user clicks Stop).
   */
  forceReset(reason = 'Queue reset by user'): void {
    const abortErr = new DOMException(reason, 'AbortError');
    // Drain and reject all waiting items
    let item = this.queue.shift();
    while (item) {
      item.reject(abortErr);
      item = this.queue.shift();
    }
    this.inFlight = false;
    this.activeLabel = null;
    this.emit();
  }

  getSnapshot(): ChatQueueSnapshot {
    return {
      inFlight: this.inFlight,
      pending: this.queue.length,
      activeLabel: this.activeLabel,
    };
  }

  onDidChange(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private async drain(): Promise<void> {
    if (this.inFlight) {
      return;
    }

    while (this.queue.length > 0) {
      // Shift the item BEFORE setting inFlight so a null result never locks the queue.
      const item = this.queue.shift();
      if (!item) {
        break;
      }

      this.inFlight = true;
      this.activeLabel = item.label;
      this.emit();

      try {
        const result = await item.run();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      } finally {
        this.activeLabel = null;
        this.inFlight = false;
        this.emit();
      }
    }
  }
}

export function createChatRequestQueue(): ChatRequestQueue {
  return new ChatRequestQueue();
}
