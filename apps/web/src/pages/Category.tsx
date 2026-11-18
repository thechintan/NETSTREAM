import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  CategoryDto,
  LiveChannelDto,
  StreamLivePayload,
  StreamOfflinePayload,
  ViewersCountPayload,
} from '@netstream/shared';
import { Avatar } from '../components/ui/Avatar';
import { Skeleton } from '../components/ui/Skeleton';
import { api } from '../lib/api';
import { useWs } from '../lib/ws';

interface CategoryLiveResponse {
  category: CategoryDto;
  channels: LiveChannelDto[];
}

export const Category: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { client, status, request } = useWs();
  const [category, setCategory] = useState<CategoryDto | null>(null);
  const [channels, setChannels] = useState<LiveChannelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const res = await api.get<CategoryLiveResponse>(`/api/categories/${id}/live`);
        if (active) {
          setCategory(res.category);
          setChannels(res.channels ?? []);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load category');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [id]);

  // Live updates for streams in this category
  useEffect(() => {
    if (!id || status !== 'open') return;
    let active = true;

    void request('user.subscribe', { topics: ['live'] }).catch(() => {});

    const unsubViewers = client.on<ViewersCountPayload>('viewers.count', (data) => {
      if (!active) return;
      setChannels((prev) =>
        [...prev.map((c) => (c.id === data.channelId ? { ...c, viewerCount: data.count } : c))].sort(
          (a, b) => b.viewerCount - a.viewerCount
        )
      );
    });

    const unsubLive = client.on<StreamLivePayload>('stream.live', (data) => {
      if (!active) return;
      if (data.category?.id !== id) return;
      setChannels((prev) => {
        if (prev.some((c) => c.id === data.channelId)) return prev;
        const next: LiveChannelDto = {
          id: data.channelId,
          name: data.channelName || 'streamer',
          title: data.title || 'Live Stream',
          category: data.category
            ? {
                id: data.category.id,
                name: data.category.name,
                thumbnailUrl: data.category.thumbnailUrl ?? null,
              }
            : null,
          ownerUsername: data.ownerUsername || 'streamer',
          viewerCount: data.viewerCount ?? 0,
          startedAt: new Date().toISOString(),
        };
        return [...prev, next].sort((a, b) => b.viewerCount - a.viewerCount);
      });
    });

    const unsubOffline = client.on<StreamOfflinePayload>('stream.offline', (data) => {
      if (!active) return;
      setChannels((prev) => prev.filter((c) => c.id !== data.channelId));
    });

    return () => {
      active = false;
      unsubViewers();
      unsubLive();
      unsubOffline();
    };
  }, [id, client, request, status]);

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-800 pb-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-400 mb-1">
            <Link to="/categories" className="hover:text-indigo-300 transition">
              Categories
            </Link>{' '}
            / <span className="text-slate-200">{category?.name ?? '...'}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            {category?.name ?? 'Category'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {channels.length} live {channels.length === 1 ? 'channel' : 'channels'} streaming now
          </p>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-rose-950/60 border border-rose-500/40 text-rose-200 rounded-xl text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-full rounded-xl" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <p className="text-base font-semibold text-slate-200">
            No live channels in {category?.name ?? 'this category'} right now.
          </p>
          <Link
            to="/categories"
            className="inline-block text-sm text-indigo-400 hover:text-indigo-300 font-medium"
          >
            Browse other categories →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {channels.map((stream) => (
            <Link
              key={stream.id}
              to={`/c/${stream.name}`}
              className="group flex flex-col space-y-2.5 rounded-xl transition hover:opacity-95"
            >
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>

              <div className="flex gap-3 items-start px-0.5">
                <Avatar name={stream.ownerUsername} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-100 truncate group-hover:text-indigo-300">
                    {stream.title}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{stream.name}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
