import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '../../components/ui/Button';
import { useViewer, type QualityOption } from './useViewer';

export interface VideoPlayerProps {
  channelId?: string;
  channelName?: string;
}

const QUALITY_OPTIONS: QualityOption[] = ['Auto', '720p', '360p', '180p'];

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  channelId,
  channelName = 'Streamer',
}) => {
  const { status, error, mediaStream, quality, setQuality, activeLayers, retry } = useViewer({
    channelId,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Attach MediaStream to HTMLVideoElement without destroying the video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

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
  }, [mediaStream, isMuted, volume, status]);

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
  }, [mediaStream]);

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

  // Controls auto-hide on mouse movement
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = setTimeout(() => {
      if (status === 'playing' && !qualityMenuOpen) {
        setShowControls(false);
      }
    }, 3000);
  }, [status, qualityMenuOpen]);

  const showVideoElement = status === 'playing' || status === 'reconnecting';

  const layerLabel = activeLayers
    ? `S${activeLayers.spatialLayer}${activeLayers.temporalLayer !== undefined ? `T${activeLayers.temporalLayer}` : ''}`
    : null;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (status === 'playing' && !qualityMenuOpen) setShowControls(false);
      }}
      className="relative aspect-video w-full bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center select-none group"
    >
      {/* Persistent Video element (kept mounted through playing & reconnecting) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        className={`w-full h-full object-contain ${showVideoElement ? 'block' : 'hidden'}`}
      />

      {/* Prominent "Click to Unmute" banner for autoplay */}
      {status === 'playing' && isMuted && (
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
      {status === 'offline' && (
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

      {status === 'connecting' && (
        <div className="text-center p-6 space-y-3">
          <div className="w-10 h-10 mx-auto rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
          <p className="text-sm font-medium text-slate-300">Connecting to live stream...</p>
        </div>
      )}

      {/* Non-destructive Reconnecting overlay over the live video element */}
      {status === 'reconnecting' && (
        <div className="absolute inset-0 z-20 bg-black/65 backdrop-blur-[2px] flex items-center justify-center">
          <div className="text-center p-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
            <p className="text-sm font-medium text-amber-300">Reconnecting...</p>
            <p className="text-xs text-slate-300">Attempting to resume broadcast feed</p>
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div className="text-center p-6 space-y-3 max-w-sm">
          <div className="w-12 h-12 mx-auto rounded-full bg-rose-950/60 border border-rose-800 flex items-center justify-center text-rose-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-sm text-rose-300">{error || 'Unable to play stream'}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Try Again
          </Button>
        </div>
      )}

      {/* Floating Controls Bar (visible when playing & controls visible) */}
      {status === 'playing' && (
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

          {/* Right: Quality menu, Volume & Fullscreen controls */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Quality Selector Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setQualityMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 hover:bg-slate-800 border border-slate-700/70 text-xs font-medium text-slate-200 transition-colors"
                title="Video quality"
              >
                <span>{quality}</span>
                {quality === 'Auto' && resolution && (
                  <span className="text-[10px] text-slate-400">({resolution.height}p)</span>
                )}
              </button>

              {qualityMenuOpen && (
                <div className="absolute right-0 bottom-9 w-36 rounded-lg bg-slate-900/95 border border-slate-700 shadow-xl py-1 backdrop-blur-md z-30">
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    Quality {layerLabel ? `(${layerLabel})` : ''}
                  </div>
                  {QUALITY_OPTIONS.map((opt) => (
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
