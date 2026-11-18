import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { Button } from '../../components/ui/Button';
import { StatsOverlay } from '../lab';
import { useViewer, type QualityOption } from './useViewer';

export interface VideoPlayerProps {
  channelId?: string;
  channelName?: string;
}

type PlaybackMode = 'webrtc' | 'hls';

const QUALITY_OPTIONS: QualityOption[] = ['Auto', '720p', '360p', '180p'];
const ICE_FALLBACK_TIMEOUT_MS = 8000;

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  channelId,
  channelName = 'Streamer',
}) => {
  const { status, error, mediaStream, quality, setQuality, activeLayers, getStats, retry } =
    useViewer({
      channelId,
    });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('webrtc');
  const [hlsStatus, setHlsStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [hlsError, setHlsError] = useState<string | null>(null);

  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset to WebRTC default whenever channelId changes
  useEffect(() => {
    setPlaybackMode('webrtc');
    setHlsStatus('idle');
    setHlsError(null);
  }, [channelId]);

  // Automatic HLS fallback if WebRTC ICE has not connected within 8 seconds
  useEffect(() => {
    if (playbackMode !== 'webrtc' || !channelId) return;
    if (status !== 'connecting') return;

    const timer = setTimeout(() => {
      setPlaybackMode('hls');
    }, ICE_FALLBACK_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [playbackMode, status, channelId]);

  // Return to offline cleanly if channel goes offline while in HLS mode
  useEffect(() => {
    if (status === 'offline' && playbackMode === 'hls') {
      setPlaybackMode('webrtc');
      setHlsStatus('idle');
      setHlsError(null);
    }
  }, [status, playbackMode]);

  // Toggle stats overlay with 'S' key (ignoring inputs/textareas/selects)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 's' && e.key !== 'S') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setStatsVisible((prev) => !prev);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Manage HLS.js / Safari native HLS playback when in Compatibility mode
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const cleanupHls = () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          // ignore
        }
        hlsRef.current = null;
      }
    };

    if (playbackMode !== 'hls' || !channelId) {
      cleanupHls();
      return;
    }

    const hlsUrl = `/hls/${encodeURIComponent(channelId)}/index.m3u8`;
    video.srcObject = null;
    video.muted = isMuted;
    video.volume = volume;
    setHlsStatus('loading');
    setHlsError(null);

    const onPlaying = () => setHlsStatus('playing');
    video.addEventListener('playing', onPlaying);

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        maxLiveSyncPlaybackRate: 1.5,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setHlsStatus('playing');
        video.play().catch(() => {
          // Ignore browser autoplay rejection
        });
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          setHlsStatus('error');
          setHlsError(
            data.type === Hls.ErrorTypes.NETWORK_ERROR
              ? 'HLS stream is not yet available (FFmpeg may be starting or disabled).'
              : 'HLS playback encountered a fatal error.'
          );
        }
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS playback
      const onError = () => {
        setHlsStatus('error');
        setHlsError('Unable to load native HLS playlist.');
      };
      video.addEventListener('error', onError);
      video.src = hlsUrl;
      video.play().catch(() => {
        // Ignore browser autoplay rejection
      });

      return () => {
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        video.removeAttribute('src');
        video.load();
      };
    } else {
      setHlsStatus('error');
      setHlsError('HLS playback is not supported in this browser.');
    }

    return () => {
      video.removeEventListener('playing', onPlaying);
      cleanupHls();
    };
  }, [playbackMode, channelId]);

  // Keep muted/volume synced in HLS mode without recreating HLS instance
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playbackMode !== 'hls') return;
    video.muted = isMuted;
    video.volume = volume;
  }, [isMuted, volume, playbackMode]);

  // Attach WebRTC MediaStream to HTMLVideoElement without destroying the video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playbackMode !== 'webrtc') return;

    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
    }

    if (mediaStream) {
      if (video.srcObject !== mediaStream) {
        video.srcObject = mediaStream;
      }
      video.muted = isMuted;
      video.volume = volume;
      video.play().catch(() => {
        // Ignore browser autoplay rejection
      });
    } else if (status === 'offline' || status === 'failed') {
      video.srcObject = null;
      setResolution(null);
    }
  }, [mediaStream, isMuted, volume, status, playbackMode]);

  // Track received video resolution
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateResolution = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setResolution({ width: video.videoWidth, height: video.videoHeight });
      }
    };

    video.addEventListener('loadedmetadata', updateResolution);
    video.addEventListener('resize', updateResolution);
    updateResolution();

    return () => {
      video.removeEventListener('loadedmetadata', updateResolution);
      video.removeEventListener('resize', updateResolution);
    };
  }, [mediaStream, playbackMode]);

  const switchToWebRtc = useCallback(() => {
    setPlaybackMode('webrtc');
    setHlsStatus('idle');
    setHlsError(null);
    setQualityMenuOpen(false);
    if (status !== 'playing') {
      retry();
    }
  }, [status, retry]);

  const switchToHls = useCallback(() => {
    setPlaybackMode('hls');
    setQualityMenuOpen(false);
  }, []);

  // Handle unmute click
  const handleUnmute = useCallback(() => {
    setIsMuted(false);
    if (videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current.volume = volume > 0 ? volume : 0.8;
      if (volume === 0) setVolume(0.8);
    }
  }, [volume]);

  // Volume toggle
  const handleToggleMute = useCallback(() => {
    if (isMuted) {
      setIsMuted(false);
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = volume > 0 ? volume : 0.8;
      }
    } else {
      setIsMuted(true);
      if (videoRef.current) {
        videoRef.current.muted = true;
      }
    }
  }, [isMuted, volume]);

  // Volume slider change
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (newVol === 0) {
      setIsMuted(true);
      if (videoRef.current) videoRef.current.muted = true;
    } else {
      setIsMuted(false);
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = newVol;
      }
    }
  }, []);

  // Fullscreen toggle
  const handleToggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      try {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch {
        // ignore fullscreen failure
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const isActivelyPlaying =
    (playbackMode === 'webrtc' && status === 'playing') ||
    (playbackMode === 'hls' && hlsStatus === 'playing');

  // Controls auto-hide on mouse movement
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = setTimeout(() => {
      if (isActivelyPlaying && !qualityMenuOpen) {
        setShowControls(false);
      }
    }, 3000);
  }, [isActivelyPlaying, qualityMenuOpen]);

  const showVideoElement =
    (playbackMode === 'webrtc' && (status === 'playing' || status === 'reconnecting')) ||
    (playbackMode === 'hls' && hlsStatus !== 'error');

  const layerLabel =
    playbackMode === 'webrtc' && activeLayers
      ? `S${activeLayers.spatialLayer}${activeLayers.temporalLayer !== undefined ? `T${activeLayers.temporalLayer}` : ''}`
      : null;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (isActivelyPlaying && !qualityMenuOpen) setShowControls(false);
      }}
      className="relative aspect-video w-full bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center select-none group"
    >
      {/* Live WebRTC Network Statistics Overlay (toggled via button or 'S' key) */}
      <StatsOverlay
        visible={statsVisible}
        onClose={() => setStatsVisible(false)}
        getStats={getStats}
        activeLayers={activeLayers}
        onRelayPolicyChange={() => {
          if (
            playbackMode === 'webrtc' &&
            (status === 'playing' || status === 'connecting' || status === 'reconnecting')
          ) {
            retry();
          }
        }}
      />

      {/* Persistent Video element (kept mounted through playing & reconnecting & HLS fallback) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        className={`w-full h-full object-contain ${showVideoElement ? 'block' : 'hidden'}`}
      />

      {/* Latency / Transport Mode Badge (click to switch between WebRTC and HLS) */}
      {isActivelyPlaying && (
        <button
          type="button"
          onClick={playbackMode === 'webrtc' ? switchToHls : switchToWebRtc}
          title={
            playbackMode === 'webrtc'
              ? 'Click to switch to HLS Compatibility mode'
              : 'Click to switch back to WebRTC (low latency)'
          }
          className={`absolute top-4 left-4 z-20 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border backdrop-blur-md shadow transition ${
            playbackMode === 'webrtc'
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/80'
              : 'bg-amber-950/85 border-amber-500/40 text-amber-300 hover:bg-amber-900/85'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              playbackMode === 'webrtc' ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          {playbackMode === 'webrtc' ? 'WebRTC (low latency)' : 'HLS (about 6-10 s delay)'}
        </button>
      )}

      {/* Prominent "Click to Unmute" banner for autoplay */}
      {isActivelyPlaying && isMuted && (
        <button
          onClick={handleUnmute}
          className="absolute top-4 right-4 z-30 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/80 hover:bg-black text-amber-300 border border-amber-500/40 text-xs font-semibold backdrop-blur-md shadow-lg transition-all transform hover:scale-105 active:scale-95"
        >
          <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
          Click to unmute
        </button>
      )}

      {/* Overlaid UI depending on state machine */}
      {playbackMode === 'webrtc' && status === 'offline' && (
        <div className="text-center p-6 space-y-4 max-w-sm">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-200">{channelName} is offline</h3>
            <p className="text-xs text-slate-400">
              The streamer is not currently broadcasting. The stream will automatically begin when live.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={retry}>
            Check Stream Again
          </Button>
        </div>
      )}

      {playbackMode === 'webrtc' && status === 'connecting' && (
        <div className="text-center p-6 space-y-3">
          <div className="w-10 h-10 mx-auto rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
          <p className="text-sm font-medium text-slate-300">Connecting to live stream...</p>
          <p className="text-[11px] text-slate-500">
            Falls back to HLS automatically if WebRTC takes over 8 seconds
          </p>
        </div>
      )}

      {/* Non-destructive Reconnecting overlay over the live video element */}
      {playbackMode === 'webrtc' && status === 'reconnecting' && (
        <div className="absolute inset-0 z-20 bg-black/65 backdrop-blur-[2px] flex items-center justify-center">
          <div className="text-center p-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
            <p className="text-sm font-medium text-amber-300">Reconnecting...</p>
            <p className="text-xs text-slate-300">Attempting to resume broadcast feed</p>
          </div>
        </div>
      )}

      {playbackMode === 'webrtc' && status === 'failed' && (
        <div className="text-center p-6 space-y-3 max-w-sm">
          <div className="w-12 h-12 mx-auto rounded-full bg-rose-950/60 border border-rose-800 flex items-center justify-center text-rose-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-sm text-rose-300">{error || 'Unable to play stream'}</p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={retry}>
              Try WebRTC Again
            </Button>
            <Button variant="primary" size="sm" onClick={switchToHls}>
              Compatibility mode (HLS)
            </Button>
          </div>
        </div>
      )}

      {/* HLS Loading & Error overlays */}
      {playbackMode === 'hls' && hlsStatus === 'loading' && (
        <div className="absolute inset-0 z-20 bg-black/70 flex items-center justify-center">
          <div className="text-center p-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            <p className="text-sm font-medium text-amber-200">Loading HLS compatibility stream...</p>
            <Button variant="secondary" size="sm" onClick={switchToWebRtc}>
              Switch back to WebRTC
            </Button>
          </div>
        </div>
      )}

      {playbackMode === 'hls' && hlsStatus === 'error' && (
        <div className="text-center p-6 space-y-3 max-w-sm">
          <p className="text-sm text-amber-300">{hlsError || 'Unable to load HLS stream'}</p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="primary" size="sm" onClick={switchToWebRtc}>
              Switch back to WebRTC
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPlaybackMode('hls')}>
              Retry HLS
            </Button>
          </div>
        </div>
      )}

      {/* Floating Controls Bar (visible when playing in either WebRTC or HLS) */}
      {isActivelyPlaying && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center justify-between gap-4 transition-opacity duration-300 ${
            showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Left: LIVE indicator & received resolution / active layer */}
          <div className="flex items-center gap-2.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-600/90 text-white text-xs font-bold uppercase tracking-wider shadow">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </div>
            {(resolution || layerLabel) && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/60 border border-slate-700/70 text-[11px] font-mono text-slate-300">
                {resolution && `${resolution.width}x${resolution.height}`}
                {resolution && layerLabel && ' · '}
                {layerLabel && <span className="text-purple-300">{layerLabel}</span>}
              </span>
            )}
          </div>

          {/* Right: Stats toggle, Quality / Compatibility menu, Volume & Fullscreen controls */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Network Stats Overlay Toggle */}
            <button
              type="button"
              onClick={() => setStatsVisible((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium transition-colors ${
                statsVisible
                  ? 'bg-emerald-600/80 border-emerald-400/70 text-white'
                  : 'bg-black/60 hover:bg-slate-800 border-slate-700/70 text-slate-200'
              }`}
              title="Toggle network stats overlay (S)"
            >
              <span>Stats</span>
            </button>

            {/* Quality & Compatibility Mode Selector Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setQualityMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 hover:bg-slate-800 border border-slate-700/70 text-xs font-medium text-slate-200 transition-colors"
                title="Video quality & playback mode"
              >
                <span>{playbackMode === 'hls' ? 'HLS' : quality}</span>
                {playbackMode === 'webrtc' && quality === 'Auto' && resolution && (
                  <span className="text-[10px] text-slate-400">({resolution.height}p)</span>
                )}
              </button>

              {qualityMenuOpen && (
                <div className="absolute right-0 bottom-9 w-48 rounded-lg bg-slate-900/95 border border-slate-700 shadow-xl py-1 backdrop-blur-md z-30">
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    Quality {layerLabel ? `(${layerLabel})` : ''}
                  </div>
                  {playbackMode === 'webrtc' &&
                    QUALITY_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setQuality(opt);
                          setQualityMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-slate-800 transition-colors ${
                          quality === opt ? 'text-purple-400 font-semibold' : 'text-slate-200'
                        }`}
                      >
                        <span>{opt}</span>
                        {quality === opt && <span>✓</span>}
                      </button>
                    ))}

                  <div className="border-t border-slate-800 mt-1 pt-1">
                    {playbackMode === 'webrtc' ? (
                      <button
                        type="button"
                        onClick={switchToHls}
                        className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-slate-800 transition-colors flex items-center justify-between"
                      >
                        <span>Compatibility mode (HLS)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={switchToWebRtc}
                        className="w-full text-left px-3 py-1.5 text-xs text-emerald-300 font-semibold hover:bg-slate-800 transition-colors flex items-center justify-between"
                      >
                        <span>WebRTC (low latency)</span>
                        <span>↩</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-2 group/volume">
              <button
                onClick={handleToggleMute}
                className="text-slate-300 hover:text-white transition-colors p-1"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                )}
              </button>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 sm:w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                title="Volume"
              />
            </div>

            {/* Fullscreen Toggle */}
            <button
              onClick={handleToggleFullscreen}
              className="text-slate-300 hover:text-white transition-colors p-1"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
