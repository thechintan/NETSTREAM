import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChannelDetailDto,
  StreamLivePayload,
  StreamOfflinePayload,
  ViewersCountPayload,
  VodDto,
} from '@netstream/shared';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { ChatPanel } from '../features/chat/ChatPanel';
import { VideoPlayer } from '../features/stream';
import { useAuth } from '../features/auth/AuthContext';
import { useWs } from '../lib/ws';
import { api, ApiError } from '../lib/api';

export const Channel: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const { user } = useAuth();
  const { client } = useWs();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [channel, setChannel] = useState<ChannelDetailDto | null>(null);
  const [viewerCount, setViewerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followLoading, setFollowLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'live' | 'vods'>('live');
  const [vods, setVods] = useState<VodDto[]>([]);
  const [vodsLoading, setVodsLoading] = useState(false);
  const [deletingVodId, setDeletingVodId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchChannel = async () => {
      if (!name) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<ChannelDetailDto>(`/api/channels/${name}`);
        if (isMounted) {
          setChannel(data);
          setViewerCount(data.viewerCount ?? 0);
        }
      } catch (err) {
        if (isMounted) {
          if (err instanceof ApiError && err.status === 404) {
            setError('Channel not found.');
          } else {
            setError('Failed to load channel details.');
          }
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void fetchChannel();

    return () => {
      isMounted = false;
    };
  }, [name, user]);

  // Listen for real-time viewer count updates
  useEffect(() => {
    if (!channel?.id) return;
    let isMounted = true;

    const unsub = client.on<ViewersCountPayload>('viewers.count', (data) => {
      if (isMounted && data.channelId === channel.id) {
        setViewerCount(data.count);
      }
    });

    const unsubLive = client.on<StreamLivePayload>('stream.live', (data) => {
      if (isMounted && data.channelId === channel.id) {
        setChannel((prev) => (prev ? { ...prev, isLive: true } : prev));
      }
    });

    const unsubOffline = client.on<StreamOfflinePayload>('stream.offline', (data) => {
      if (isMounted && data.channelId === channel.id) {
        setChannel((prev) => (prev ? { ...prev, isLive: false } : prev));
      }
    });

    return () => {
      isMounted = false;
      unsub();
      unsubLive();
      unsubOffline();
    };
  }, [channel?.id, client]);

  // Fetch past broadcasts (VODs) for this channel
  useEffect(() => {
    if (!channel?.id) return;
    let isMounted = true;
    setVodsLoading(true);
    api
      .get<VodDto[]>(`/api/channels/${channel.id}/vods`)
      .then((list) => {
        if (isMounted) setVods(list || []);
      })
      .catch(() => {
        if (isMounted) setVods([]);
      })
      .finally(() => {
        if (isMounted) setVodsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [channel?.id]);

  const handleDeleteVod = async (vodId: string) => {
    if (!confirm('Delete this recorded broadcast permanently?')) return;
    setDeletingVodId(vodId);
    try {
      await api.delete(`/api/vods/${vodId}`);
      setVods((prev) => prev.filter((v) => v.id !== vodId));
      showToast('VOD deleted', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete VOD', 'error');
    } finally {
      setDeletingVodId(null);
    }
  };

  const formatVodDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) {
      return `${hrs}:${(mins % 60).toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleToggleFollow = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (!channel) return;
    setFollowLoading(true);

    try {
      if (channel.isFollowing) {
        await api.delete(`/api/channels/${channel.id}/follow`);
        setChannel((prev) =>
          prev
            ? {
                ...prev,
                isFollowing: false,
                followerCount: Math.max(0, prev.followerCount - 1),
              }
            : null
        );
        showToast(`Unfollowed ${channel.name}`, 'info');
      } else {
        await api.post(`/api/channels/${channel.id}/follow`);
        setChannel((prev) =>
          prev
            ? {
                ...prev,
                isFollowing: true,
                followerCount: prev.followerCount + 1,
              }
            : null
        );
        showToast(`Following ${channel.name}!`, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col lg:flex-row gap-5">
        <div className="flex-1 space-y-4">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <div className="flex gap-4 items-center">
            <Skeleton className="w-14 h-14 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
        </div>
        <div className="w-full lg:w-[340px] shrink-0">
          <Skeleton className="h-[520px] w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !channel) {
    return (
      <div className="p-12 text-center max-w-md mx-auto space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-100">{error || 'Channel not found'}</h2>
        <p className="text-sm text-slate-400">
          The channel you are looking for does not exist or has been removed.
        </p>
        <Button variant="secondary" onClick={() => navigate('/')}>
          Browse Channels
        </Button>
      </div>
    );
  }

  const isOwner = user?.username.toLowerCase() === channel.ownerUsername.toLowerCase();

  return (
    <div className="flex flex-col lg:flex-row gap-5">
      {/* Left Column: 16:9 Video Player & Channel Header */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* 16:9 WebRTC Video Player */}
        <VideoPlayer channelId={channel.id} channelName={channel.name} />

        {/* Channel Header */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            <Avatar name={channel.ownerUsername} size="lg" />
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold text-slate-100 truncate">
                  {channel.title}
                </h1>
                {channel.isLive && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    LIVE &bull; {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                <span className="font-semibold text-slate-200">@{channel.ownerUsername}</span>
                <span>•</span>
                {channel.category && (
                  <>
                    <span className="px-2 py-0.5 bg-slate-800 text-indigo-300 font-medium rounded-md">
                      {channel.category.name}
                    </span>
                    <span>•</span>
                  </>
                )}
                <span>{channel.followerCount} {channel.followerCount === 1 ? 'follower' : 'followers'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isOwner ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/settings')}
              >
                Edit Channel
              </Button>
            ) : (
              <Button
                variant={channel.isFollowing ? 'outline' : 'primary'}
                size="sm"
                isLoading={followLoading}
                onClick={() => void handleToggleFollow()}
                className="min-w-[90px]"
              >
                {channel.isFollowing ? 'Following' : 'Follow'}
              </Button>
            )}
          </div>
        </div>

        {/* Channel Tabs: Live / Past broadcasts */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'live'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              About Channel
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('vods')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'vods'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Past broadcasts ({vods.length})
            </button>
          </div>

          {activeTab === 'live' ? (
            <p className="text-xs text-slate-400">
              {channel.isLive
                ? `${channel.name} is currently live streaming "${channel.title}".`
                : `${channel.name} is offline. Check the Past broadcasts tab to watch recent recorded streams.`}
            </p>
          ) : vodsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          ) : vods.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">
              No past broadcasts recorded yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vods.map((vod) => (
                <div
                  key={vod.id}
                  className="bg-slate-950/70 border border-slate-800 rounded-xl overflow-hidden flex flex-col justify-between group hover:border-indigo-500/50 transition"
                >
                  <Link to={`/vod/${vod.id}`} className="block">
                    <div className="relative aspect-video bg-slate-900 flex items-center justify-center">
                      <svg
                        className="w-10 h-10 text-slate-600 group-hover:text-indigo-400 transition"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
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
                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[11px] font-mono text-white">
                        {formatVodDuration(vod.durationS)}
                      </span>
                    </div>
                    <div className="p-3 space-y-1">
                      <p className="text-sm font-semibold text-slate-100 truncate group-hover:text-indigo-300">
                        {vod.title}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {new Date(vod.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </Link>
                  {isOwner && (
                    <div className="px-3 pb-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="danger"
                        isLoading={deletingVodId === vod.id}
                        onClick={() => void handleDeleteVod(vod.id)}
                        className="text-xs"
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: 340px Chat Panel (stacks below on mobile) */}
      <div className="w-full lg:w-[340px] shrink-0 h-[500px] lg:h-[620px]">
        <ChatPanel
          channelId={channel.id}
          channelName={channel.name}
          channelOwnerId={channel.ownerId}
          isMod={channel.isMod}
        />
      </div>
    </div>
  );
};
