import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Hls from 'hls.js';
import type { VodDto } from '@netstream/shared';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../features/auth/AuthContext';
import { api, ApiError } from '../lib/api';

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const secs = Math.floor(totalSeconds);
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const rem = secs % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  }
  return `${mins}:${rem.toString().padStart(2, '0')}`;
}

export const Vod: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [vod, setVod] = useState<VodDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setError(null);

    const loadVod = async () => {
      try {
        const data = await api.get<VodDto>(`/api/vods/${id}`);
        if (active) {
          setVod(data);
          setDuration(data.durationS || 0);
        }
      } catch (err) {
        if (active) {
          if (err instanceof ApiError && err.status === 404) {
            setError('VOD not found.');
          } else {
            setError('Failed to load VOD.');
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadVod();
    return () => {
      active = false;
    };
  }, [id]);

  // Attach hls.js or Safari native HLS
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !vod) return;

    setPlaybackError(null);

    const cleanup = () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          // ignore
        }
        hlsRef.current = null;
      }
    };

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          setPlaybackError('Failed to load VOD playlist or segments.');
        }
      });

      hls.loadSource(vod.playlistUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = vod.playlistUrl;
    } else {
      setPlaybackError('HLS playback is not supported in this browser.');
    }

    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      cleanup();
    };
  }, [vod]);

  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
    }
    setCurrentTime(nextTime);
  }, []);

  const handleSkip = useCallback((deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const maxDur = Number.isFinite(video.duration) ? video.duration : duration;
    const target = Math.max(0, Math.min(maxDur, video.currentTime + deltaSeconds));
    video.currentTime = target;
    setCurrentTime(target);
  }, [duration]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  }, []);

  const handleDelete = async () => {
    if (!vod) return;
    if (!confirm('Delete this recorded broadcast permanently?')) return;
    setDeleting(true);
    try {
      await api.delete(`/api/vods/${vod.id}`);
      showToast('VOD deleted', 'info');
      navigate(`/c/${vod.channelName}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete VOD', 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !vod) {
    return (
      <div className="p-12 text-center max-w-md mx-auto space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{error || 'VOD not found'}</h2>
        <Button variant="secondary" onClick={() => navigate('/')}>
          Back to Home
        </Button>
      </div>
    );
  }

  const isOwner = Boolean(
    user &&
      ((vod.ownerId && user.id === vod.ownerId) ||
        user.username.toLowerCase() === vod.ownerUsername.toLowerCase())
  );
  const recordedDate = new Date(vod.createdAt).toLocaleString();

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* HLS VOD Player with Seek Controls */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="relative aspect-video bg-black flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            onClick={handleTogglePlay}
            className="w-full h-full object-contain cursor-pointer"
          />
          {playbackError && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6 text-center">
              <p className="text-sm text-amber-300">{playbackError}</p>
            </div>
          )}
        </div>

        {/* Custom Seek & Transport Bar */}
        <div className="p-3.5 bg-slate-900 border-t border-slate-800 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-300 w-12 text-right">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 1)}
              step={0.5}
              value={Math.min(currentTime, Math.max(duration, 1))}
              onChange={handleSeek}
              aria-label="Seek timeline"
              className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <span className="text-xs font-mono text-slate-400 w-12">
              {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={handleTogglePlay}>
                {isPlaying ? 'Pause' : 'Play'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleSkip(-10)}>
                -10s
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleSkip(10)}>
                +10s
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{isMuted ? 'Muted' : 'Vol'}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
                className="w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Metadata Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-4 min-w-0">
          <Link to={`/c/${vod.channelName}`}>
            <Avatar name={vod.ownerUsername} size="lg" />
          </Link>
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg sm:text-xl font-bold text-slate-100 break-words">
              {vod.title}
            </h1>
            <div className="flex items-center gap-2.5 text-xs text-slate-400 flex-wrap">
              <Link
                to={`/c/${vod.channelName}`}
                className="font-semibold text-indigo-300 hover:text-indigo-200"
              >
                @{vod.channelName}
              </Link>
              <span>•</span>
              <span>Recorded {recordedDate}</span>
              <span>•</span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-mono">
                {formatTime(vod.durationS)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link to={`/c/${vod.channelName}`}>
            <Button size="sm" variant="secondary">
              Back to Channel
            </Button>
          </Link>
          {isOwner && (
            <Button
              size="sm"
              variant="danger"
              isLoading={deleting}
              onClick={() => void handleDelete()}
            >
              Delete VOD
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
