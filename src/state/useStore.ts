import { useCallback, useMemo, useState } from 'react';
import { Store } from './store';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

let toastSeq = 0;

export function useStore() {
  const store = useMemo(() => Store.load(), []);
  const [tick, setTick] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const notify = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastSeq;
    setToasts((list) => [...list, { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const run = useCallback(
    (
      action: () => { ok: boolean; error?: string },
      successText: string,
      pendingText?: string,
    ): boolean => {
      if (pendingText) notify('info', pendingText);
      const result = action();
      refresh();
      if (result.ok) {
        notify('success', successText);
        return true;
      }
      notify('error', result.error || '操作失败');
      return false;
    },
    [notify, refresh],
  );

  return { store, tick, refresh, notify, run, toasts };
}
