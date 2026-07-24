import {
  TaskByteBudget,
  consumeResourceBodyWithLimits,
  parseContentLength,
  type ResourceBodyReader,
  type ResourceBodySink,
} from '@sitecapsule/download';
import { describe, expect, it, vi } from 'vitest';

function headers(contentLength?: string) {
  return {
    get: (name: string) =>
      name.toLowerCase() === 'content-length' ? (contentLength ?? null) : null,
  };
}

function body(...sizes: number[]) {
  const chunks = sizes.map((size) => new Uint8Array(size));
  let index = 0;
  const cancel = vi.fn();
  const reader: ResourceBodyReader = {
    read: async () =>
      index < chunks.length
        ? { done: false, value: chunks[index++] }
        : { done: true, value: undefined },
    cancel,
  };
  return { source: { getReader: () => reader }, cancel };
}

function sink() {
  const chunks: Uint8Array[] = [];
  const target: ResourceBodySink = {
    write: async (chunk) => {
      chunks.push(chunk);
    },
    close: vi.fn(),
    abort: vi.fn(),
  };
  return { target, chunks };
}

function expectLimit(error: unknown, field: string) {
  expect(error).toMatchObject({
    details: {
      code: 'resource-limit-exceeded',
      retryable: false,
      context: { operation: 'resource-download', field },
    },
  });
}

