import React, { createContext, useContext, useEffect, useState } from 'react';
import { ClientMessageType } from '@netstream/shared';
import { useAuth } from '../features/auth/AuthContext';
import { WsClient, WsStatus } from './ws';

interface WsContextValue {
  client: WsClient;
  status: WsStatus;
  request: <T = unknown>(t: ClientMessageType | string, d?: unknown) => Promise<T>;
  send: (t: ClientMessageType | string, d?: unknown) => void;
}

const WsContext = createContext<WsContextValue | null>(null);

export const WsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [client] = useState(() => new WsClient());
  const [status, setStatus] = useState<WsStatus>(client.getStatus());

  useEffect(() => {
    const unsub = client.on('status', (newStatus: WsStatus) => {
      setStatus(newStatus);
    });

    void client.connect();

    return () => {
      unsub();
      client.disconnect();
    };
  }, [client, user?.id]);

  const value: WsContextValue = {
    client,
    status,
    request: (t, d) => client.request(t, d),
    send: (t, d) => client.send(t, d),
  };

  return (
    <WsContext.Provider value={value}>
      {children}
      {/* Dev-only status indicator badge + recovery test trigger */}
      {import.meta.env.DEV && (
        <div className="fixed bottom-2 left-2 z-50 flex items-center gap-1.5">
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium shadow-md border backdrop-blur-sm ${
              status === 'open'
                ? 'bg-emerald-950/80 border-emerald-600/50 text-emerald-300'
                : status === 'reconnecting'
                  ? 'bg-amber-950/80 border-amber-600/50 text-amber-300'
                  : status === 'connecting'
                    ? 'bg-blue-950/80 border-blue-600/50 text-blue-300'
                    : 'bg-rose-950/80 border-rose-600/50 text-rose-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                status === 'open'
                  ? 'bg-emerald-400'
                  : status === 'reconnecting'
                    ? 'bg-amber-400 animate-pulse'
                    : status === 'connecting'
                      ? 'bg-blue-400 animate-pulse'
                      : 'bg-rose-400'
              }`}
            />
            <span>WS: {status}</span>
            {status === 'open' && (
              <button
                type="button"
                onClick={() => client.simulateDisconnect()}
                title="Simulate WebSocket disconnect to test recovery"
                className="ml-1 px-1.5 py-0.5 rounded bg-rose-900/70 hover:bg-rose-700 text-rose-200 border border-rose-600/50 text-[10px] font-sans transition-colors cursor-pointer"
              >
                Drop WS
              </button>
            )}
          </div>
        </div>
      )}
    </WsContext.Provider>
  );
};

export const useWs = (): WsContextValue => {
  const context = useContext(WsContext);
  if (!context) {
    throw new Error('useWs must be used within a WsProvider');
  }
  return context;
};
