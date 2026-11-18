import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  NotificationDto,
  NotifyFollowPayload,
  NotifyLivePayload,
} from '@netstream/shared';
import { api } from '../../lib/api';
import { useWs } from '../../lib/ws';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';

interface NotificationsResponse {
  notifications: NotificationDto[];
  unreadCount: number;
}

export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const { client } = useWs();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await api.get<NotificationsResponse>('/api/notifications');
      setItems(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // ignore transient errors
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    void fetchNotifications();
  }, [user, fetchNotifications]);

  // Listen for real-time notify.live and notify.follow pushes
  useEffect(() => {
    if (!user) return;

    const unsubLive = client.on<NotifyLivePayload>('notify.live', (data) => {
      const dto: NotificationDto = {
        id: data.id,
        userId: user.id,
        type: 'live',
        payload: {
          channelId: data.channelId,
          channelName: data.channelName,
          title: data.title,
          category: data.category,
          ownerUsername: data.ownerUsername,
        },
        readAt: null,
        createdAt: data.createdAt || new Date().toISOString(),
      };

      setItems((prev) => {
        if (prev.some((n) => n.id === dto.id)) return prev;
        return [dto, ...prev].slice(0, 50);
      });
      setUnreadCount((prev) => prev + 1);

      showToast(
        `${data.channelName} is now live: ${data.title}`,
        'info',
        {
          actionLabel: 'Click to watch →',
          durationMs: 6000,
          onClick: () => navigate(`/c/${data.channelName}`),
        }
      );
    });

    const unsubFollow = client.on<NotifyFollowPayload>('notify.follow', (data) => {
      const dto: NotificationDto = {
        id: data.id,
        userId: user.id,
        type: 'follow',
        payload: {
          channelId: data.channelId,
          channelName: data.channelName,
          followerId: data.followerId,
          followerUsername: data.followerUsername,
        },
        readAt: null,
        createdAt: data.createdAt || new Date().toISOString(),
      };

      setItems((prev) => {
        if (prev.some((n) => n.id === dto.id)) return prev;
        return [dto, ...prev].slice(0, 50);
      });
      setUnreadCount((prev) => prev + 1);

      showToast(`${data.followerUsername} followed your channel!`, 'success');
    });

    return () => {
      unsubLive();
      unsubFollow();
    };
  }, [client, user, showToast, navigate]);

  const handleMarkAllRead = async () => {
    try {
      await api.post('/api/notifications/read', { all: true });
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const handleNotificationClick = async (notif: NotificationDto) => {
    setOpen(false);
    if (!notif.readAt) {
      try {
        await api.post('/api/notifications/read', { ids: [notif.id] });
        const now = new Date().toISOString();
        setItems((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, readAt: now } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch {
        // ignore
      }
    }

    const channelName =
      typeof notif.payload.channelName === 'string' ? notif.payload.channelName : null;
    if (notif.type === 'live' && channelName) {
      navigate(`/c/${channelName}`);
    } else if (notif.type === 'follow' && typeof notif.payload.followerUsername === 'string') {
      navigate(`/c/${notif.payload.followerUsername}`);
    }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition focus:outline-none"
        aria-label="Notifications"
        title="Notifications"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center shadow">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-100">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto divide-y divide-slate-800/80">
              {loading && items.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">Loading...</div>
              ) : items.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No notifications yet.
                </div>
              ) : (
                items.map((notif) => {
                  const isUnread = !notif.readAt;
                  const channelName = String(notif.payload.channelName ?? 'Channel');
                  const title = String(notif.payload.title ?? '');
                  const category =
                    typeof notif.payload.category === 'string' ? notif.payload.category : null;
                  const followerUsername = String(notif.payload.followerUsername ?? 'Someone');
                  const timeLabel = new Date(notif.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => void handleNotificationClick(notif)}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-800/70 transition flex items-start gap-2.5 ${
                        isUnread ? 'bg-indigo-950/25' : ''
                      }`}
                    >
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                          isUnread ? 'bg-indigo-400' : 'bg-transparent'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        {notif.type === 'live' ? (
                          <>
                            <p className="text-xs text-slate-200 leading-snug">
                              <span className="font-semibold text-white">{channelName}</span> went
                              live{title ? `: "${title}"` : ''}
                            </p>
                            {category && (
                              <p className="text-[11px] text-indigo-300 mt-0.5">{category}</p>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-slate-200 leading-snug">
                            <span className="font-semibold text-white">{followerUsername}</span>{' '}
                            followed your channel
                          </p>
                        )}
                        <span className="text-[10px] text-slate-500 mt-1 block">{timeLabel}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