describe('resource size limits', () => {
  it.each([
    ['0', 0],
    [' 42 ', 42],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('parses valid Content-Length %s', (value, expected) => {
    expect(parseContentLength(value)).toBe(expected);
  });

  it.each([null, undefined, '', '-1', '+1', '1.5', '1, 1', 'abc', '9007199254740992'])(
    'treats missing or invalid Content-Length %s as unknown',
    (value) => {
      expect(parseContentLength(value)).toBeNull();
    },
  );

  it('accepts an exact file limit and commits the actual byte length', async () => {
    const stream = body(2, 3);
    const target = sink();
    const budget = new TaskByteBudget(10);

    await expect(
      consumeResourceBodyWithLimits(
        { headers: headers('5'), body: stream.source },
        { budget, maxFileSizeBytes: 5, sink: target.target },
      ),
    ).resolves.toEqual({ byteLength: 5, declaredByteLength: 5 });
    expect(target.chunks.map((chunk) => chunk.byteLength)).toEqual([2, 3]);
    expect(budget.snapshot()).toEqual({
      maxBytes: 10,
      committedBytes: 5,
      reservedBytes: 0,
      availableBytes: 5,
    });
  });

  it('rejects a declared file that is one byte over before opening the body', async () => {
    const getReader = vi.fn();
    const budget = new TaskByteBudget(100);

    try {
      await consumeResourceBodyWithLimits(
        { headers: headers('6'), body: { getReader } },
        { budget, maxFileSizeBytes: 5, sink: sink().target },
      );
      throw new Error('Expected the file limit to reject.');
    } catch (error) {
      expectLimit(error, 'maxFileSizeBytes');
    }
    expect(getReader).not.toHaveBeenCalled();
    expect(budget.snapshot().reservedBytes).toBe(0);
  });

  it('enforces the real chunked size when Content-Length is missing or understated', async () => {
    for (const declared of [undefined, '3']) {
      const stream = body(3, 3);
      const target = sink();
      const budget = new TaskByteBudget(100);
      try {
        await consumeResourceBodyWithLimits(
          { headers: headers(declared), body: stream.source },
          { budget, maxFileSizeBytes: 5, sink: target.target },
        );
        throw new Error('Expected the streamed file limit to reject.');
      } catch (error) {
        expectLimit(error, 'maxFileSizeBytes');
      }
      expect(target.chunks).toHaveLength(1);
      expect(stream.cancel).toHaveBeenCalledOnce();
      expect(target.target.abort).toHaveBeenCalledOnce();
      expect(budget.snapshot()).toMatchObject({ committedBytes: 0, reservedBytes: 0 });
    }
  });

  it('treats invalid Content-Length as unknown and streams to the actual length', async () => {
    const budget = new TaskByteBudget(10);
    const target = sink();
    await expect(
      consumeResourceBodyWithLimits(
        { headers: headers('not-a-size'), body: body(2, 2).source },
        { budget, maxFileSizeBytes: 5, sink: target.target },
      ),
    ).resolves.toEqual({ byteLength: 4, declaredByteLength: null });
    expect(budget.snapshot().committedBytes).toBe(4);
  });

  it('rejects a declared body that exceeds remaining task budget before reading', async () => {
    const getReader = vi.fn();
    const budget = new TaskByteBudget(10, 7);
    try {
      await consumeResourceBodyWithLimits(
        { headers: headers('4'), body: { getReader } },
        { budget, maxFileSizeBytes: null, sink: sink().target },
      );
      throw new Error('Expected the task limit to reject.');
    } catch (error) {
      expectLimit(error, 'maxTotalSizeBytes');
    }
    expect(getReader).not.toHaveBeenCalled();
    expect(budget.snapshot()).toMatchObject({ committedBytes: 7, reservedBytes: 0 });
  });

  it('accepts the exact remaining task budget and rejects one additional streamed byte', async () => {
    const budget = new TaskByteBudget(5);
    await expect(
      consumeResourceBodyWithLimits(
        { headers: headers(), body: body(2, 3).source },
        { budget, maxFileSizeBytes: null, sink: sink().target },
      ),
    ).resolves.toEqual({ byteLength: 5, declaredByteLength: null });

    try {
      await consumeResourceBodyWithLimits(
        { headers: headers(), body: body(1).source },
        { budget, maxFileSizeBytes: null, sink: sink().target },
      );
      throw new Error('Expected the task limit to reject one extra byte.');
    } catch (error) {
      expectLimit(error, 'maxTotalSizeBytes');
    }
    expect(budget.snapshot()).toEqual({
      maxBytes: 5,
      committedBytes: 5,
      reservedBytes: 0,
      availableBytes: 0,
    });
  });

  it('releases unused declared bytes and commits a shorter actual body', async () => {
    const budget = new TaskByteBudget(20);
    await consumeResourceBodyWithLimits(
      { headers: headers('10'), body: body(4).source },
      { budget, maxFileSizeBytes: null, sink: sink().target },
    );
    expect(budget.snapshot()).toMatchObject({ committedBytes: 4, reservedBytes: 0 });
  });

  it('reserves task budget atomically across concurrent resources', async () => {
    let releaseFirst!: () => void;
    const firstRead = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstReader: ResourceBodyReader = {
      read: vi
        .fn()
        .mockImplementationOnce(async () => {
          await firstRead;
          return { done: false, value: new Uint8Array(6) };
        })
        .mockResolvedValueOnce({ done: true }),
    };
    const budget = new TaskByteBudget(10);
    const first = consumeResourceBodyWithLimits(
      { headers: headers('6'), body: { getReader: () => firstReader } },
      { budget, maxFileSizeBytes: null, sink: sink().target },
    );
    expect(budget.snapshot().reservedBytes).toBe(6);

    await expect(
      consumeResourceBodyWithLimits(
        { headers: headers('5'), body: body(5).source },
        { budget, maxFileSizeBytes: null, sink: sink().target },
      ),
    ).rejects.toMatchObject({ details: { context: { field: 'maxTotalSizeBytes' } } });
    expect(budget.snapshot().reservedBytes).toBe(6);

    releaseFirst();
    await expect(first).resolves.toEqual({ byteLength: 6, declaredByteLength: 6 });
    expect(budget.snapshot()).toMatchObject({ committedBytes: 6, reservedBytes: 0 });
  });

  it('releases reservations when the sink fails', async () => {
    const failure = new Error('sink failed');
    const abort = vi.fn();
    const budget = new TaskByteBudget(10);
    await expect(
      consumeResourceBodyWithLimits(
        { headers: headers('5'), body: body(5).source },
        {
          budget,
          maxFileSizeBytes: null,
          sink: { write: () => Promise.reject(failure), close: vi.fn(), abort },
        },
      ),
    ).rejects.toBe(failure);
    expect(abort).toHaveBeenCalledWith(failure);
    expect(budget.snapshot()).toMatchObject({ committedBytes: 0, reservedBytes: 0 });
  });

  it('cancels the reader, aborts the sink, and releases budget on external abort', async () => {
    const controller = new AbortController();
    const read = new Promise<{ done: boolean; value?: Uint8Array }>(() => {});
    const cancel = vi.fn();
    const target = sink();
    const budget = new TaskByteBudget(10);
    const execution = consumeResourceBodyWithLimits(
      { headers: headers('5'), body: { getReader: () => ({ read: () => read, cancel }) } },
      {
        budget,
        maxFileSizeBytes: null,
        sink: target.target,
        signal: controller.signal,
      },
    );
    controller.abort('stop');

    await expect(execution).rejects.toBe('stop');
    expect(cancel).toHaveBeenCalledWith('stop');
    expect(target.target.abort).toHaveBeenCalledWith('stop');
    expect(budget.snapshot()).toMatchObject({ committedBytes: 0, reservedBytes: 0 });
  });

  it('supports unlimited file and task settings while retaining safe accounting', async () => {
    const budget = new TaskByteBudget(null);
    await expect(
      consumeResourceBodyWithLimits(
        { headers: headers(), body: body(2, 3, 4).source },
        { budget, maxFileSizeBytes: null, sink: sink().target },
      ),
    ).resolves.toEqual({ byteLength: 9, declaredByteLength: null });
    expect(budget.snapshot()).toEqual({
      maxBytes: null,
      committedBytes: 9,
      reservedBytes: 0,
      availableBytes: null,
    });
  });

  it('handles an empty response body and external abort before reservation', async () => {
    const emptyBudget = new TaskByteBudget(5);
    await expect(
      consumeResourceBodyWithLimits(
        { headers: headers('0'), body: null },
        { budget: emptyBudget, maxFileSizeBytes: 5, sink: sink().target },
      ),
    ).resolves.toEqual({ byteLength: 0, declaredByteLength: 0 });
    expect(emptyBudget.snapshot()).toMatchObject({ committedBytes: 0, reservedBytes: 0 });

    const controller = new AbortController();
    controller.abort('already-stopped');
    const abortedBudget = new TaskByteBudget(5);
    await expect(
      consumeResourceBodyWithLimits(
        { headers: headers('5'), body: body(5).source },
        {
          budget: abortedBudget,
          maxFileSizeBytes: 5,
          sink: sink().target,
          signal: controller.signal,
        },
      ),
    ).rejects.toBe('already-stopped');
    expect(abortedBudget.snapshot()).toMatchObject({ committedBytes: 0, reservedBytes: 0 });
  });

  it('rejects invalid limits and committed counters', () => {
    expect(() => new TaskByteBudget(0)).toThrow(RangeError);
    expect(() => new TaskByteBudget(-1)).toThrow(RangeError);
    expect(() => new TaskByteBudget(5, 6)).toThrow(RangeError);
    expect(() => new TaskByteBudget(null, Number.MAX_SAFE_INTEGER).createLease(1)).toThrow(
      RangeError,
    );
  });
});
