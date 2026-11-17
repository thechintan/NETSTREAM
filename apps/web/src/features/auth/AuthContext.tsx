import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  AuthResponse,
  ChannelDto,
  LoginInput,
  MeResponse,
  RegisterInput,
  UserDto,
} from '@netstream/shared';
import { api, setAccessToken } from '../../lib/api';

interface AuthContextValue {
  user: UserDto | null;
  channel: ChannelDto | null;
  isLoading: boolean;
  login: (credentials: LoginInput) => Promise<void>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserDto | null>(null);
  const [channel, setChannel] = useState<ChannelDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCurrentUser = async () => {
    try {
      const data = await api.get<MeResponse>('/api/me');
      if (data) {
        setUser(data.user);
        setChannel(data.channel);
      }
    } catch {
      setUser(null);
      setChannel(null);
    }
  };

  // Silent refresh on app start through the refresh cookie
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      try {
        const token = await api.refreshSession();
        if (token && isMounted) {
          await fetchCurrentUser();
        }
      } catch {
        if (isMounted) {
          setUser(null);
          setChannel(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (credentials: LoginInput) => {
    const res = await api.post<AuthResponse>('/api/auth/login', credentials, {
      skipAuth: true,
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
    await fetchCurrentUser();
  };

  const register = async (data: RegisterInput) => {
    const res = await api.post<AuthResponse>('/api/auth/register', data, {
      skipAuth: true,
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
    await fetchCurrentUser();
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
      setChannel(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        channel,
        isLoading,
        login,
        register,
        logout,
        refreshUser: fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
