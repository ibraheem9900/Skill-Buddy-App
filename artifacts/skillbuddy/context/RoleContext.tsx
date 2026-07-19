import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  const [activeRole, setActiveRoleState] = useState<ActiveRole>('CLIENT');

  useEffect(() => {
    AsyncStorage.getItem(ROLE_KEY).then((saved) => {
      if (saved === 'CLIENT' || saved === 'PROVIDER') setActiveRoleState(saved);
    });
  }, []);

  const setActiveRole = useCallback((role: ActiveRole) => {
    setActiveRoleState(role);
    AsyncStorage.setItem(ROLE_KEY, role);
  }, []);

  const toggleRole = useCallback(() => {
    setActiveRoleState((prev) => {
      const next = prev === 'CLIENT' ? 'PROVIDER' : 'CLIENT';
      AsyncStorage.setItem(ROLE_KEY, next);
      return next;
    });
  }, []);

  return (
    <RoleContext.Provider value={{ activeRole, isBothRoles: true, setActiveRole, toggleRole }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
