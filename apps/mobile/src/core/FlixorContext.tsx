import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { FlixorMobile, initializeFlixorMobile, type ServerType } from './FlixorMobile';

interface FlixorContextValue {
  flixor: FlixorMobile | null;
  isLoading: boolean;
  error: Error | null;
  isAuthenticated: boolean;
  isConnected: boolean;
  serverType: ServerType;
  refresh: () => Promise<void>;
}

const FlixorContext = createContext<FlixorContextValue>({
  flixor: null,
  isLoading: true,
  error: null,
  isAuthenticated: false,
  isConnected: false,
  serverType: null,
  refresh: async () => {},
});

interface FlixorProviderProps {
  children: React.ReactNode;
}

export function FlixorProvider({ children }: FlixorProviderProps) {
  const [flixor, setFlixor] = useState<FlixorMobile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [authState, setAuthState] = useState({
    isAuthenticated: false,
    isConnected: false,
    serverType: null as ServerType,
  });

  const initialize = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const instance = await initializeFlixorMobile();
      setFlixor(instance);
      setAuthState({
        isAuthenticated: instance.isAuthenticated, // Unified: Plex, Jellyfin, or Emby
        isConnected: instance.isConnected,
        serverType: instance.serverType,
      });
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to initialize'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initialize();
  }, []);

  const refresh = useCallback(async () => {
    if (flixor) {
      setAuthState({
        isAuthenticated: flixor.isAuthenticated, // Unified: Plex, Jellyfin, or Emby
        isConnected: flixor.isConnected,
        serverType: flixor.serverType,
      });
    }
  }, [flixor]);

  const value = useMemo(() => ({
    flixor,
    isLoading,
    error,
    isAuthenticated: authState.isAuthenticated,
    isConnected: authState.isConnected,
    serverType: authState.serverType,
    refresh,
  }), [flixor, isLoading, error, authState.isAuthenticated, authState.isConnected, authState.serverType, refresh]);

  return (
    <FlixorContext.Provider value={value}>
      {children}
    </FlixorContext.Provider>
  );
}

/**
 * Hook to access FlixorMobile instance
 */
export function useFlixor(): FlixorContextValue {
  return useContext(FlixorContext);
}

/**
 * Hook that throws if Flixor is not loaded
 */
export function useRequireFlixor(): FlixorMobile {
  const { flixor, isLoading, error } = useFlixor();

  if (isLoading) {
    throw new Error('Flixor is still loading');
  }

  if (error) {
    throw error;
  }

  if (!flixor) {
    throw new Error('Flixor is not initialized');
  }

  return flixor;
}
