export interface ActiveLayersInfo {
  spatialLayer: number;
  temporalLayer?: number;
}

/**
 * Minimal duck-typed interface compatible with browser RTCStatsReport and test fixtures.
 */
export interface StatsReportLike {
  forEach(callbackfn: (value: Record<string, unknown>, key: string) => void): void;
  get?(key: string): Record<string, unknown> | undefined;
}

export interface InboundPreviousSample {
  videoTimestampMs: number | null;
  videoBytesReceived: number | null;
  videoFramesDecoded: number | null;
  videoPacketsLost: number | null;
  videoPacketsReceived: number | null;
  videoJitterBufferDelay: number | null;
  videoJitterBufferEmittedCount: number | null;
  audioTimestampMs: number | null;
  audioBytesReceived: number | null;
  audioConcealedSamples: number | null;
  audioTotalSamplesReceived: number | null;
}

export interface LiveStatsSnapshot {
  timestampIso: string;
  bitrateKbps: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  packetsLost: number | null;
  lossPct: number | null;
  jitterMs: number | null;
  freezeCount: number | null;
  totalFreezesDurationSec: number | null;
  nackCount: number | null;
  pliCount: number | null;
  jitterBufferDelayMs: number | null;
  audioBitrateKbps: number | null;
  audioConcealmentRatio: number | null;
  rttMs: number | null;
  candidateType: string | null;
  protocol: string | null;
  layer: string | null;
}

export interface RecordedScenarioRow {
  timestamp_iso: string;
  scenario: string;
  bitrate_kbps: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  packets_lost: number | null;
  loss_pct: number | null;
  jitter_ms: number | null;
  freeze_count: number | null;
  nack_count: number | null;
  pli_count: number | null;
  rtt_ms: number | null;
  candidate_type: string | null;
  protocol: string | null;
  layer: string | null;
}

export interface OutboundRidPreviousSample {
  timestampMs: number;
  bytesSent: number;
}

export interface OutboundPreviousState {
  byKey: Record<string, OutboundRidPreviousSample>;
}

export interface OutboundStreamStats {
  rid: string;
  bitrateKbps: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  qualityLimitationReason: string | null;
  retransmittedPacketsSent: number | null;
}

export interface PublisherStatsSnapshot {
  timestampIso: string;
  streams: OutboundStreamStats[];
  totalBitrateKbps: number | null;
  totalRetransmittedPackets: number | null;
  qualityLimitationReason: string | null;
  availableOutgoingBitrateKbps: number | null;
  rttMs: number | null;
  candidateType: string | null;
  protocol: string | null;
}
