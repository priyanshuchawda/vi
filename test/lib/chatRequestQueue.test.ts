import { describe, expect, it } from 'vitest';
import { createChatRequestQueue } from '../../src/lib/chatRequestQueue';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('chatRequestQueue', () => {
  it('runs requests sequentially in enqueue order', async () => {
    const queue = createChatRequestQueue();
    const order: string[] = [];

    const first = queue.enqueue(async () => {
      order.push('first:start');
      await sleep(10);
      order.push('first:end');
      return 'first';
    });

    const second = queue.enqueue(async () => {
      order.push('second:start');
      await sleep(1);
      order.push('second:end');
      return 'second';
    });

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('supports high-priority requests', async () => {
    const queue = createChatRequestQueue();
    const order: string[] = [];

    const running = queue.enqueue(async () => {
      order.push('running:start');
      await sleep(10);
      order.push('running:end');
      return 'running';
    });

    const normal = queue.enqueue(async () => {
      order.push('normal');
      return 'normal';
    });

    const high = queue.enqueue(
      async () => {
        order.push('high');
        return 'high';
      },
      { priority: 'high' },
    );

    await Promise.all([running, normal, high]);
    expect(order).toEqual(['running:start', 'running:end', 'high', 'normal']);
  });

  it('continues processing after a failed request', async () => {
    const queue = createChatRequestQueue();
    const order: string[] = [];

    const failed = queue.enqueue(async () => {
      order.push('fail:start');
      throw new Error('boom');
    });

    const success = queue.enqueue(async () => {
      order.push('success:start');
      order.push('success:end');
      return 'ok';
    });

    await expect(failed).rejects.toThrow('boom');
    await expect(success).resolves.toBe('ok');
    expect(order).toEqual(['fail:start', 'success:start', 'success:end']);
  });

  it('emits queue snapshots during lifecycle', async () => {
    const queue = createChatRequestQueue();
    const snapshots: Array<{ inFlight: boolean; pending: number; activeLabel: string | null }> =
      [];
    const dispose = queue.onDidChange((snapshot) => snapshots.push(snapshot));

    const run = queue.enqueue(
      async () => {
        await sleep(5);
        return 'done';
      },
      { label: 'first request' },
    );

    await run;
    dispose();

    expect(snapshots.some((s) => s.inFlight && s.activeLabel === 'first request')).toBe(true);
    expect(snapshots[snapshots.length - 1]).toEqual({
      inFlight: false,
      pending: 0,
      activeLabel: null,
    });
  });
});
