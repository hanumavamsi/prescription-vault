/**
 * Web version of app-lock.tsx. Browsers have no Face ID / passcode prompt we can use,
 * so the lock is never available and the provider just renders its children.
 */
import { createContext, useContext, type ReactNode } from 'react';

type AppLockValue = {
  enabled: boolean;
  available: boolean;
  setEnabled(v: boolean): Promise<void>;
};

const value: AppLockValue = {
  enabled: false,
  available: false,
  async setEnabled() {
    throw new Error('App lock is only available in the iPhone and Android app.');
  },
};

const AppLockContext = createContext<AppLockValue | null>(null);

export function AppLockProvider({ children }: { children: ReactNode }) {
  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used inside <AppLockProvider>');
  return ctx;
}
