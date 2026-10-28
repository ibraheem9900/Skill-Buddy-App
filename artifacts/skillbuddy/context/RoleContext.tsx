import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { userScopedKey } from '@/lib/addressOwnership';

export type ActiveRole = 'CLIENT' | 'PROVIDER';

interface RoleContextType {
  activeRole: ActiveRole;
  isBothRoles: boolean; // whether the mock user is registered as both client & provider
  setActiveRole: (role: ActiveRole) => void;
  toggleRole: () => void;
}

const ROLE_KEY = 'sb_active_role';

const RoleContext = createContext<RoleContextType>({
  activeRole: 'CLIENT',
  isBothRoles: true,
  setActiveRole: () => {},
  toggleRole: () => {},
});

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activeRole, setActiveRoleState] = useState<ActiveRole>('CLIENT');

  // ACCOUNT SWITCH (same class of bug as the address leak): the role is stored
  // per user id. A shared key let a provider session's "PROVIDER" mode follow
  // the next account onto a client-only profile — and back again.
  const storageKey = userScopedKey(ROLE_KEY, user?.id);

  useEffect(() => {
    // Start from the neutral role, then load THIS account's saved role. The
    // reset covers the switch to an account that never chose one.
    setActiveRoleState('CLIENT');
    let cancelled = false;
    AsyncStorage.getItem(storageKey).then((saved) => {
      if (cancelled) return;
      if (saved === 'CLIENT' || saved === 'PROVIDER') setActiveRoleState(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const setActiveRole = useCallback(
    (role: ActiveRole) => {
      setActiveRoleState(role);
      AsyncStorage.setItem(storageKey, role);
    },
    [storageKey]
  );

  const toggleRole = useCallback(() => {
    setActiveRoleState((prev) => {
      const next = prev === 'CLIENT' ? 'PROVIDER' : 'CLIENT';
      AsyncStorage.setItem(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return (
    <RoleContext.Provider value={{ activeRole, isBothRoles: true, setActiveRole, toggleRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
