import { z } from 'zod';

// Close codes as defined in PROJECT_CONTEXT.md
export const WS_CLOSE_CODES = {
  BAD_MESSAGE: 4400,
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  TOO_MANY_MESSAGES: 4429,
} as const;

export type WsCloseCode = (typeof WS_CLOSE_CODES)[keyof typeof WS_CLOSE_CODES];

// WebSocket error codes
export type WsErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN_TYPE';

// Generic envelope schema
export const wsEnvelopeSchema = z.object({
  t: z.string().min(1),
  id: z.string().optional(),
  d: z.unknown().optional(),
});

export type WsEnvelope = z.infer<typeof wsEnvelopeSchema>;

// Real payload schemas for chat.*
export const chatJoinPayloadSchema = z.object({
  channelId: z.string().uuid(),
});

export const chatLeavePayloadSchema = z.object({
  channelId: z.string().uuid(),
});

export const chatSendPayloadSchema = z.object({
  channelId: z.string().uuid(),
  text: z.string().trim().min(1, 'Message cannot be empty').max(500, 'Message cannot exceed 500 characters'),
});

// Real payload schemas for mod.*
export const modBanPayloadSchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
  reason: z.string().max(255).optional(),
});

export const modTimeoutPayloadSchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
  durationSeconds: z.number().int().positive().max(86400 * 30),
  reason: z.string().max(255).optional(),
});

export const modDeletePayloadSchema = z.object({
  channelId: z.string().uuid(),
  messageId: z.string().min(1),
});

export const modSlowPayloadSchema = z.object({
  channelId: z.string().uuid(),
  slowSeconds: z.number().int().min(0).max(3600),
});

// Real payload schema for user.subscribe
export const userSubscribePayloadSchema = z.object({
  channelId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

// TODO: Define strict mediasoup types in media task
export const mediaJoinPayloadSchema = z.any();
export const mediaCreateTransportPayloadSchema = z.any();
export const mediaConnectTransportPayloadSchema = z.any();
export const mediaProducePayloadSchema = z.any();
export const mediaConsumePayloadSchema = z.any();
export const mediaResumePayloadSchema = z.any();
export const mediaSetLayersPayloadSchema = z.any();
export const mediaRestartIcePayloadSchema = z.any();

// Test echo payload schema (for tests and diagnostics)
export const testEchoPayloadSchema = z.record(z.unknown()).optional().default({});

// Discriminated union of all client-to-server messages
export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('chat.join'), id: z.string().optional(), d: chatJoinPayloadSchema }),
  z.object({ t: z.literal('chat.leave'), id: z.string().optional(), d: chatLeavePayloadSchema }),
  z.object({ t: z.literal('chat.send'), id: z.string().optional(), d: chatSendPayloadSchema }),
  z.object({ t: z.literal('media.join'), id: z.string().optional(), d: mediaJoinPayloadSchema }),
  z.object({ t: z.literal('media.createTransport'), id: z.string().optional(), d: mediaCreateTransportPayloadSchema }),
  z.object({ t: z.literal('media.connectTransport'), id: z.string().optional(), d: mediaConnectTransportPayloadSchema }),
  z.object({ t: z.literal('media.produce'), id: z.string().optional(), d: mediaProducePayloadSchema }),
  z.object({ t: z.literal('media.consume'), id: z.string().optional(), d: mediaConsumePayloadSchema }),
  z.object({ t: z.literal('media.resume'), id: z.string().optional(), d: mediaResumePayloadSchema }),
  z.object({ t: z.literal('media.setLayers'), id: z.string().optional(), d: mediaSetLayersPayloadSchema }),
  z.object({ t: z.literal('media.restartIce'), id: z.string().optional(), d: mediaRestartIcePayloadSchema }),
  z.object({ t: z.literal('mod.ban'), id: z.string().optional(), d: modBanPayloadSchema }),
  z.object({ t: z.literal('mod.timeout'), id: z.string().optional(), d: modTimeoutPayloadSchema }),
  z.object({ t: z.literal('mod.delete'), id: z.string().optional(), d: modDeletePayloadSchema }),
  z.object({ t: z.literal('mod.slow'), id: z.string().optional(), d: modSlowPayloadSchema }),
  z.object({ t: z.literal('user.subscribe'), id: z.string().optional(), d: userSubscribePayloadSchema }),
  z.object({ t: z.literal('test.echo'), id: z.string().optional(), d: testEchoPayloadSchema }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage['t'];

// Server-to-client message types
export type ServerToClientPushType =
  | 'chat.message'
  | 'chat.deleted'
  | 'chat.cleared'
  | 'user.banned'
  | 'viewers.count'
  | 'stream.live'
  | 'stream.offline'
  | 'media.newProducer'
  | 'media.consumerClosed'
  | 'media.layers'
  | 'notify.live'
  | 'notify.follow';

export type ServerMessageType = 'ack' | 'error' | ServerToClientPushType;

export interface ServerAckMessage<T = unknown> {
  t: 'ack';
  id: string;
  d?: T;
}

export interface ServerErrorMessage {
  t: 'error';
  id?: string;
  d: {
    code: WsErrorCode;
    message: string;
    retryAfterMs?: number;
  };
}

export interface ServerPushMessage<T = unknown> {
  t: ServerToClientPushType;
  d: T;
}

export type ServerMessage<T = unknown> = ServerAckMessage<T> | ServerErrorMessage | ServerPushMessage<T>;
