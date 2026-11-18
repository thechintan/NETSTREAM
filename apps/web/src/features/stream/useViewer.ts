import { useCallback, useEffect, useRef, useState } from 'react';
import { Device } from 'mediasoup-client';
import type { Transport, Consumer, RtpCapabilities, TransportOptions, RtpParameters } from 'mediasoup-client/lib/types';
import type {
  MediaJoinResponse,
  MediaCreateTransportResponse,
  ConsumerInfo,
  MediaNewProducerPayload,
  MediaConsumerClosedPayload,
} from '@netstream/shared';
import { useWs } from '../../lib/WsContext';

export type ViewerStatus = 'offline' | 'connecting' | 'playing' | 'reconnecting' | 'failed';

export interface UseViewerOptions {
  channelId?: string;
}

export function useViewer({ channelId }: UseViewerOptions) {
  const ws = useWs();
  const [status, setStatus] = useState<ViewerStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const activeStreamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);

  const cleanupMedia = useCallback(() => {
    // 1. Close consumers
    for (const consumer of consumersRef.current.values()) {
      try {
        consumer.close();
      } catch {
        // ignore
      }
    }
    consumersRef.current.clear();

    // 2. Close transport
    if (transportRef.current) {
      try {
        transportRef.current.close();
      } catch {
        // ignore
      }
      transportRef.current = null;
    }

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
  }, []);

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
      }

      return consumerIdsToResume.length;
    },
    [ws]
  );

  const connectToStream = useCallback(async () => {
    if (!channelId) {
      setStatus('offline');
      return;
    }

    cleanupMedia();
    setStatus('connecting');
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
        if (!isMountedRef.current) return;
        if (state === 'failed') {
          setStatus('failed');
          setError('WebRTC connection failed. Please check network/firewall settings.');
        } else if (state === 'disconnected') {
          setStatus('reconnecting');
        } else if (state === 'connected') {
          setStatus('playing');
        }
      });

      // 5. Consume producers
      const stream = new MediaStream();
      activeStreamRef.current = stream;

      const consumedCount = await consumeProducers(recvTransport, device, stream);

      if (!isMountedRef.current) return;

      if (consumedCount === 0) {
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
        setStatus('offline');
      } else {
        setError(errorMsg);
        setStatus('failed');
      }
    }
  }, [channelId, ws, cleanupMedia, consumeProducers]);

  // Main lifecycle when channelId changes
  useEffect(() => {
    isMountedRef.current = true;
    void connectToStream();

    return () => {
      isMountedRef.current = false;
      cleanupMedia();
    };
  }, [connectToStream, cleanupMedia]);

  // Listen for realtime push events: media.newProducer and media.consumerClosed
  useEffect(() => {
    if (!channelId) return;

    // 1. media.newProducer
    const unsubNewProducer = ws.client.on<MediaNewProducerPayload>(
      'media.newProducer',
      async () => {
        if (!transportRef.current || !deviceRef.current || !activeStreamRef.current) {
          // If viewer was offline when streamer produced new tracks, reconnect
          void connectToStream();
          return;
        }

        try {
          await consumeProducers(
            transportRef.current,
            deviceRef.current,
            activeStreamRef.current
          );
          setStatus('playing');
        } catch {
          // ignore error
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
        }

        // If all consumers or video track closed, switch to offline
        const hasLiveVideoTrack =
          activeStreamRef.current?.getVideoTracks().some((t) => t.readyState === 'live');

        if (!data?.consumerId || consumersRef.current.size === 0 || !hasLiveVideoTrack) {
          setStatus('offline');
          cleanupMedia();
        }
      }
    );

    // 3. Ws reconnect event
    const unsubStatus = ws.client.on('status', (newStatus) => {
      if (newStatus === 'open' && status === 'reconnecting') {
        void connectToStream();
      } else if (newStatus === 'reconnecting' || newStatus === 'closed') {
        if (status === 'playing') {
          setStatus('reconnecting');
        }
      }
    });

    return () => {
      unsubNewProducer();
      unsubConsumerClosed();
      unsubStatus();
    };
  }, [channelId, ws.client, status, connectToStream, consumeProducers, cleanupMedia]);

  return {
    status,
    error,
    mediaStream,
    retry: connectToStream,
  };
}
