import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { CategoryDto } from '@netstream/shared';
import { useAuth } from '../features/auth/AuthContext';
import { Button } from '../components/ui/Button';
import { usePublisher, PublisherStatus } from '../features/studio/usePublisher';
import {
  StudioStatsOverlay,
  createLatencyClockStream,
  type LatencyClockStreamHandle,
} from '../features/lab';
import { ChatPanel } from '../features/chat/ChatPanel';
import { useWs } from '../lib/WsContext';
import { api } from '../lib/api';

export const Studio: React.FC = () => {
  const { user, channel, refreshUser } = useAuth();
  const { client: wsClient, status: wsStatus } = useWs();
  const channelId = channel?.id;

  const {
    status,
    error: publisherError,
    simulcastNotice,
    startBroadcast,
    stopBroadcast,
    retryBroadcast,
    replaceVideoTrack,
    getStats,
  } = usePublisher({
    channelId,
  });

  const [liveDuration, setLiveDuration] = useState(0);
  const [statsVisible, setStatsVisible] = useState(false);

  // Toggle publisher stats overlay with 'S' key
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

  // Track stream duration while live
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (status === 'live') {
      timer = setInterval(() => {
        setLiveDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setLiveDuration(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [status]);

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [streamTitle, setStreamTitle] = useState<string>(channel?.title ?? '');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(channel?.categoryId ?? '');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSavedNotice, setInfoSavedNotice] = useState<string | null>(null);

  // Sync local title/category when channel loads
  useEffect(() => {
    if (channel) {
      setStreamTitle((prev) => (prev === '' ? channel.title : prev));
      setSelectedCategoryId((prev) => (prev === '' && channel.categoryId ? channel.categoryId : prev));
    }
  }, [channel]);

  // Load categories to display category name
  useEffect(() => {
    let isMounted = true;
    async function fetchCategories() {
      try {
        const res = await api.get<CategoryDto[]>('/api/categories');
        if (isMounted) {
          setCategories(res);
        }
      } catch {
        // ignore
      }
    }
    void fetchCategories();
    return () => {
      isMounted = false;
    };
  }, []);

  const categoryName =
    categories.find((c) => c.id === (selectedCategoryId || channel?.categoryId))?.name || 'General';
  const hasValidTitle = streamTitle.trim().length > 0;

  const saveStreamInfo = useCallback(async (): Promise<boolean> => {
    const trimmed = streamTitle.trim();
    if (!trimmed) return false;

    const categoryChanged = (selectedCategoryId || null) !== (channel?.categoryId ?? null);
    const titleChanged = trimmed !== (channel?.title ?? '');
    if (!titleChanged && !categoryChanged) return true;

    setSavingInfo(true);
    setInfoSavedNotice(null);
    try {
      await api.patch('/api/channels/me', {
        title: trimmed,
        categoryId: selectedCategoryId || null,
      });
      await refreshUser();
      setInfoSavedNotice('Saved');
      setTimeout(() => setInfoSavedNotice(null), 2000);
      return true;
    } catch (err) {
      setPermissionError(
        err instanceof Error ? err.message : 'Failed to update stream title/category.'
      );
      return false;
    } finally {
      setSavingInfo(false);
    }
  }, [streamTitle, selectedCategoryId, channel, refreshUser]);

  // Device selections
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [latencyTestMode, setLatencyTestMode] = useState(false);
  const latencyHandleRef = useRef<LatencyClockStreamHandle | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const stopLatencyClock = useCallback(() => {
    if (latencyHandleRef.current) {
      latencyHandleRef.current.stop();
      latencyHandleRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopLatencyClock();
    };
  }, [stopLatencyClock]);

  const handleToggleLatencyTestMode = useCallback(async () => {
    if (!stream) return;

    if (latencyTestMode) {
      stopLatencyClock();
      setLatencyTestMode(false);
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
      }
      if (status === 'live') {
        const rawTrack = stream.getVideoTracks()[0];
        if (rawTrack) await replaceVideoTrack(rawTrack);
      }
      return;
    }

    stopLatencyClock();
    const handle = createLatencyClockStream(stream, { width: 1280, height: 720, fps: 30 });
    latencyHandleRef.current = handle;
    setLatencyTestMode(true);
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = handle.stream;
    }
    if (status === 'live') {
      const clockTrack = handle.stream.getVideoTracks()[0];
      if (clockTrack) await replaceVideoTrack(clockTrack);
    }
  }, [stream, latencyTestMode, stopLatencyClock, status, replaceVideoTrack]);

  // Enumerate devices helper
  const loadDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const video = devices.filter((d) => d.kind === 'videoinput');
      const audio = devices.filter((d) => d.kind === 'audioinput');

      setVideoDevices(video);
      setAudioDevices(audio);

      if (video.length > 0 && !selectedVideoId) {
        setSelectedVideoId(video[0].deviceId);
      }
      if (audio.length > 0 && !selectedAudioId) {
        setSelectedAudioId(audio[0].deviceId);
      }
    } catch {
      // Ignore enumeration errors
    }
  }, [selectedVideoId, selectedAudioId]);

  // Acquire media stream from camera/microphone
  const setupCameraStream = useCallback(async () => {
    setPermissionError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermissionError('Media devices API not supported in this browser environment.');
        return;
      }

      // Stop previous local tracks
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true,
        audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);
      setIsScreenSharing(false);

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = newStream;
      }

      // If we are already live, update the active producer track
      if (status === 'live') {
        const videoTrack = newStream.getVideoTracks()[0];
        if (videoTrack) {
          await replaceVideoTrack(videoTrack);
        }
      }

      await loadDevices();
    } catch (err: unknown) {
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        setPermissionError('Camera or microphone access denied. Please grant permission in your browser.');
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setPermissionError('No camera or microphone found on this device.');
      } else {
        setPermissionError(err instanceof Error ? err.message : 'Failed to access camera/microphone.');
      }
    }
  }, [selectedVideoId, selectedAudioId, stream, status, replaceVideoTrack, loadDevices]);

  // Initial stream setup
  useEffect(() => {
    void setupCameraStream();
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Update preview srcObject when stream changes
  useEffect(() => {
    if (previewVideoRef.current && stream) {
      previewVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Share screen toggle
  const handleToggleScreenShare = async () => {
    setPermissionError(null);
    if (isScreenSharing) {
      // Switch back to camera
      await setupCameraStream();
      return;
    }

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setPermissionError('Screen sharing is not supported in this browser.');
        return;
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const screenVideoTrack = displayStream.getVideoTracks()[0];
      if (!screenVideoTrack) return;

      // When user clicks "Stop sharing" on browser chrome bar
      screenVideoTrack.onended = () => {
        void setupCameraStream();
      };

      // Keep existing mic audio if screen doesn't have audio
      if (stream) {
        const micAudioTrack = stream.getAudioTracks()[0];
        if (micAudioTrack && displayStream.getAudioTracks().length === 0) {
          displayStream.addTrack(micAudioTrack);
        }
      }

      // Stop old video track
      if (stream) {
        stream.getVideoTracks().forEach((t) => t.stop());
      }

      setStream(displayStream);
      setIsScreenSharing(true);

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = displayStream;
      }

      if (status === 'live') {
        await replaceVideoTrack(screenVideoTrack);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        // User cancelled picker
        return;
      }
      setPermissionError(err instanceof Error ? err.message : 'Screen share failed.');
    }
  };

  const handleStartGoLive = async () => {
    if (!hasValidTitle) {
      setPermissionError('Please enter a stream title before going live.');
      return;
    }
    if (!stream) {
      setPermissionError('Please enable camera or screen share before going live.');
      return;
    }
    const saved = await saveStreamInfo();
    if (!saved) return;
    const publishStream =
      latencyTestMode && latencyHandleRef.current ? latencyHandleRef.current.stream : stream;
    await startBroadcast(publishStream, { isScreenShare: isScreenSharing });
  };

  const handleEndStream = () => {
    stopBroadcast();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gray-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Creator Studio</h1>
            <StatusBadge status={status} />
            {status === 'live' && (
              <span className="text-xs font-mono font-medium text-emerald-400 bg-emerald-950/70 border border-emerald-800/80 px-2.5 py-0.5 rounded-full">
                {formatDuration(liveDuration)}
              </span>
            )}
          </div>
          <p className="text-gray-400 mt-1 text-sm">
            Broadcasting to <span className="text-purple-400 font-medium">@{channel?.name || user?.username}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to={`/c/${channel?.name || user?.username}`}>
            <Button variant="secondary" size="sm">
              View Channel
            </Button>
          </Link>
          <Link to="/settings">
            <Button variant="ghost" size="sm">
              Channel Settings
            </Button>
          </Link>
        </div>
      </div>

      {/* Streamer Reconnecting Notice */}
      {status === 'reconnecting' && (
        <div className="bg-amber-950/70 border border-amber-700/80 rounded-xl p-4 flex items-center gap-3 text-amber-200">
          <div className="w-3 h-3 rounded-full bg-amber-400 animate-ping shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-amber-300">Reconnecting to Stream...</p>
            <p className="text-xs text-amber-200/80">Connection was interrupted. Viewers have a 15-second grace period while the stream recovers.</p>
          </div>
        </div>
      )}

      {/* Simulcast fallback notice */}
      {simulcastNotice && (
        <div className="bg-blue-950/60 border border-blue-800/70 rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-blue-200 text-xs">
          <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
          <span>{simulcastNotice}</span>
        </div>
      )}

      {/* Permission, Publisher, or Connection Error Notices */}
      {(permissionError || publisherError || (wsStatus !== 'open' && wsStatus !== 'connecting')) && (
        <div className="bg-red-950/60 border border-red-800/80 rounded-xl p-4 flex items-start justify-between gap-3 text-red-200">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm">
              <p className="font-semibold text-red-300">Action Required</p>
              <p className="mt-0.5">
                {permissionError ||
                  publisherError ||
                  `WebSocket is currently ${wsStatus}. Please reconnect.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {publisherError && stream && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void retryBroadcast()}
                className="text-xs"
              >
                Retry
              </Button>
            )}
            {wsStatus !== 'open' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void wsClient.connect()}
                className="text-xs"
              >
                Reconnect
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Preview Monitor */}
        <div className="lg:col-span-2 space-y-4">
          <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-gray-800 shadow-2xl flex items-center justify-center">
            <video
              ref={previewVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />

            {/* Overlaid Badges */}
            <div className="absolute top-4 left-4 flex items-center gap-2">
              {status === 'live' && (
                <span className="flex items-center gap-1.5 px-3 py-1 bg-red-600/90 text-white font-bold text-xs rounded-full uppercase tracking-wider shadow-lg animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-white"></span>
                  Live
                </span>
              )}
              {isScreenSharing && (
                <span className="px-2.5 py-1 bg-blue-600/80 text-white font-medium text-xs rounded-full shadow">
                  Screen Share
                </span>
              )}
              {latencyTestMode && (
                <span className="px-2.5 py-1 bg-sky-600/90 text-white font-medium text-xs rounded-full shadow">
                  Latency Test Mode (E6)
                </span>
              )}
            </div>

            {/* Publisher Outbound Network Stats Overlay (toggled via button or 'S' key) */}
            <StudioStatsOverlay
              visible={statsVisible}
              onClose={() => setStatsVisible(false)}
              getStats={getStats}
              onRelayPolicyChange={() => {
                if (status === 'live') {
                  void retryBroadcast();
                }
              }}
            />

            {/* Stream info overlay at bottom of player */}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 flex items-end justify-between">
              <div>
                <p className="text-white font-semibold text-base drop-shadow-md">
                  {streamTitle.trim() || channel?.title || `${user?.username || 'Creator'}'s Stream`}
                </p>
                <p className="text-gray-300 text-xs drop-shadow">
                  {categoryName}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Action Bar under Monitor */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <Button
                variant={isScreenSharing ? 'primary' : 'secondary'}
                size="sm"
                onClick={handleToggleScreenShare}
                disabled={status === 'connecting'}
              >
                {isScreenSharing ? 'Switch to Camera' : 'Share screen instead'}
              </Button>
              <Button
                variant={statsVisible ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setStatsVisible((prev) => !prev)}
                title="Toggle outbound WebRTC stats overlay (S)"
              >
                {statsVisible ? 'Hide Stats' : 'Network Stats (S)'}
              </Button>
              <Button
                variant={latencyTestMode ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => void handleToggleLatencyTestMode()}
                disabled={!stream || status === 'connecting'}
                title="Burn millisecond wall-clock timestamp onto stream for E6 latency test"
              >
                {latencyTestMode ? 'Exit Latency Mode' : 'Latency Test Mode'}
              </Button>
            </div>

            <div>
              {status === 'live' ? (
                <Button
                  variant="danger"
                  size="md"
                  onClick={handleEndStream}
                  className="px-6 font-semibold shadow-lg shadow-red-950/40"
                >
                  End Stream
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleStartGoLive}
                  disabled={status === 'connecting' || savingInfo || !stream || !hasValidTitle}
                  title={!hasValidTitle ? 'Enter a stream title before going live' : 'Go Live'}
                  className="px-6 font-semibold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-950/40"
                >
                  {status === 'connecting' ? 'Connecting SFU...' : 'Go Live'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right 1 Col: Broadcast Controls & Settings */}
        <div className="space-y-6">
          {/* Stream Settings Card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h2 className="text-base font-semibold text-white">Stream Information</h2>
              <Link to="/settings" className="text-xs text-purple-400 hover:text-purple-300">
                More Settings &rarr;
              </Link>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label htmlFor="studio-title" className="text-gray-400 block text-xs mb-1">
                  Title <span className="text-rose-400">*</span>
                </label>
                <input
                  id="studio-title"
                  type="text"
                  value={streamTitle}
                  onChange={(e) => setStreamTitle(e.target.value)}
                  maxLength={100}
                  placeholder="What are you streaming today?"
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 text-xs"
                />
                {!hasValidTitle && (
                  <p className="text-[11px] text-amber-400 mt-1">
                    A title is required before going live.
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="studio-category" className="text-gray-400 block text-xs mb-1">
                  Category
                </label>
                <select
                  id="studio-category"
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-purple-500 text-xs"
                >
                  <option value="">No category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-emerald-400">{infoSavedNotice || ''}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void saveStreamInfo()}
                  disabled={savingInfo || !hasValidTitle}
                  className="text-xs"
                >
                  {savingInfo ? 'Saving...' : 'Save Info'}
                </Button>
              </div>
            </div>
          </div>

          {/* AV Device Pickers Card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="text-base font-semibold text-white border-b border-gray-800 pb-3">
              Audio & Video Inputs
            </h2>

            <div className="space-y-4 text-sm">
              {/* Camera Picker */}
              <div>
                <label htmlFor="camera-select" className="block text-xs font-medium text-gray-400 mb-1">Camera Device</label>
                <select
                  id="camera-select"
                  aria-label="Camera Device"
                  value={selectedVideoId}
                  disabled={isScreenSharing || status === 'connecting'}
                  onChange={(e) => {
                    setSelectedVideoId(e.target.value);
                  }}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50"
                >
                  {videoDevices.map((d, index) => (
                    <option key={d.deviceId || index} value={d.deviceId}>
                      {d.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                  {videoDevices.length === 0 && <option value="">Default Camera</option>}
                </select>
              </div>

              {/* Microphone Picker */}
              <div>
                <label htmlFor="mic-select" className="block text-xs font-medium text-gray-400 mb-1">Microphone Device</label>
                <select
                  id="mic-select"
                  aria-label="Microphone Device"
                  value={selectedAudioId}
                  disabled={status === 'connecting'}
                  onChange={(e) => {
                    setSelectedAudioId(e.target.value);
                  }}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50"
                >
                  {audioDevices.map((d, index) => (
                    <option key={d.deviceId || index} value={d.deviceId}>
                      {d.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                  {audioDevices.length === 0 && <option value="">Default Microphone</option>}
                </select>
              </div>

              <div className="pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void setupCameraStream()}
                  className="w-full text-xs text-gray-400 hover:text-white"
                >
                  Refresh Devices & Stream
                </Button>
              </div>
            </div>
          </div>

          {/* Live Stream Chat & Moderation */}
          {channelId && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl h-[480px] flex flex-col">
              <div className="px-4 py-2 bg-gray-950 border-b border-gray-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-200">Stream Chat</span>
                <span className="text-[10px] text-purple-400 font-mono bg-purple-950/70 border border-purple-800/80 px-2 py-0.5 rounded-full">
                  Mod View
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <ChatPanel
                  channelId={channelId}
                  channelName={channel?.name || user?.username || 'streamer'}
                  channelOwnerId={channel?.ownerId || user?.id}
                  isMod={true}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface StatusBadgeProps {
  status: PublisherStatus;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  switch (status) {
    case 'live':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-900/60 text-red-300 border border-red-700/60">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
          Live
        </span>
      );
    case 'reconnecting':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-900/60 text-amber-300 border border-amber-700/60">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
          Reconnecting
        </span>
      );
    case 'connecting':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-900/60 text-yellow-300 border border-yellow-700/60">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span>
          Connecting
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-900/60 text-red-300 border border-red-700/60">
          Error
        </span>
      );
    case 'idle':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-800 text-gray-400 border border-gray-700">
          Offline / Ready
        </span>
      );
  }
};
