import React, { useEffect, useRef, useState } from 'react';
import { getForceRelay, setForceRelay, subscribeForceRelay } from './ice-config';
import { Sparkline } from './Sparkline';
import { computeOutboundStats, formatDisplayMetric } from './stats-calculator';
import type {
  OutboundPreviousState,
  PublisherStatsSnapshot,
  StatsReportLike,
} from './types';

export interface PublisherStatsSource {
  videoReport: StatsReportLike | null;
  transportReport: StatsReportLike | null;
}

export interface StudioStatsOverlayProps {
  visible: boolean;
  onClose: () => void;
  getStats: () => Promise<PublisherStatsSource>;
  onRelayPolicyChange?: (forceRelay: boolean) => void;
}

const HISTORY_LIMIT = 60;

export const StudioStatsOverlay: React.FC<StudioStatsOverlayProps> = ({
  visible,
  onClose,
  getStats,
  onRelayPolicyChange,
}) => {
  const [snapshot, setSnapshot] = useState<PublisherStatsSnapshot | null>(null);
  const [bitrateHistory, setBitrateHistory] = useState<Array<number | null>>([]);
  const [availHistory, setAvailHistory] = useState<Array<number | null>>([]);
  const [forceRelay, setForceRelayState] = useState<boolean>(getForceRelay);
  const prevStateRef = useRef<OutboundPreviousState | null>(null);

  useEffect(() => subscribeForceRelay(setForceRelayState), []);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    const sample = async () => {
      try {
        const { videoReport, transportReport } = await getStats();
        if (cancelled) return;

        const { snapshot: nextSnap, nextPrev } = computeOutboundStats({
          videoReport,
          transportReport,
          prev: prevStateRef.current,
        });

        prevStateRef.current = nextPrev;
        setSnapshot(nextSnap);
        setBitrateHistory((prev) => [
          ...prev.slice(-(HISTORY_LIMIT - 1)),
          nextSnap.totalBitrateKbps,
        ]);
        setAvailHistory((prev) => [
          ...prev.slice(-(HISTORY_LIMIT - 1)),
          nextSnap.availableOutgoingBitrateKbps,
        ]);
      } catch {
        // Ignore transient browser getStats() errors
      }
    };

    void sample();
    const intervalId = setInterval(() => {
      void sample();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [visible, getStats]);

  if (!visible) return null;

  const candidateDisplay =
    snapshot?.candidateType || snapshot?.protocol
      ? `${snapshot.candidateType ?? '-'} / ${snapshot.protocol ?? '-'}`
      : '-';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute top-3 right-3 z-30 w-[330px] sm:w-[380px] max-h-[calc(100%-3rem)] overflow-y-auto rounded-xl bg-slate-950/90 border border-slate-700/80 backdrop-blur-md shadow-2xl p-3 text-slate-200 select-text"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-100">
            Outbound Publisher Stats
          </h4>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
            Key: S
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors"
          title="Hide publisher stats (S)"
        >
          ✕
        </button>
      </div>

      {/* Sparklines */}
      <div className="grid grid-cols-2 gap-1.5 mb-2.5">
        <Sparkline
          label="Total Out"
          values={bitrateHistory}
          color="#38bdf8"
          unit=" kbps"
          decimals={0}
        />
        <Sparkline
          label="Avail Out"
          values={availHistory}
          color="#34d399"
          unit=" kbps"
          decimals={0}
        />
      </div>

      {/* Per-RID Outbound Streams Table */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2 mb-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
          Outbound-RTP Layers (Bitrate per RID)
        </div>
        {snapshot && snapshot.streams.length > 0 ? (
          <div className="space-y-1 text-[11px] font-mono">
            <div className="grid grid-cols-4 text-[10px] text-slate-500 border-b border-slate-800 pb-0.5">
              <span>RID</span>
              <span className="text-right">Bitrate</span>
              <span className="text-right">Res/FPS</span>
              <span className="text-right">Retx</span>
            </div>
            {snapshot.streams.map((s) => (
              <div key={s.rid} className="grid grid-cols-4 items-center">
                <span className="text-purple-300 font-semibold">{s.rid}</span>
                <span className="text-right text-slate-100">
                  {formatDisplayMetric(s.bitrateKbps, { decimals: 0, suffix: 'k' })}
                </span>
                <span className="text-right text-slate-300 text-[10px]">
                  {s.width && s.height ? `${s.height}p` : '-'}
                  {s.fps !== null ? `@${Math.round(s.fps)}` : ''}
                </span>
                <span className="text-right text-amber-300">
                  {formatDisplayMetric(s.retransmittedPacketsSent)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] font-mono text-slate-500">
            No active outbound-rtp video streams
          </p>
        )}
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono bg-slate-900/60 border border-slate-800/80 rounded-lg p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">Quality Limit</span>
          <span className="text-amber-300 font-semibold truncate">
            {formatDisplayMetric(snapshot?.qualityLimitationReason)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">Retx Pkts</span>
          <span className="text-slate-100 font-semibold">
            {formatDisplayMetric(snapshot?.totalRetransmittedPackets)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">Avail Out</span>
          <span className="text-emerald-300 font-semibold">
            {formatDisplayMetric(snapshot?.availableOutgoingBitrateKbps, {
              decimals: 0,
              suffix: ' kbps',
            })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">RTT</span>
          <span className="text-slate-100 font-semibold">
            {formatDisplayMetric(snapshot?.rttMs, { decimals: 1, suffix: ' ms' })}
          </span>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-2 pt-0.5 border-t border-slate-800/70">
          <span className="text-slate-400">Candidate</span>
          <span className="text-slate-100 font-semibold">{candidateDisplay}</span>
        </div>
      </div>

      {/* Dev-only ICE Transport Policy Toggle (TURN Relay testing) */}
      {import.meta.env.DEV && (
        <div className="border-t border-slate-800 mt-2 pt-2 flex items-center justify-between gap-2">
          <label
            htmlFor="studio-force-relay"
            className="text-[11px] text-amber-300 font-medium flex items-center gap-1.5 cursor-pointer select-none"
          >
            <input
              id="studio-force-relay"
              type="checkbox"
              checked={forceRelay}
              onChange={(e) => {
                const next = e.target.checked;
                setForceRelay(next);
                onRelayPolicyChange?.(next);
              }}
              className="rounded border-slate-600 bg-slate-900 text-amber-500 focus:ring-amber-500"
            />
            <span>Force TURN relay (DEV)</span>
          </label>
          <span className="text-[10px] font-mono text-slate-400">
            policy: {forceRelay ? 'relay' : 'all'}
          </span>
        </div>
      )}
    </div>
  );
};
