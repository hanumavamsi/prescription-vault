import { useFocusEffect } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Loads data when the screen gains focus (so lists refresh after returning from a modal).
 * Keeps showing the previous data while refreshing. When `deps` change, previous data is
 * dropped so one profile's records are never shown under another's header.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<{ key: string; data?: T; error: string | null }>({ key, error: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn);
  const requestId = useRef(0);

  useLayoutEffect(() => {
    fnRef.current = fn;
  });

  const run = useCallback(
    async (isRefresh: boolean) => {
      const id = ++requestId.current;
      if (isRefresh) setRefreshing(true);
      try {
        const data = await fnRef.current();
        if (id === requestId.current) setState({ key, data, error: null });
      } catch (e) {
        if (id === requestId.current) {
          const error = e instanceof Error ? e.message : String(e);
          setState((s) => (s.key === key ? { ...s, error } : { key, error }));
        }
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [key],
  );

  useFocusEffect(
    useCallback(() => {
      run(false);
    }, [run]),
  );

  const current = state.key === key ? state : null;
  const setData = useCallback(
    (update: T | undefined | ((prev: T | undefined) => T | undefined)) =>
      setState((s) => ({
        ...s,
        data: typeof update === 'function' ? (update as (prev: T | undefined) => T | undefined)(s.data) : update,
      })),
    [],
  );

  return {
    data: current?.data,
    error: current?.error ?? null,
    loading: loading || !current,
    refreshing,
    refresh: () => run(true),
    setData,
  };
}
