import type {
  ActiveLayersInfo,
  InboundPreviousSample,
  LiveStatsSnapshot,
  OutboundPreviousState,
  OutboundStreamStats,
  PublisherStatsSnapshot,
  RecordedScenarioRow,
  StatsReportLike,
} from './types';

export const CSV_COLUMNS = [
  'timestamp_iso',
  'scenario',
  'bitrate_kbps',
  'fps',
  'width',
  'height',
  'packets_lost',
  'loss_pct',
  'jitter_ms',
  'freeze_count',
  'nack_count',
  'pli_count',
  'rtt_ms',
  'candidate_type',
  'protocol',
  'layer',
] as const;

function num(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function str(val: unknown): string | null {
  return typeof val === 'string' && val.length > 0 ? val : null;
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function collectStats(reports: Array<StatsReportLike | null | undefined>): {
  byId: Map<string, Record<string, unknown>>;
  all: Record<string, unknown>[];
} {
  const byId = new Map<string, Record<string, unknown>>();
  const all: Record<string, unknown>[] = [];

  for (const report of reports) {
    if (!report || typeof report.forEach !== 'function') continue;
    report.forEach((stat, key) => {
      if (!stat || typeof stat !== 'object') return;
      const id = str(stat.id) ?? key;
      if (!byId.has(id)) {
        byId.set(id, stat);
        all.push(stat);
      }
    });
  }

  return { byId, all };
}

function extractNetworkInfo(
  byId: Map<string, Record<string, unknown>>,
  all: Record<string, unknown>[]
): {
  rttMs: number | null;
  candidateType: string | null;
  protocol: string | null;
  availableOutgoingBitrateKbps: number | null;
} {
  let selectedPair: Record<string, unknown> | undefined;

  // 1. Prefer selectedCandidatePairId from transport stat
  for (const stat of all) {
    if (stat.type === 'transport') {
      const pairId = str(stat.selectedCandidatePairId);
      if (pairId && byId.has(pairId)) {
        selectedPair = byId.get(pairId);
        break;
      }
    }
  }

  // 2. Fallback: nominated + succeeded (Chrome/Safari) or selected (Firefox)
  if (!selectedPair) {
    selectedPair = all.find(
      (s) =>
        s.type === 'candidate-pair' &&
        ((s.nominated === true && s.state === 'succeeded') || s.selected === true)
    );
  }

  // 3. Fallback: any succeeded candidate-pair
  if (!selectedPair) {
    selectedPair = all.find((s) => s.type === 'candidate-pair' && s.state === 'succeeded');
  }

  if (!selectedPair) {
    return {
      rttMs: null,
      candidateType: null,
      protocol: null,
      availableOutgoingBitrateKbps: null,
    };
  }

  const rawRtt = num(selectedPair.currentRoundTripTime);
  const rttMs = rawRtt !== null ? roundTo(rawRtt * 1000, 1) : null;

  const rawAvailOut = num(selectedPair.availableOutgoingBitrate);
  const availableOutgoingBitrateKbps =
    rawAvailOut !== null ? roundTo(rawAvailOut / 1000, 1) : null;

  const localId = str(selectedPair.localCandidateId);
  const remoteId = str(selectedPair.remoteCandidateId);
  const localCand = localId ? byId.get(localId) : undefined;
  const remoteCand = remoteId ? byId.get(remoteId) : undefined;

  const candidateType =
    str(localCand?.candidateType) ?? str(remoteCand?.candidateType) ?? null;

  const rawProtocol =
    str(localCand?.protocol) ??
    str(localCand?.relayProtocol) ??
    str(remoteCand?.protocol) ??
    null;
  const protocol = rawProtocol ? rawProtocol.toLowerCase() : null;

  return {
    rttMs,
    candidateType,
    protocol,
    availableOutgoingBitrateKbps,
  };
}

export function formatActiveLayer(activeLayers: ActiveLayersInfo | null | undefined): string | null {
  if (!activeLayers) return null;
  const tPart =
    activeLayers.temporalLayer !== undefined ? `T${activeLayers.temporalLayer}` : '';
  return `S${activeLayers.spatialLayer}${tPart}`;
}

export interface ComputeInboundParams {
  videoReport?: StatsReportLike | null;
  audioReport?: StatsReportLike | null;
  transportReport?: StatsReportLike | null;
  prev?: InboundPreviousSample | null;
  activeLayers?: ActiveLayersInfo | null;
  nowIso?: string;
}

export function computeInboundStats({
  videoReport,
  audioReport,
  transportReport,
  prev = null,
  activeLayers = null,
  nowIso = new Date().toISOString(),
}: ComputeInboundParams): {
  snapshot: LiveStatsSnapshot;
  nextPrev: InboundPreviousSample;
} {
  const { byId, all } = collectStats([videoReport, audioReport, transportReport]);

  const videoStat = all.find(
    (s) => s.type === 'inbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')
  );
  const audioStat = all.find(
    (s) => s.type === 'inbound-rtp' && (s.kind === 'audio' || s.mediaType === 'audio')
  );

  // Video metrics
  const vTs = num(videoStat?.timestamp);
  const vBytes = num(videoStat?.bytesReceived);
  const vFramesDecoded = num(videoStat?.framesDecoded);
  const vPacketsLost = num(videoStat?.packetsLost);
  const vPacketsRecv = num(videoStat?.packetsReceived);
  const vJbDelay = num(videoStat?.jitterBufferDelay);
  const vJbEmitted = num(videoStat?.jitterBufferEmittedCount);

  let bitrateKbps: number | null = null;
  if (
    vTs !== null &&
    vBytes !== null &&
    prev?.videoTimestampMs !== null &&
    prev?.videoTimestampMs !== undefined &&
    prev.videoBytesReceived !== null
  ) {
    const dtMs = vTs - prev.videoTimestampMs;
    const dBytes = vBytes - prev.videoBytesReceived;
    if (dtMs > 0 && dBytes >= 0) {
      bitrateKbps = roundTo((dBytes * 8) / dtMs, 1);
    }
  }

  let fps = num(videoStat?.framesPerSecond);
  if (fps !== null) {
    fps = roundTo(fps, 1);
  } else if (
    vTs !== null &&
    vFramesDecoded !== null &&
    prev?.videoTimestampMs !== null &&
    prev?.videoTimestampMs !== undefined &&
    prev.videoFramesDecoded !== null
  ) {
    const dtMs = vTs - prev.videoTimestampMs;
    const dFrames = vFramesDecoded - prev.videoFramesDecoded;
    if (dtMs > 0 && dFrames >= 0) {
      fps = roundTo((dFrames * 1000) / dtMs, 1);
    }
  }

  const width = num(videoStat?.frameWidth);
  const height = num(videoStat?.frameHeight);

  // Interval loss percentage
  let lossPct: number | null = null;
  if (
    vPacketsLost !== null &&
    vPacketsRecv !== null &&
    prev?.videoPacketsLost !== null &&
    prev?.videoPacketsLost !== undefined &&
    prev.videoPacketsReceived !== null
  ) {
    const dLost = Math.max(0, vPacketsLost - prev.videoPacketsLost);
    const dRecv = Math.max(0, vPacketsRecv - prev.videoPacketsReceived);
    const total = dLost + dRecv;
    if (total > 0) {
      lossPct = roundTo((dLost / total) * 100, 2);
    } else {
      lossPct = 0;
    }
  } else if (vPacketsLost !== null && vPacketsRecv !== null) {
    const total = Math.max(0, vPacketsLost) + Math.max(0, vPacketsRecv);
    if (total > 0) {
      lossPct = roundTo((Math.max(0, vPacketsLost) / total) * 100, 2);
    }
  }

  const rawJitter = num(videoStat?.jitter);
  const jitterMs = rawJitter !== null ? roundTo(rawJitter * 1000, 2) : null;

  const freezeCount = num(videoStat?.freezeCount);
  const rawFreezeDur = num(videoStat?.totalFreezesDuration);
  const totalFreezesDurationSec = rawFreezeDur !== null ? roundTo(rawFreezeDur, 2) : null;

  const nackCount = num(videoStat?.nackCount);
  const pliCount = num(videoStat?.pliCount);

  // Jitter buffer delay in ms per emitted frame
  let jitterBufferDelayMs: number | null = null;
  if (
    vJbDelay !== null &&
    vJbEmitted !== null &&
    prev?.videoJitterBufferDelay !== null &&
    prev?.videoJitterBufferDelay !== undefined &&
    prev.videoJitterBufferEmittedCount !== null
  ) {
    const dDelay = vJbDelay - prev.videoJitterBufferDelay;
    const dEmitted = vJbEmitted - prev.videoJitterBufferEmittedCount;
    if (dEmitted > 0 && dDelay >= 0) {
      jitterBufferDelayMs = roundTo((dDelay / dEmitted) * 1000, 1);
    }
  }
  if (jitterBufferDelayMs === null && vJbDelay !== null && vJbEmitted !== null && vJbEmitted > 0) {
    jitterBufferDelayMs = roundTo((vJbDelay / vJbEmitted) * 1000, 1);
  }

  // Audio metrics
  const aTs = num(audioStat?.timestamp);
  const aBytes = num(audioStat?.bytesReceived);
  const aConcealed = num(audioStat?.concealedSamples);
  const aTotalSamples = num(audioStat?.totalSamplesReceived);

  let audioBitrateKbps: number | null = null;
  if (
    aTs !== null &&
    aBytes !== null &&
    prev?.audioTimestampMs !== null &&
    prev?.audioTimestampMs !== undefined &&
    prev.audioBytesReceived !== null
  ) {
    const dtMs = aTs - prev.audioTimestampMs;
    const dBytes = aBytes - prev.audioBytesReceived;
    if (dtMs > 0 && dBytes >= 0) {
      audioBitrateKbps = roundTo((dBytes * 8) / dtMs, 1);
    }
  }

  let audioConcealmentRatio: number | null = null;
  if (
    aConcealed !== null &&
    aTotalSamples !== null &&
    prev?.audioConcealedSamples !== null &&
    prev?.audioConcealedSamples !== undefined &&
    prev.audioTotalSamplesReceived !== null
  ) {
    const dConcealed = Math.max(0, aConcealed - prev.audioConcealedSamples);
    const dTotal = Math.max(0, aTotalSamples - prev.audioTotalSamplesReceived);
    if (dTotal > 0) {
      audioConcealmentRatio = roundTo(dConcealed / dTotal, 4);
    }
  }
  if (
    audioConcealmentRatio === null &&
    aConcealed !== null &&
    aTotalSamples !== null &&
    aTotalSamples > 0
  ) {
    audioConcealmentRatio = roundTo(aConcealed / aTotalSamples, 4);
  }

  const net = extractNetworkInfo(byId, all);

  const snapshot: LiveStatsSnapshot = {
    timestampIso: nowIso,
    bitrateKbps,
    fps,
    width,
    height,
    packetsLost: vPacketsLost,
    lossPct,
    jitterMs,
    freezeCount,
    totalFreezesDurationSec,
    nackCount,
    pliCount,
    jitterBufferDelayMs,
    audioBitrateKbps,
    audioConcealmentRatio,
    rttMs: net.rttMs,
    candidateType: net.candidateType,
    protocol: net.protocol,
    layer: formatActiveLayer(activeLayers),
  };

  const nextPrev: InboundPreviousSample = {
    videoTimestampMs: vTs,
    videoBytesReceived: vBytes,
    videoFramesDecoded: vFramesDecoded,
    videoPacketsLost: vPacketsLost,
    videoPacketsReceived: vPacketsRecv,
    videoJitterBufferDelay: vJbDelay,
    videoJitterBufferEmittedCount: vJbEmitted,
    audioTimestampMs: aTs,
    audioBytesReceived: aBytes,
    audioConcealedSamples: aConcealed,
    audioTotalSamplesReceived: aTotalSamples,
  };

  return { snapshot, nextPrev };
}

export interface ComputeOutboundParams {
  videoReport?: StatsReportLike | null;
  transportReport?: StatsReportLike | null;
  prev?: OutboundPreviousState | null;
  nowIso?: string;
}

export function computeOutboundStats({
  videoReport,
  transportReport,
  prev = null,
  nowIso = new Date().toISOString(),
}: ComputeOutboundParams): {
  snapshot: PublisherStatsSnapshot;
  nextPrev: OutboundPreviousState;
} {
  const { byId, all } = collectStats([videoReport, transportReport]);

  const outboundVideoStats = all.filter(
    (s) => s.type === 'outbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')
  );

  const nextByKey: OutboundPreviousState['byKey'] = {};
  const streams: OutboundStreamStats[] = [];

  let totalBitrate = 0;
  let hasAnyBitrate = false;
  let totalRetransmitted = 0;
  let hasAnyRetransmitted = false;
  let primaryQualityLimitation: string | null = null;

  for (const stat of outboundVideoStats) {
    const rid = str(stat.rid) ?? 'single';
    const key = str(stat.id) ?? `${rid}:${String(stat.ssrc ?? '')}`;
    const ts = num(stat.timestamp);
    const bytesSent = num(stat.bytesSent);

    let bitrateKbps: number | null = null;
    const prevSample = prev?.byKey[key];
    if (ts !== null && bytesSent !== null) {
      nextByKey[key] = { timestampMs: ts, bytesSent };
      if (prevSample) {
        const dtMs = ts - prevSample.timestampMs;
        const dBytes = bytesSent - prevSample.bytesSent;
        if (dtMs > 0 && dBytes >= 0) {
          bitrateKbps = roundTo((dBytes * 8) / dtMs, 1);
          totalBitrate += bitrateKbps;
          hasAnyBitrate = true;
        }
      }
    }

    const retransmittedPacketsSent = num(stat.retransmittedPacketsSent);
    if (retransmittedPacketsSent !== null) {
      totalRetransmitted += retransmittedPacketsSent;
      hasAnyRetransmitted = true;
    }

    const qlr = str(stat.qualityLimitationReason);
    if (qlr && (primaryQualityLimitation === null || primaryQualityLimitation === 'none')) {
      primaryQualityLimitation = qlr;
    }

    const rawFps = num(stat.framesPerSecond);
    streams.push({
      rid,
      bitrateKbps,
      fps: rawFps !== null ? roundTo(rawFps, 1) : null,
      width: num(stat.frameWidth),
      height: num(stat.frameHeight),
      qualityLimitationReason: qlr,
      retransmittedPacketsSent,
    });
  }

  // Sort deterministically: r0, r1, r2, then others
  streams.sort((a, b) => a.rid.localeCompare(b.rid));

  const net = extractNetworkInfo(byId, all);

  return {
    snapshot: {
      timestampIso: nowIso,
      streams,
      totalBitrateKbps: hasAnyBitrate ? roundTo(totalBitrate, 1) : null,
      totalRetransmittedPackets: hasAnyRetransmitted ? totalRetransmitted : null,
      qualityLimitationReason: primaryQualityLimitation,
      availableOutgoingBitrateKbps: net.availableOutgoingBitrateKbps,
      rttMs: net.rttMs,
      candidateType: net.candidateType,
      protocol: net.protocol,
    },
    nextPrev: { byKey: nextByKey },
  };
}

