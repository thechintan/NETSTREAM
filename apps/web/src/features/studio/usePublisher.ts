import { useEffect, useRef, useState, useCallback } from 'react';
import { Device } from 'mediasoup-client';
import type {
  Transport,
  Producer,
  RtpCapabilities,
  TransportOptions,
  IceParameters,
} from 'mediasoup-client/lib/types';
import type {
  MediaJoinResponse,
  MediaCreateTransportResponse,
  MediaRestartIceResponse,
} from '@netstream/shared';
import { useWs } from '../../lib/WsContext';

export type PublisherStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

export interface UsePublisherOptions {
  channelId?: string;
}

export interface StartBroadcastOptions {
  isScreenShare?: boolean;
}

const MAX_ICE_RESTART_ATTEMPTS = 3;
const DISCONNECTED_RESTART_DELAY_MS = 3000;

export function usePublisher({ channelId }: UsePublisherOptions) {
  const ws = useWs();
  const [status, setStatus] = useState<PublisherStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [simulcastNotice, setSimulcastNotice] = useState<string | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const audioProducerRef = useRef<Producer | null>(null);
  const videoProducerRef = useRef<Producer | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const isScreenShareRef = useRef<boolean>(false);
  const wasLiveRef = useRef<boolean>(false);
  const iceRestartAttemptsRef = useRef<number>(0);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRestartingIceRef = useRef<boolean>(false);

  const clearDisconnectTimer = useCallback(() => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  // Close transport & producers only (keeps local MediaStream intact for reconnect/retry)
  const cleanupTransport = useCallback(() => {
    clearDisconnectTimer();
    iceRestartAttemptsRef.current = 0;
    isRestartingIceRef.current = false;

    if (audioProducerRef.current) {
      try {
        audioProducerRef.current.close();
      } catch {
        // ignore
      }
      audioProducerRef.current = null;
    }

    if (videoProducerRef.current) {
      try {
        videoProducerRef.current.close();
      } catch {
        // ignore
      }
      videoProducerRef.current = null;
    }

    if (transportRef.current) {
      try {
        transportRef.current.close();
      } catch {
        // ignore
      }
      transportRef.current = null;
    }
  }, [clearDisconnectTimer]);

  const stopBroadcast = useCallback(() => {
    wasLiveRef.current = false;

    // Notify server of explicit stream end
    if (channelId && ws.client.getStatus() === 'open') {
      void ws.request('media.end', { channelId }).catch(() => {});
    }

    cleanupTransport();

    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      activeStreamRef.current = null;
    }

    setSimulcastNotice(null);
    setError(null);
    setStatus('idle');
  }, [channelId, ws, cleanupTransport]);

  const attemptIceRestart = useCallback(
    async (transport: Transport) => {
      if (transportRef.current !== transport || isRestartingIceRef.current) {
        return;
      }

      if (iceRestartAttemptsRef.current >= MAX_ICE_RESTART_ATTEMPTS) {
        setStatus('error');
        setError('WebRTC connection failed after 3 ICE restart attempts.');
        return;
      }

      isRestartingIceRef.current = true;
      iceRestartAttemptsRef.current += 1;
      setStatus('reconnecting');

      try {
        const res = await ws.request<MediaRestartIceResponse>('media.restartIce', {
          transportId: transport.id,
        });
        if (transportRef.current !== transport) return;
        await transport.restartIce({
          iceParameters: res.iceParameters as IceParameters,
        });
      } catch {
        if (transportRef.current !== transport) return;
        if (iceRestartAttemptsRef.current >= MAX_ICE_RESTART_ATTEMPTS) {
          setStatus('error');
          setError('WebRTC ICE restart failed after 3 attempts. Click Retry to reconnect.');
        }
      } finally {
        isRestartingIceRef.current = false;
      }
    },
    [ws]
  );

  const startBroadcast = useCallback(
    async (stream: MediaStream, options?: StartBroadcastOptions) => {
      if (!channelId) {
        setStatus('error');
        setError('No active channel ID for broadcasting');
        return;
      }

      const isScreenShare = options?.isScreenShare ?? isScreenShareRef.current;
      isScreenShareRef.current = isScreenShare;
      activeStreamRef.current = stream;

      cleanupTransport();
      setStatus(wasLiveRef.current ? 'reconnecting' : 'connecting');
      setError(null);
      setSimulcastNotice(null);

      try {
        // Ensure WebSocket is open before sending signaling requests
        if (ws.client.getStatus() !== 'open') {
          void ws.client.connect();
          await new Promise<void>((resolve, reject) => {
            if (ws.client.getStatus() === 'open') {
              resolve();
              return;
            }
            const timeout = setTimeout(() => {
              unsub();
              reject(new Error('WebSocket is not connected. Re-establishing connection...'));
            }, 6000);
            const unsub = ws.client.on('status', (newStatus) => {
              if (newStatus === 'open') {
                clearTimeout(timeout);
                unsub();
                resolve();
              }
            });
          });
        }

        // 1. media.join as publisher
        const joinRes = await ws.request<MediaJoinResponse>('media.join', {
          channelId,
          role: 'publisher',
        });

        // 2. Load mediasoup device with router capabilities
        if (!deviceRef.current) {
          deviceRef.current = new Device();
        }

        const device = deviceRef.current;
        if (!device.loaded) {
          await device.load({
            routerRtpCapabilities: joinRes.routerRtpCapabilities as RtpCapabilities,
          });
        }

        // 3. Create WebRTC send transport
        const transportParams = await ws.request<MediaCreateTransportResponse>(
          'media.createTransport',
          { direction: 'send' }
        );

        const sendTransport = device.createSendTransport(
          transportParams as unknown as TransportOptions
        );
        transportRef.current = sendTransport;

        sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
            await ws.request('media.connectTransport', {
              transportId: sendTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (err) {
            errback(err instanceof Error ? err : new Error(String(err)));
          }
        });

        sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
          try {
            const res = await ws.request<{ id: string }>('media.produce', {
              transportId: sendTransport.id,
              kind,
              rtpParameters,
              appData,
            });
            callback({ id: res.id });
          } catch (err) {
            errback(err instanceof Error ? err : new Error(String(err)));
          }
        });

        sendTransport.on('connectionstatechange', (state) => {
          if (transportRef.current !== sendTransport) return;

          if (state === 'connected') {
            clearDisconnectTimer();
            iceRestartAttemptsRef.current = 0;
            setError(null);
            setStatus('live');
          } else if (state === 'disconnected') {
            setStatus('reconnecting');
            clearDisconnectTimer();
            disconnectTimerRef.current = setTimeout(() => {
              void attemptIceRestart(sendTransport);
            }, DISCONNECTED_RESTART_DELAY_MS);
          } else if (state === 'failed') {
            clearDisconnectTimer();
            void attemptIceRestart(sendTransport);
          }
        });

        // 4. Produce audio track
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack && audioTrack.readyState === 'live') {
          const audioProducer = await sendTransport.produce({
            track: audioTrack,
          });
          audioProducerRef.current = audioProducer;
        }

        // 5. Produce video track (Simulcast for camera, single high-bitrate detail for screen share)
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && videoTrack.readyState === 'live') {
          if (isScreenShare) {
            try {
              if ('contentHint' in videoTrack) {
                videoTrack.contentHint = 'detail';
              }
            } catch {
              // Ignore unsupported contentHint
            }
            const videoProducer = await sendTransport.produce({
              track: videoTrack,
              encodings: [{ maxBitrate: 3_500_000 }],
              appData: { source: 'screen' },
            });
            videoProducerRef.current = videoProducer;
          } else {
            try {
              const videoProducer = await sendTransport.produce({
                track: videoTrack,
                encodings: [
                  {
                    rid: 'r0',
                    scaleResolutionDownBy: 4,
                    maxBitrate: 150_000,
                    scalabilityMode: 'L1T3',
                  },
                  {
                    rid: 'r1',
                    scaleResolutionDownBy: 2,
                    maxBitrate: 600_000,
                    scalabilityMode: 'L1T3',
                  },
                  {
                    rid: 'r2',
                    scaleResolutionDownBy: 1,
                    maxBitrate: 2_500_000,
                    scalabilityMode: 'L1T3',
                  },
                ],
                codecOptions: {
                  videoGoogleStartBitrate: 1000,
                },
                appData: { source: 'camera' },
              });
              videoProducerRef.current = videoProducer;
            } catch {
              // Fallback to single encoding if browser rejects simulcast
              setSimulcastNotice(
                'Simulcast is not supported by this browser/encoder; streaming single-layer video instead.'
              );
              const fallbackProducer = await sendTransport.produce({
                track: videoTrack,
                encodings: [{ maxBitrate: 2_500_000 }],
                appData: { source: 'camera', simulcastFallback: true },
              });
              videoProducerRef.current = fallbackProducer;
            }
          }
        }

        wasLiveRef.current = true;
        setStatus('live');
      } catch (err: unknown) {
        const errorMsg =
          typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Failed to start broadcast';
        setError(errorMsg);
        setStatus('error');
        cleanupTransport();
      }
    },
    [channelId, ws, cleanupTransport, clearDisconnectTimer, attemptIceRestart]
  );

  const retryBroadcast = useCallback(async () => {
    if (activeStreamRef.current) {
      await startBroadcast(activeStreamRef.current, {
        isScreenShare: isScreenShareRef.current,
      });
    }
  }, [startBroadcast]);

  const replaceVideoTrack = useCallback(async (newTrack: MediaStreamTrack) => {
    if (videoProducerRef.current) {
      await videoProducerRef.current.replaceTrack({ track: newTrack });
    }
  }, []);

  // Handle WS disconnect/reconnect while live: automatically rebuild publishing session
  useEffect(() => {
    const unsub = ws.client.on('status', (wsState) => {
      if (wsState === 'reconnecting' || wsState === 'closed') {
        if (wasLiveRef.current) {
          setStatus('reconnecting');
        }
      } else if (wsState === 'open') {
        if (wasLiveRef.current && activeStreamRef.current) {
          void startBroadcast(activeStreamRef.current, {
            isScreenShare: isScreenShareRef.current,
          });
        }
      }
    });

    return () => {
      unsub();
    };
  }, [ws.client, startBroadcast]);

  // Cleanup on unmount (do not send media.end on unmount so closing tab triggers 15s grace period!)
  useEffect(() => {
    return () => {
      wasLiveRef.current = false;
      cleanupTransport();
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // ignore
          }
        });
        activeStreamRef.current = null;
      }
    };
  }, [cleanupTransport]);

  const getStats = useCallback(async () => {
    const videoProducer =
      videoProducerRef.current && !videoProducerRef.current.closed
        ? videoProducerRef.current
        : null;
    const transport =
      transportRef.current && !transportRef.current.closed ? transportRef.current : null;

    const [videoReport, transportReport] = await Promise.all([
      videoProducer ? videoProducer.getStats().catch(() => null) : Promise.resolve(null),
      transport ? transport.getStats().catch(() => null) : Promise.resolve(null),
    ]);

    return {
      videoReport: videoReport as unknown as import('../lab/types').StatsReportLike | null,
      transportReport: transportReport as unknown as import('../lab/types').StatsReportLike | null,
    };
  }, []);

  return {
    status,
    error,
    simulcastNotice,
    startBroadcast,
    stopBroadcast,
    retryBroadcast,
    replaceVideoTrack,
    getStats,
    isLive: status === 'live',
  };
}
