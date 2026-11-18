import React, { createContext, useCallback, useContext, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  onClick?: () => void;
  actionLabel?: string;
  durationMs?: number;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  onClick?: () => void;
  actionLabel?: string;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', options?: ToastOptions) => {
      const id = Math.random().toString(36).slice(2, 9);
      setToasts((prev) => [
        ...prev,
        {
          id,
          type,
          message,
          onClick: options?.onClick,
          actionLabel: options?.actionLabel,
        },
      ]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, options?.durationMs ?? 4000);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => {
              if (toast.onClick) {
                toast.onClick();
                removeToast(toast.id);
              }
            }}
            className={`pointer-events-auto flex items-center justify-between gap-2 p-3 rounded-lg shadow-lg border text-sm transition-all duration-200 ${
              toast.onClick ? 'cursor-pointer hover:brightness-110' : ''
            } ${
              toast.type === 'success'
                ? 'bg-emerald-950 border-emerald-600/50 text-emerald-100'
                : toast.type === 'error'
                  ? 'bg-rose-950 border-rose-600/50 text-rose-100'
                  : 'bg-slate-800 border-slate-700 text-slate-100'
            }`}
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium block break-words">{toast.message}</span>
              {toast.actionLabel && (
                <span className="text-xs text-indigo-300 font-semibold mt-0.5 block">
                  {toast.actionLabel}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeToast(toast.id);
              }}
              className="ml-2 text-slate-400 hover:text-slate-100 shrink-0"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
