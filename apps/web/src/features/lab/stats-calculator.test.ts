import { describe, expect, it } from 'vitest';
import {
  CSV_COLUMNS,
  computeInboundStats,
  computeOutboundStats,
  formatDisplayMetric,
  formatStatsCsv,
  snapshotToRecordedRow,
} from './stats-calculator';
import type { StatsReportLike } from './types';

function makeReport(entries: Array<Record<string, unknown>>): StatsReportLike {
  const map = new Map<string, Record<string, unknown>>();
  entries.forEach((entry, idx) => {
    const id = typeof entry.id === 'string' ? entry.id : `stat-${idx}`;
    map.set(id, { id, ...entry });
  });
  return map;
}

describe('stats-calculator (Task 17)', () => {
  it('computes inbound video, audio, and candidate-pair delta metrics accurately', () => {
    const t0Video = makeReport([
      {
        id: 'inbound-v',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 1000,
        bytesReceived: 100_000,
        framesDecoded: 30,
        framesPerSecond: 30,
        frameWidth: 1280,
        frameHeight: 720,
        packetsLost: 2,
        packetsReceived: 98,
        jitter: 0.012,
        freezeCount: 1,
        totalFreezesDuration: 0.35,
        nackCount: 4,
        pliCount: 1,
        jitterBufferDelay: 1.5,
        jitterBufferEmittedCount: 30,
      },
      {
        id: 'transport-1',
        type: 'transport',
        selectedCandidatePairId: 'pair-1',
      },
      {
        id: 'pair-1',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        currentRoundTripTime: 0.042,
        localCandidateId: 'loc-1',
        remoteCandidateId: 'rem-1',
      },
      {
        id: 'loc-1',
        type: 'local-candidate',
        candidateType: 'srflx',
        protocol: 'UDP',
      },
    ]);

    const t0Audio = makeReport([
      {
        id: 'inbound-a',
        type: 'inbound-rtp',
        kind: 'audio',
        timestamp: 1000,
        bytesReceived: 10_000,
        concealedSamples: 100,
        totalSamplesReceived: 48_000,
      },
    ]);

    const first = computeInboundStats({
      videoReport: t0Video,
      audioReport: t0Audio,
      activeLayers: { spatialLayer: 2, temporalLayer: 2 },
      nowIso: '2026-11-18T12:00:00.000Z',
    });

    // First sample has no prior timestamp, so bitrate deltas are null
    expect(first.snapshot.bitrateKbps).toBeNull();
    expect(first.snapshot.audioBitrateKbps).toBeNull();
    expect(first.snapshot.rttMs).toBe(42);
    expect(first.snapshot.candidateType).toBe('srflx');
    expect(first.snapshot.protocol).toBe('udp');
    expect(first.snapshot.layer).toBe('S2T2');

    // Second sample 1000ms later:
    // Video: +250,000 bytes => 2000 kbps; +5 lost, +95 received => 5% loss
    // JB delay delta: +1.2s over +30 emitted => 40 ms/frame
    // Audio: +8,000 bytes => 64 kbps; +480 concealed / +48,000 samples => 0.01 ratio
    const t1Video = makeReport([
      {
        id: 'inbound-v',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 2000,
        bytesReceived: 350_000,
        framesDecoded: 60,
        framesPerSecond: 30,
        frameWidth: 1280,
        frameHeight: 720,
        packetsLost: 7,
        packetsReceived: 193,
        jitter: 0.0155,
        freezeCount: 2,
        totalFreezesDuration: 0.85,
        nackCount: 9,
        pliCount: 2,
        jitterBufferDelay: 2.7,
        jitterBufferEmittedCount: 60,
      },
      {
        id: 'transport-1',
        type: 'transport',
        selectedCandidatePairId: 'pair-1',
      },
      {
        id: 'pair-1',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        currentRoundTripTime: 0.055,
        localCandidateId: 'loc-1',
      },
      {
        id: 'loc-1',
        type: 'local-candidate',
        candidateType: 'relay',
        protocol: 'tcp',
      },
    ]);

    const t1Audio = makeReport([
      {
        id: 'inbound-a',
        type: 'inbound-rtp',
        kind: 'audio',
        timestamp: 2000,
        bytesReceived: 18_000,
        concealedSamples: 580,
        totalSamplesReceived: 96_000,
      },
    ]);

    const second = computeInboundStats({
      videoReport: t1Video,
      audioReport: t1Audio,
      prev: first.nextPrev,
      activeLayers: { spatialLayer: 1, temporalLayer: 2 },
      nowIso: '2026-11-18T12:00:01.000Z',
    });

    expect(second.snapshot.bitrateKbps).toBe(2000);
    expect(second.snapshot.fps).toBe(30);
    expect(second.snapshot.width).toBe(1280);
    expect(second.snapshot.height).toBe(720);
    expect(second.snapshot.packetsLost).toBe(7);
    expect(second.snapshot.lossPct).toBe(5);
    expect(second.snapshot.jitterMs).toBe(15.5);
    expect(second.snapshot.freezeCount).toBe(2);
    expect(second.snapshot.totalFreezesDurationSec).toBe(0.85);
    expect(second.snapshot.nackCount).toBe(9);
    expect(second.snapshot.pliCount).toBe(2);
    expect(second.snapshot.jitterBufferDelayMs).toBe(40);
    expect(second.snapshot.audioBitrateKbps).toBe(64);
    expect(second.snapshot.audioConcealmentRatio).toBe(0.01);
    expect(second.snapshot.rttMs).toBe(55);
    expect(second.snapshot.candidateType).toBe('relay');
    expect(second.snapshot.protocol).toBe('tcp');
    expect(second.snapshot.layer).toBe('S1T2');
  });

  it('computes outbound simulcast publisher stats per rid and available outgoing bitrate', () => {
    const t0 = makeReport([
      {
        id: 'out-r0',
        type: 'outbound-rtp',
        kind: 'video',
        rid: 'r0',
        timestamp: 1000,
        bytesSent: 10_000,
        frameWidth: 320,
        frameHeight: 180,
        framesPerSecond: 30,
        qualityLimitationReason: 'none',
        retransmittedPacketsSent: 1,
      },
      {
        id: 'out-r2',
        type: 'outbound-rtp',
        kind: 'video',
        rid: 'r2',
        timestamp: 1000,
        bytesSent: 100_000,
        frameWidth: 1280,
        frameHeight: 720,
        framesPerSecond: 30,
        qualityLimitationReason: 'bandwidth',
        retransmittedPacketsSent: 5,
      },
    ]);

    const t1 = makeReport([
      {
        id: 'out-r0',
        type: 'outbound-rtp',
        kind: 'video',
        rid: 'r0',
        timestamp: 2000,
        bytesSent: 28_750, // +18,750 B => 150 kbps
        frameWidth: 320,
        frameHeight: 180,
        framesPerSecond: 30,
        qualityLimitationReason: 'none',
        retransmittedPacketsSent: 2,
      },
      {
        id: 'out-r2',
        type: 'outbound-rtp',
        kind: 'video',
        rid: 'r2',
        timestamp: 2000,
        bytesSent: 350_000, // +250,000 B => 2000 kbps
        frameWidth: 1280,
        frameHeight: 720,
        framesPerSecond: 30,
        qualityLimitationReason: 'bandwidth',
        retransmittedPacketsSent: 12,
      },
    ]);

    const transportReport = makeReport([
      {
        id: 'pair-pub',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        currentRoundTripTime: 0.028,
        availableOutgoingBitrate: 3_200_000,
        localCandidateId: 'loc-pub',
      },
      {
        id: 'loc-pub',
        type: 'local-candidate',
        candidateType: 'host',
        protocol: 'udp',
      },
    ]);

    const first = computeOutboundStats({ videoReport: t0, transportReport });
    const second = computeOutboundStats({
      videoReport: t1,
      transportReport,
      prev: first.nextPrev,
    });

    expect(second.snapshot.streams.map((s) => s.rid)).toEqual(['r0', 'r2']);
    expect(second.snapshot.streams[0].bitrateKbps).toBe(150);
    expect(second.snapshot.streams[1].bitrateKbps).toBe(2000);
    expect(second.snapshot.totalBitrateKbps).toBe(2150);
    expect(second.snapshot.totalRetransmittedPackets).toBe(14);
    expect(second.snapshot.qualityLimitationReason).toBe('bandwidth');
    expect(second.snapshot.availableOutgoingBitrateKbps).toBe(3200);
    expect(second.snapshot.rttMs).toBe(28);
    expect(second.snapshot.candidateType).toBe('host');
    expect(second.snapshot.protocol).toBe('udp');
  });

  it('handles missing Safari/Firefox fields gracefully without errors and formats as "-"', () => {
    const sparseReport = makeReport([
      {
        id: 'inbound-sparse',
        type: 'inbound-rtp',
        mediaType: 'video',
        timestamp: 5000,
        bytesReceived: 12_345,
        // Missing freezeCount, nackCount, pliCount, jitter, jitterBufferEmittedCount, framesPerSecond
      },
    ]);

    const { snapshot } = computeInboundStats({
      videoReport: sparseReport,
      audioReport: null,
      transportReport: null,
      activeLayers: null,
    });

    expect(snapshot.bitrateKbps).toBeNull();
    expect(snapshot.freezeCount).toBeNull();
    expect(snapshot.jitterBufferDelayMs).toBeNull();
    expect(snapshot.audioConcealmentRatio).toBeNull();
    expect(snapshot.rttMs).toBeNull();
    expect(snapshot.candidateType).toBeNull();
    expect(snapshot.protocol).toBeNull();
    expect(snapshot.layer).toBeNull();

    expect(formatDisplayMetric(snapshot.bitrateKbps, { decimals: 1, suffix: ' kbps' })).toBe('-');
    expect(formatDisplayMetric(snapshot.candidateType)).toBe('-');
    expect(formatDisplayMetric(Number.NaN)).toBe('-');
  });

  it('serializes recorded stats rows to CSV with exact required columns and escaping', () => {
    const row1 = snapshotToRecordedRow(
      {
        timestampIso: '2026-11-18T12:00:01.000Z',
        bitrateKbps: 1850.5,
        fps: 30,
        width: 1280,
        height: 720,
        packetsLost: 3,
        lossPct: 1.25,
        jitterMs: 8.4,
        freezeCount: 0,
        totalFreezesDurationSec: 0,
        nackCount: 2,
        pliCount: 1,
        jitterBufferDelayMs: 22.1,
        audioBitrateKbps: 64,
        audioConcealmentRatio: 0,
        rttMs: 34.5,
        candidateType: 'host',
        protocol: 'udp',
        layer: 'S2T2',
      },
      'loss-5pct-run1'
    );

    const row2 = snapshotToRecordedRow(
      {
        timestampIso: '2026-11-18T12:00:02.000Z',
        bitrateKbps: null,
        fps: null,
        width: null,
        height: null,
        packetsLost: null,
        lossPct: null,
        jitterMs: null,
        freezeCount: null,
        totalFreezesDurationSec: null,
        nackCount: null,
        pliCount: null,
        jitterBufferDelayMs: null,
        audioBitrateKbps: null,
        audioConcealmentRatio: null,
        rttMs: null,
        candidateType: null,
        protocol: null,
        layer: null,
      },
      'run, "quoted"'
    );

    const csv = formatStatsCsv([row1, row2]);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'timestamp_iso,scenario,bitrate_kbps,fps,width,height,packets_lost,loss_pct,jitter_ms,freeze_count,nack_count,pli_count,rtt_ms,candidate_type,protocol,layer'
    );
    expect(lines[0].split(',')).toEqual([...CSV_COLUMNS]);
    expect(lines[1]).toBe(
      '2026-11-18T12:00:01.000Z,loss-5pct-run1,1850.5,30,1280,720,3,1.25,8.4,0,2,1,34.5,host,udp,S2T2'
    );
    expect(lines[2]).toBe('2026-11-18T12:00:02.000Z,"run, ""quoted""",,,,,,,,,,,,,,');
  });
});
