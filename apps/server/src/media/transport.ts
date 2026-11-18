import type { TransportListenInfo, WebRtcTransportOptions } from 'mediasoup/node/lib/types.js';
import { config } from '../config/index.js';
import type { Room, CreateWebRtcTransportResult } from './types.js';

export interface CreateTransportOptions {
  announcedAddress?: string;
  listenIp?: string;
  initialAvailableOutgoingBitrate?: number;
  enableUdp?: boolean;
  enableTcp?: boolean;
  preferUdp?: boolean;
}

export async function createWebRtcTransport(
  room: Room,
  options?: CreateTransportOptions
): Promise<CreateWebRtcTransportResult> {
  const announcedAddress = options?.announcedAddress ?? config.PUBLIC_IP;
  const listenIp = options?.listenIp ?? '0.0.0.0';
  const enableUdp = options?.enableUdp ?? true;
  const enableTcp = options?.enableTcp ?? true;
  const preferUdp = options?.preferUdp ?? true;
  const initialAvailableOutgoingBitrate =
    options?.initialAvailableOutgoingBitrate ?? 1_000_000;

  const listenInfos: TransportListenInfo[] = [];

  if (enableUdp) {
    listenInfos.push({
      protocol: 'udp',
      ip: listenIp,
      announcedAddress,
    });
  }

  if (enableTcp) {
    listenInfos.push({
      protocol: 'tcp',
      ip: listenIp,
      announcedAddress,
    });
  }

  const transportOptions: WebRtcTransportOptions = {
    listenInfos,
    enableUdp,
    enableTcp,
    preferUdp,
    initialAvailableOutgoingBitrate,
  };

  const transport = await room.router.createWebRtcTransport(transportOptions);

  // Track the transport in the room
  room.transports.set(transport.id, transport);

  transport.on('routerclose', () => {
    room.transports.delete(transport.id);
  });

  transport.observer.on('close', () => {
    room.transports.delete(transport.id);
  });

  const params = {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };

  return {
    transport,
    params,
    clientParams: params,
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}
