import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChannelDetailDto } from '@netstream/shared';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { ChatPanel } from '../features/chat/ChatPanel';
import { useAuth } from '../features/auth/AuthContext';
import { api, ApiError } from '../lib/api';

export const Channel: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [channel, setChannel] = useState<ChannelDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followLoading, setFollowLoading] = useState(false);

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
      {/* Left Column: 16:9 Video Player Placeholder & Channel Header */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* 16:9 Player Placeholder */}
        <div className="relative aspect-video w-full bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center justify-center group">
          {channel.isLive ? (
            <div className="text-center p-6 space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-600/20 text-rose-400 border border-rose-500/30 text-xs font-bold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                Live Broadcast
              </div>
              <h3 className="text-lg font-semibold text-slate-200">
                WebRTC Video Player Placeholder
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Sub-second mediasoup SFU video stream will be rendered here in a future task.
              </p>
            </div>
          ) : (
            <div className="text-center p-6 space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-slate-300">
                {channel.name} is currently offline
              </h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Follow this channel to get notified when {channel.name} goes live next.
              </p>
            </div>
          )}
        </div>

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
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase tracking-wider">
                    LIVE
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
      </div>

      {/* Right Column: 340px Chat Panel (stacks below on mobile) */}
      <div className="w-full lg:w-[340px] shrink-0 h-[500px] lg:h-[620px]">
        <ChatPanel channelId={channel.id} channelName={channel.name} />
      </div>
    </div>
  );
};
