/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User } from '../../domain/models.js';
import { apiClient } from '../apiClient.js';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  readonly user: User | null;
  readonly status: AuthStatus;
  readonly login: (username: string, password: string) => Promise<void>;
  readonly register: (params: { challengeId: string; code: string; password: string }) => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ readonly children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiClient.getMe();
      setUser(res.user);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    // Initial authentication probe
    refreshUser();
  }, [refreshUser]);

  const login = async (username: string, password: string) => {
    const res = await apiClient.login(username, password);
    setUser(res.user);
    setStatus('authenticated');
  };

  const register = async (params: { challengeId: string; code: string; password: string }) => {
    const res = await apiClient.register(params);
    setUser(res.user);
    setStatus('authenticated');
  };

  const logout = async () => {
    try {
      await apiClient.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
