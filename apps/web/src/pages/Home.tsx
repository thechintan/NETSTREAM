import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LiveChannelDto,
  StreamLivePayload,
  StreamOfflinePayload,
  ViewersCountPayload,
} from '@netstream/shared';
import { Avatar } from '../components/ui/Avatar';
import { Skeleton } from '../components/ui/Skeleton';
import { api } from '../lib/api';
import { useWs } from '../lib/ws';

export const Home: React.FC = () => {
  const [liveChannels, setLiveChannels] = useState<LiveChannelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { client, status, request } = useWs();

  useEffect(() => {
    let isMounted = true;

    const fetchLive = async () => {
      try {
        const data = await api.get<LiveChannelDto[]>('/api/live');
        if (isMounted) {
          setLiveChannels(data || []);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load live channels');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void fetchLive();
    return () => {
      isMounted = false;
    };
  }, []);

  // Subscribe to live directory room via user.subscribe { topics: ['live'] }
  useEffect(() => {
    if (status !== 'open') return;
    let isMounted = true;

    void request('user.subscribe', { topics: ['live'] }).catch(() => {
      // Ignore subscription errors
    });

    // Listen for viewers.count events
    const unsubViewers = client.on<ViewersCountPayload>('viewers.count', (data) => {
      if (!isMounted) return;
      setLiveChannels((prev) =>
        prev.map((c) => (c.id === data.channelId ? { ...c, viewerCount: data.count } : c))
      );
    });

    // Listen for stream.live events
    const unsubLive = client.on<StreamLivePayload>('stream.live', (data) => {
      if (!isMounted) return;
      const formattedCategory = data.category
        ? {
            id: data.category.id,
            name: data.category.name,
            thumbnailUrl: data.category.thumbnailUrl ?? null,
          }
        : null;

      setLiveChannels((prev) => {
        const exists = prev.some((c) => c.id === data.channelId);
        if (exists) {
          return prev.map((c) =>
            c.id === data.channelId
              ? {
                  ...c,
                  title: data.title || c.title,
                  category: data.category !== undefined ? formattedCategory : c.category,
                  viewerCount: data.viewerCount !== undefined ? data.viewerCount : c.viewerCount,
                }
              : c
          );
        }

        const newChannel: LiveChannelDto = {
          id: data.channelId,
          name: data.channelName || 'streamer',
          title: data.title || 'Live Stream',
          category: formattedCategory,
          ownerUsername: data.ownerUsername || 'streamer',
          viewerCount: data.viewerCount ?? 1,
          startedAt: new Date().toISOString(),
        };
        return [newChannel, ...prev];
      });
    });

    // Listen for stream.offline events
    const unsubOffline = client.on<StreamOfflinePayload>('stream.offline', (data) => {
      if (!isMounted) return;
      setLiveChannels((prev) => prev.filter((c) => c.id !== data.channelId));
    });

    return () => {
      isMounted = false;
      unsubViewers();
      unsubLive();
      unsubOffline();
    };
  }, [client, request, status]);

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Live Channels</h1>
        <p className="text-sm text-slate-400 mt-1">
          Explore sub-second live broadcasts on NetStream Live.
        </p>
      </header>

      {error && (
        <div className="p-4 bg-rose-950/60 border border-rose-500/40 text-rose-200 rounded-xl text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <div className="flex gap-3">
                <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : liveChannels.length === 0 ? (
        <div className="py-16 text-center space-y-4 max-w-md mx-auto">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-slate-200">No channels are live right now</h3>
            <p className="text-sm text-slate-400">
              When streamers go live from the browser, their broadcasts will appear here in real time.
            </p>
          </div>
          <div className="pt-2">
            <Link
              to="/studio"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition"
            >
              Start Streaming
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {liveChannels.map((stream) => (
            <Link
              key={stream.id}
              to={`/c/${stream.name}`}
              className="group flex flex-col space-y-2.5 rounded-xl transition hover:opacity-95"
            >
              {/* 16:9 Thumbnail placeholder */}
              <div className="relative aspect-video w-full rounded-xl bg-slate-900 border border-slate-800 overflow-hidden flex items-center justify-center group-hover:border-indigo-500/50 transition">
                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-600 text-white text-xs font-bold uppercase tracking-wider shadow">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  LIVE
                </div>

                <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[11px] font-medium text-white flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {stream.viewerCount || 0} {stream.viewerCount === 1 ? 'viewer' : 'viewers'}
                </div>

                <div className="text-slate-600 group-hover:text-indigo-400 transition">
                  <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                    />
                  </svg>
                </div>
              </div>

              {/* Streamer metadata */}
              <div className="flex gap-3 px-1">
                <Avatar name={stream.ownerUsername} size="md" />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-slate-100 truncate group-hover:text-indigo-400 transition">
                    {stream.title}
                  </h4>
                  <p className="text-xs text-slate-400 truncate">{stream.ownerUsername}</p>
                  {stream.category && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-[11px] font-medium bg-slate-800 text-slate-300 rounded-md">
                      {stream.category.name}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
