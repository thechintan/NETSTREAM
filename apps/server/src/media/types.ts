import type {
  Router,
  Producer,
  Consumer,
  WebRtcTransport,
  IceParameters,
  IceCandidate,
  DtlsParameters,
} from 'mediasoup/node/lib/types.js';

export interface RoomPublisher {
  userId: string;
  connId: string;
}

export interface RoomViewer {
  userId?: string;
  connId: string;
  transport?: WebRtcTransport;
  consumers: Map<string, Consumer>;
}

export interface Room {
  channelId: string;
  router: Router;
  publisher?: RoomPublisher;
  producers: Map<string, Producer>;
  viewers: Map<string, RoomViewer>;
  transports: Map<string, WebRtcTransport>;
}

export interface WebRtcTransportParams {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

export interface CreateWebRtcTransportResult {
  transport: WebRtcTransport;
  params: WebRtcTransportParams;
  clientParams: WebRtcTransportParams;
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

export interface DebugWorkerInfo {
  pid: number;
  routerCount: number;
  closed: boolean;
}

export interface DebugRoomInfo {
  channelId: string;
  producers: number;
  viewers: number;
  transports: number;
}

export interface DebugMediaResponse {
  workers: DebugWorkerInfo[];
  rooms: DebugRoomInfo[];
}
