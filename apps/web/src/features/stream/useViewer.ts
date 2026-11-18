import { useCallback, useEffect, useRef, useState } from 'react';
import { Device } from 'mediasoup-client';
import type {
  Transport,
  Consumer,
  RtpCapabilities,
  TransportOptions,
  RtpParameters,
  IceParameters,
} from 'mediasoup-client/lib/types';
import type {
  MediaJoinResponse,
  MediaCreateTransportResponse,
  ConsumerInfo,
  MediaNewProducerPayload,
  MediaConsumerClosedPayload,
  StreamReconnectingPayload,
  StreamLivePayload,
  StreamOfflinePayload,
  MediaLayersPayload,
  MediaRestartIceResponse,
} from '@netstream/shared';
import { useWs } from '../../lib/WsContext';

export type ViewerStatus = 'offline' | 'connecting' | 'playing' | 'reconnecting' | 'failed';
export type QualityOption = 'Auto' | '720p' | '360p' | '180p';

export interface ActiveLayers {
  spatialLayer: number;
  temporalLayer?: number;
}

export interface UseViewerOptions {
  channelId?: string;
}

const QUALITY_STORAGE_KEY = 'netstream_quality';
const MAX_ICE_RESTART_ATTEMPTS = 3;
const DISCONNECTED_RESTART_DELAY_MS = 3000;

const QUALITY_TO_SPATIAL: Record<Exclude<QualityOption, 'Auto'>, number> = {
  '180p': 0,
  '360p': 1,
  '720p': 2,
};

