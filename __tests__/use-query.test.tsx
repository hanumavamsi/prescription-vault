import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useQuery } from '@/hooks/use-query';

// Screens are always focused in these tests.
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (cb: () => void) => useEffect(() => cb(), [cb]) };
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useQuery', () => {
  it('loads data on focus', async () => {
    const { result } = await renderHook(() => useQuery(async () => 'hello'));
    await waitFor(() => expect(result.current.data).toBe('hello'));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('reports errors as messages', async () => {
    const { result } = await renderHook(() =>
      useQuery(async () => {
        throw new Error('offline');
      }),
    );
    await waitFor(() => expect(result.current.error).toBe('offline'));
    expect(result.current.data).toBeUndefined();
  });

  it('keeps previous data when a refresh fails', async () => {
    let fail = false;
    const { result } = await renderHook(() =>
      useQuery(async () => {
        if (fail) throw new Error('offline');
        return 'cached';
      }),
    );
    await waitFor(() => expect(result.current.data).toBe('cached'));
    fail = true;
    await act(() => result.current.refresh());
    expect(result.current.data).toBe('cached');
    expect(result.current.error).toBe('offline');
  });

  it("never shows one profile's data under another's (stale response dropped)", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useQuery(() => (id === 'a' ? slow.promise : fast.promise), [id]),
      { initialProps: { id: 'a' } },
    );
    await rerender({ id: 'b' });
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);

    await act(async () => fast.resolve('B docs'));
    await act(async () => slow.resolve('A docs')); // arrives late; must be ignored
    expect(result.current.data).toBe('B docs');
  });
});
