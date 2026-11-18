import { useEffect, useRef, useState, useCallback } from 'react';
import { Device } from 'mediasoup-client';
import type { Transport, Producer, RtpCapabilities, TransportOptions } from 'mediasoup-client/lib/types';
import type {
  MediaJoinResponse,
  MediaCreateTransportResponse,
} from '@netstream/shared';
import { useWs } from '../../lib/WsContext';

export type PublisherStatus = 'idle' | 'connecting' | 'live' | 'error';

export interface UsePublisherOptions {
  channelId?: string;
}

export function usePublisher({ channelId }: UsePublisherOptions) {
  const ws = useWs();
  const [status, setStatus] = useState<PublisherStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const audioProducerRef = useRef<Producer | null>(null);
  const videoProducerRef = useRef<Producer | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);

  const stopBroadcast = useCallback(() => {
    // 1. Close producers
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

    // 2. Close transport
    if (transportRef.current) {
      try {
        transportRef.current.close();
      } catch {
        // ignore
      }
      transportRef.current = null;
    }

    // 3. Stop media stream tracks
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

    setStatus('idle');
  }, []);

  const startBroadcast = useCallback(
    async (stream: MediaStream) => {
      if (!channelId) {
        setStatus('error');
        setError('No active channel ID for broadcasting');
        return;
      }

      setStatus('connecting');
      setError(null);
      activeStreamRef.current = stream;

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
          if (state === 'failed' || state === 'closed') {
            setStatus('error');
            setError(`WebRTC connection state: ${state}. Verify network/firewall settings.`);
          }
        });

        // 4. Produce audio track
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          const audioProducer = await sendTransport.produce({
            track: audioTrack,
          });
          audioProducerRef.current = audioProducer;
        }

        // 5. Produce video track with maxBitrate 2_500_000
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const videoProducer = await sendTransport.produce({
            track: videoTrack,
            encodings: [
              {
                maxBitrate: 2_500_000,
              },
            ],
          });
          videoProducerRef.current = videoProducer;
        }

        setStatus('live');
      } catch (err: unknown) {
        const errorMsg =
          typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Failed to start broadcast';
        setError(errorMsg);
        setStatus('error');
        stopBroadcast();
      }
    },
    [channelId, ws, stopBroadcast]
  );

  const replaceVideoTrack = useCallback(async (newTrack: MediaStreamTrack) => {
    if (videoProducerRef.current) {
      await videoProducerRef.current.replaceTrack({ track: newTrack });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopBroadcast();
    };
  }, [stopBroadcast]);

  return {
    status,
    error,
    startBroadcast,
    stopBroadcast,
    replaceVideoTrack,
    isLive: status === 'live',
  };
}