function readStoredQuality(): QualityOption {
  try {
    const stored = sessionStorage.getItem(QUALITY_STORAGE_KEY);
    if (stored === 'Auto' || stored === '720p' || stored === '360p' || stored === '180p') {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return 'Auto';
}

export function useViewer({ channelId }: UseViewerOptions) {
  const ws = useWs();
  const [status, setStatus] = useState<ViewerStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [quality, setQualityState] = useState<QualityOption>(readStoredQuality);
  const [activeLayers, setActiveLayers] = useState<ActiveLayers | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const videoConsumerIdRef = useRef<string | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);
  const statusRef = useRef<ViewerStatus>('connecting');
  const qualityRef = useRef<QualityOption>(quality);
  const iceRestartAttemptsRef = useRef<number>(0);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRestartingIceRef = useRef<boolean>(false);

  statusRef.current = status;
  qualityRef.current = quality;

  const clearDisconnectTimer = useCallback(() => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  const cleanupMedia = useCallback(
    (preserveStreamForReconnect = false) => {
      clearDisconnectTimer();
      iceRestartAttemptsRef.current = 0;
      isRestartingIceRef.current = false;

      // 1. Close consumers
      for (const consumer of consumersRef.current.values()) {
        try {
          consumer.close();
        } catch {
          // ignore
        }
      }
      consumersRef.current.clear();
      videoConsumerIdRef.current = null;

      // 2. Close transport
      if (transportRef.current) {
        try {
          transportRef.current.close();
        } catch {
          // ignore
        }
        transportRef.current = null;
      }

      if (!preserveStreamForReconnect) {
        // 3. Stop tracks
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
        setMediaStream(null);
        setActiveLayers(null);
      }
    },
    [clearDisconnectTimer]
  );

  const applyQualityLayer = useCallback(
    async (nextQuality: QualityOption, consumerId: string, isInitial: boolean) => {
      // Auto on initial mount: do not set preferred layers (let SFU decide automatically)
      if (nextQuality === 'Auto' && isInitial) {
        return;
      }

      const spatialLayer =
        nextQuality === 'Auto' ? 2 : QUALITY_TO_SPATIAL[nextQuality];

      try {
        await ws.request('media.setLayers', {
          consumerId,
          spatialLayer,
          temporalLayer: 2,
        });
      } catch {
        // Ignore layer change error if consumer already closed
      }
    },
    [ws]
  );

  const setQuality = useCallback(
    (nextQuality: QualityOption) => {
      setQualityState(nextQuality);
      qualityRef.current = nextQuality;
      try {
        sessionStorage.setItem(QUALITY_STORAGE_KEY, nextQuality);
      } catch {
        // ignore storage errors
      }

      const videoConsumerId = videoConsumerIdRef.current;
      if (videoConsumerId) {
        void applyQualityLayer(nextQuality, videoConsumerId, false);
      }
    },
    [applyQualityLayer]
  );

  const attemptIceRestart = useCallback(
    async (transport: Transport) => {
      if (transportRef.current !== transport || isRestartingIceRef.current) {
        return;
      }

      if (iceRestartAttemptsRef.current >= MAX_ICE_RESTART_ATTEMPTS) {
        setStatus('failed');
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
          setStatus('failed');
          setError('WebRTC ICE restart failed after 3 attempts.');
        }
      } finally {
        isRestartingIceRef.current = false;
      }
    },
    [ws]
  );

  const consumeProducers = useCallback(
    async (transport: Transport, device: Device, targetStream: MediaStream) => {
      const consumerInfos = await ws.request<ConsumerInfo[]>('media.consume', {
        transportId: transport.id,
        rtpCapabilities: device.rtpCapabilities,
      });

      if (!consumerInfos || consumerInfos.length === 0) {
        return 0;
      }

      const consumerIdsToResume: string[] = [];

      for (const info of consumerInfos) {
        if (consumersRef.current.has(info.id)) {
          continue;
        }

        const consumer = await transport.consume({
          id: info.id,
          producerId: info.producerId,
          kind: info.kind,
          rtpParameters: info.rtpParameters as RtpParameters,
        });

        consumersRef.current.set(consumer.id, consumer);
        if (info.kind === 'video') {
          videoConsumerIdRef.current = consumer.id;
        }

        // Remove any stale track of the same kind before adding the fresh track
        for (const existingTrack of targetStream.getTracks()) {
          if (existingTrack.kind === consumer.track.kind) {
            targetStream.removeTrack(existingTrack);
          }
        }
        targetStream.addTrack(consumer.track);
        consumerIdsToResume.push(consumer.id);

        consumer.on('trackended', () => {
          try {
            targetStream.removeTrack(consumer.track);
          } catch {
            // ignore
          }
        });
      }

      if (consumerIdsToResume.length > 0) {
        await ws.request('media.resume', {
          consumerIds: consumerIdsToResume,
        });

        if (videoConsumerIdRef.current && qualityRef.current !== 'Auto') {
          await applyQualityLayer(qualityRef.current, videoConsumerIdRef.current, true);
        }
      }

      return consumerIdsToResume.length;
    },
    [ws, applyQualityLayer]
  );

  const connectToStream = useCallback(
    async (isReconnecting = false) => {
      if (!channelId) {
        setStatus('offline');
        return;
      }

      cleanupMedia(isReconnecting);
      setStatus(isReconnecting ? 'reconnecting' : 'connecting');
      setError(null);

      try {
        // 1. Ensure WebSocket is open
        if (ws.client.getStatus() !== 'open') {
          void ws.client.connect();
          await new Promise<void>((resolve, reject) => {
            if (ws.client.getStatus() === 'open') {
              resolve();
              return;
            }
            const timeout = setTimeout(() => {
              unsub();
              reject(new Error('WebSocket connection timed out'));
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

        if (!isMountedRef.current) return;

        // 2. media.join as viewer
        let joinRes: MediaJoinResponse;
        try {
          joinRes = await ws.request<MediaJoinResponse>('media.join', {
            channelId,
            role: 'viewer',
          });
        } catch (err: unknown) {
          const msg =
            typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : '';
          if (msg.includes('MEDIA_OFFLINE') || msg.includes('not currently live')) {
            cleanupMedia(false);
            setStatus('offline');
            return;
          }
          throw err;
        }

        if (!isMountedRef.current) return;

        // 3. Load device
        if (!deviceRef.current) {
          deviceRef.current = new Device();
        }
        const device = deviceRef.current;
        if (!device.loaded) {
          await device.load({
            routerRtpCapabilities: joinRes.routerRtpCapabilities as RtpCapabilities,
          });
        }

        if (!isMountedRef.current) return;

        // 4. Create WebRTC receive transport
        const transportParams = await ws.request<MediaCreateTransportResponse>(
          'media.createTransport',
          { direction: 'recv' }
        );

        if (!isMountedRef.current) return;

        const recvTransport = device.createRecvTransport(
          transportParams as unknown as TransportOptions
        );
        transportRef.current = recvTransport;

        recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
            await ws.request('media.connectTransport', {
              transportId: recvTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (err) {
            errback(err instanceof Error ? err : new Error(String(err)));
          }
        });

        recvTransport.on('connectionstatechange', (state) => {
          if (!isMountedRef.current || transportRef.current !== recvTransport) return;

          if (state === 'connected') {
            clearDisconnectTimer();
            iceRestartAttemptsRef.current = 0;
            setError(null);
            setStatus('playing');
          } else if (state === 'disconnected') {
            setStatus('reconnecting');
            clearDisconnectTimer();
            disconnectTimerRef.current = setTimeout(() => {
              void attemptIceRestart(recvTransport);
            }, DISCONNECTED_RESTART_DELAY_MS);
          } else if (state === 'failed') {
            clearDisconnectTimer();
            void attemptIceRestart(recvTransport);
          }
        });

        // 5. Consume producers
        const stream = new MediaStream();
        activeStreamRef.current = stream;

        const consumedCount = await consumeProducers(recvTransport, device, stream);

        if (!isMountedRef.current) return;

        if (consumedCount === 0) {
          cleanupMedia(false);
          setStatus('offline');
          return;
        }

        setMediaStream(stream);
        setStatus('playing');
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        const errorMsg =
          typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Failed to connect to stream';

        if (errorMsg.includes('MEDIA_OFFLINE') || errorMsg.includes('not currently live')) {
          cleanupMedia(false);
          setStatus('offline');
        } else {
          setError(errorMsg);
          setStatus('failed');
        }
      }
    },
    [channelId, ws, cleanupMedia, clearDisconnectTimer, attemptIceRestart, consumeProducers]
  );

  // Main lifecycle when channelId changes
  useEffect(() => {
    isMountedRef.current = true;
    void connectToStream(false);

    return () => {
      isMountedRef.current = false;
      cleanupMedia(false);
    };
  }, [connectToStream, cleanupMedia]);

  // Listen for realtime push events
  useEffect(() => {
    if (!channelId) return;

    // 1. media.newProducer
    const unsubNewProducer = ws.client.on<MediaNewProducerPayload>(
      'media.newProducer',
      async () => {
        if (!transportRef.current || !deviceRef.current || !activeStreamRef.current) {
          void connectToStream(statusRef.current === 'reconnecting');
          return;
        }

        try {
          const added = await consumeProducers(
            transportRef.current,
            deviceRef.current,
            activeStreamRef.current
          );
          if (added > 0) {
            // Trigger video element refresh if stream tracks updated
            setMediaStream(new MediaStream(activeStreamRef.current.getTracks()));
          }
          setStatus('playing');
        } catch {
          void connectToStream(true);
        }
      }
    );

    // 2. media.consumerClosed
    const unsubConsumerClosed = ws.client.on<MediaConsumerClosedPayload>(
      'media.consumerClosed',
      (data) => {
        if (data?.consumerId && consumersRef.current.has(data.consumerId)) {
          const consumer = consumersRef.current.get(data.consumerId);
          if (consumer) {
            try {
              consumer.close();
              if (activeStreamRef.current) {
                activeStreamRef.current.removeTrack(consumer.track);
              }
            } catch {
              // ignore
            }
            consumersRef.current.delete(data.consumerId);
          }
          if (videoConsumerIdRef.current === data.consumerId) {
            videoConsumerIdRef.current = null;
          }
        }

        // If stream is explicitly reconnecting (within 15s grace), keep reconnecting state!
        if (statusRef.current === 'reconnecting' && data?.consumerId) {
          return;
        }

        const hasLiveVideoTrack =
          activeStreamRef.current?.getVideoTracks().some((t) => t.readyState === 'live');

        if (!data?.consumerId || consumersRef.current.size === 0 || !hasLiveVideoTrack) {
          if (statusRef.current !== 'reconnecting') {
            setStatus('offline');
            cleanupMedia(false);
          }
        }
      }
    );

    // 3. media.layers (active simulcast layer from SFU)
    const unsubLayers = ws.client.on<MediaLayersPayload>('media.layers', (data) => {
      if (data && data.consumerId === videoConsumerIdRef.current) {
        setActiveLayers(data.layers ?? null);
      }
    });

    // 4. stream.reconnecting
    const unsubReconnecting = ws.client.on<StreamReconnectingPayload>(
      'stream.reconnecting',
      (data) => {
        if (!data?.channelId || data.channelId === channelId) {
          setStatus('reconnecting');
        }
      }
    );

    // 5. stream.live / stream.offline
    const unsubLive = ws.client.on<StreamLivePayload>('stream.live', (data) => {
      if (data?.channelId === channelId && statusRef.current === 'offline') {
        void connectToStream(false);
      }
    });

    const unsubOffline = ws.client.on<StreamOfflinePayload>('stream.offline', (data) => {
      if (data?.channelId === channelId) {
        cleanupMedia(false);
        setStatus('offline');
      }
    });

    // 6. Ws reconnect event: preserve video element with reconnecting overlay, then re-join/consume/resume
    const unsubStatus = ws.client.on('status', (newStatus) => {
      if (newStatus === 'reconnecting' || newStatus === 'closed') {
        if (statusRef.current === 'playing' || statusRef.current === 'connecting') {
          setStatus('reconnecting');
        }
      } else if (newStatus === 'open') {
        if (statusRef.current === 'reconnecting') {
          void connectToStream(true);
        }
      }
    });

    return () => {
      unsubNewProducer();
      unsubConsumerClosed();
      unsubLayers();
      unsubReconnecting();
      unsubLive();
      unsubOffline();
      unsubStatus();
    };
  }, [channelId, ws.client, connectToStream, consumeProducers, cleanupMedia]);

  return {
    status,
    error,
    mediaStream,
    quality,
    setQuality,
    activeLayers,
    retry: () => void connectToStream(false),
  };
}