export function snapshotToRecordedRow(
  snapshot: LiveStatsSnapshot,
  scenario: string
): RecordedScenarioRow {
  return {
    timestamp_iso: snapshot.timestampIso,
    scenario,
    bitrate_kbps: snapshot.bitrateKbps,
    fps: snapshot.fps,
    width: snapshot.width,
    height: snapshot.height,
    packets_lost: snapshot.packetsLost,
    loss_pct: snapshot.lossPct,
    jitter_ms: snapshot.jitterMs,
    freeze_count: snapshot.freezeCount,
    nack_count: snapshot.nackCount,
    pli_count: snapshot.pliCount,
    rtt_ms: snapshot.rttMs,
    candidate_type: snapshot.candidateType,
    protocol: snapshot.protocol,
    layer: snapshot.layer,
  };
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
    return '';
  }
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatStatsCsv(rows: RecordedScenarioRow[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((col) => escapeCsvCell(row[col])).join(',')
  );
  return [header, ...lines].join('\n');
}

export function formatDisplayMetric(
  value: number | string | null | undefined,
  options?: { decimals?: number; suffix?: string }
): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '-';
    const formatted =
      options?.decimals !== undefined ? value.toFixed(options.decimals) : String(value);
    return options?.suffix ? `${formatted}${options.suffix}` : formatted;
  }
  return options?.suffix ? `${value}${options.suffix}` : value;
}
