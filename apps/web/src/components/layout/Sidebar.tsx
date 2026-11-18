import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FollowedChannelDto,
  NotifyLivePayload,
  StreamLivePayload,
  StreamOfflinePayload,
} from '@netstream/shared';
import { useAuth } from '../../features/auth/AuthContext';
import { api } from '../../lib/api';
import { useWs } from '../../lib/ws';
import { Avatar } from '../ui/Avatar';
import { Skeleton } from '../ui/Skeleton';

export interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { client, status, request } = useWs();
  const [following, setFollowing] = useState<FollowedChannelDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    if (!user) {
      setFollowing([]);
      return;
    }

    const fetchFollowing = async () => {
      setIsLoading(true);
      try {
        const list = await api.get<FollowedChannelDto[]>('/api/me/following');
        if (isMounted && list) {
          setFollowing(list);
        }
      } catch {
        if (isMounted) setFollowing([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void fetchFollowing();

    // Poll every 15s to keep live indicators fresh
    const interval = setInterval(fetchFollowing, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [user]);

  // Subscribe to live directory updates so Following list stays live across all pages
  useEffect(() => {
    if (!user || status !== 'open') return;
    void request('user.subscribe', { topics: ['live'] }).catch(() => {});
  }, [user, status, request]);

  // Realtime updates on stream.live, notify.live, and stream.offline for followed channels
  useEffect(() => {
    const markLive = (channelId: string) => {
      setFollowing((prev) =>
        [...prev.map((c) => (c.id === channelId ? { ...c, isLive: true } : c))].sort(
          (a, b) => Number(b.isLive) - Number(a.isLive)
        )
      );
    };

    const unsubLive = client.on<StreamLivePayload>('stream.live', (data) => {
      markLive(data.channelId);
    });

    const unsubNotifyLive = client.on<NotifyLivePayload>('notify.live', (data) => {
      markLive(data.channelId);
    });

    const unsubOffline = client.on<StreamOfflinePayload>('stream.offline', (data) => {
      setFollowing((prev) =>
        [...prev.map((c) => (c.id === data.channelId ? { ...c, isLive: false } : c))].sort(
          (a, b) => Number(b.isLive) - Number(a.isLive)
        )
      );
    });

    return () => {
      unsubLive();
      unsubNotifyLive();
      unsubOffline();
    };
  }, [client]);

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-14 bottom-0 left-0 z-30 w-60 bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-200 md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-3 border-b border-slate-800/80 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Followed Channels
          </span>
          <span className="text-xs text-slate-500 font-medium">
            {user ? following.length : 0}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoading && following.length === 0 ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : !user ? (
            <div className="p-4 text-center text-xs text-slate-400 space-y-2">
              <p>Sign in to see channels you follow and track live streams.</p>
              <Link
                to="/login"
                onClick={onClose}
                className="inline-block text-indigo-400 hover:text-indigo-300 font-medium underline"
              >
                Log in
              </Link>
            </div>
          ) : following.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              You are not following any channels yet. Explore live channels to follow creators!
            </div>
          ) : (
            following.map((channel) => (
              <Link
                key={channel.id}
                to={`/c/${channel.name}`}
                onClick={onClose}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-800/80 transition group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative">
                    <Avatar name={channel.ownerUsername} size="sm" />
                    {channel.isLive && (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-rose-500 border-2 border-slate-900 rounded-full animate-pulse" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-200 truncate group-hover:text-indigo-300">
                      {channel.name}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {channel.category ? channel.category.name : 'No category'}
                    </p>
                  </div>
                </div>

                <div>
                  {channel.isLive ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                      LIVE
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 font-medium">
                      Offline
                    </span>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>
      </aside>
    </>
  );
};
