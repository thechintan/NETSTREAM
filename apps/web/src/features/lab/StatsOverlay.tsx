import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getForceRelay, setForceRelay, subscribeForceRelay } from './ice-config';
import { Sparkline } from './Sparkline';
import {
  computeInboundStats,
  formatDisplayMetric,
  formatStatsCsv,
  snapshotToRecordedRow,
} from './stats-calculator';
import type {
  ActiveLayersInfo,
  InboundPreviousSample,
  LiveStatsSnapshot,
  RecordedScenarioRow,
  StatsReportLike,
} from './types';

export interface WindowStatsHook {
  getSnapshot: () => Promise<LiveStatsSnapshot>;
  latest: LiveStatsSnapshot | null;
  history: LiveStatsSnapshot[];
}

declare global {
  interface Window {
    __stats?: WindowStatsHook;
  }
}

export interface ViewerStatsSource {
  videoReport: StatsReportLike | null;
  audioReport: StatsReportLike | null;
  transportReport: StatsReportLike | null;
}

export interface StatsOverlayProps {
  visible: boolean;
  onClose: () => void;
  getStats: () => Promise<ViewerStatsSource>;
  activeLayers: ActiveLayersInfo | null;
  onRelayPolicyChange?: (forceRelay: boolean) => void;
}

const HISTORY_LIMIT = 60;

export const StatsOverlay: React.FC<StatsOverlayProps> = ({
  visible,
  onClose,
  getStats,
  activeLayers,
  onRelayPolicyChange,
}) => {
  const [snapshot, setSnapshot] = useState<LiveStatsSnapshot | null>(null);
  const [bitrateHistory, setBitrateHistory] = useState<Array<number | null>>([]);
  const [lossHistory, setLossHistory] = useState<Array<number | null>>([]);
  const [rttHistory, setRttHistory] = useState<Array<number | null>>([]);
  const [forceRelay, setForceRelayState] = useState<boolean>(getForceRelay);

  useEffect(() => subscribeForceRelay(setForceRelayState), []);

  // Recorder state
  const [scenario, setScenario] = useState('loss-5pct-run1');
  const [isRecording, setIsRecording] = useState(false);
  const [recordedRows, setRecordedRows] = useState<RecordedScenarioRow[]>([]);

  const prevSampleRef = useRef<InboundPreviousSample | null>(null);
  const activeLayersRef = useRef<ActiveLayersInfo | null>(activeLayers);
  const isRecordingRef = useRef(isRecording);
  const scenarioRef = useRef(scenario);
  const latestSnapshotRef = useRef<LiveStatsSnapshot | null>(null);
  const snapshotHistoryRef = useRef<LiveStatsSnapshot[]>([]);

  activeLayersRef.current = activeLayers;
  isRecordingRef.current = isRecording;
  scenarioRef.current = scenario;

  const sampleOnce = useCallback(async (): Promise<LiveStatsSnapshot> => {
    const { videoReport, audioReport, transportReport } = await getStats();
    const { snapshot: nextSnap, nextPrev } = computeInboundStats({
      videoReport,
      audioReport,
      transportReport,
      prev: prevSampleRef.current,
      activeLayers: activeLayersRef.current,
    });
    prevSampleRef.current = nextPrev;
    latestSnapshotRef.current = nextSnap;
    snapshotHistoryRef.current = [
      ...snapshotHistoryRef.current.slice(-(HISTORY_LIMIT - 1)),
      nextSnap,
    ];
    return nextSnap;
  }, [getStats]);

  // Expose window.__stats hook for automated Playwright experiments (viewers.ts)
  useEffect(() => {
    window.__stats = {
      getSnapshot: sampleOnce,
      get latest() {
        return latestSnapshotRef.current;
      },
      get history() {
        return snapshotHistoryRef.current;
      },
    };
    return () => {
      delete window.__stats;
    };
  }, [sampleOnce]);

  // Poll getStats() every 1 second while overlay is visible or actively recording
  useEffect(() => {
    if (!visible && !isRecording) return;

    let cancelled = false;

    const sample = async () => {
      try {
        const nextSnap = await sampleOnce();
        if (cancelled) return;

        setSnapshot(nextSnap);

        setBitrateHistory((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), nextSnap.bitrateKbps]);
        setLossHistory((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), nextSnap.lossPct]);
        setRttHistory((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), nextSnap.rttMs]);

        if (isRecordingRef.current) {
          const row = snapshotToRecordedRow(
            nextSnap,
            scenarioRef.current.trim() || 'unlabeled'
          );
          setRecordedRows((prev) => [...prev, row]);
        }
      } catch {
        // Gracefully ignore transient getStats() failures across browsers
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
  }, [visible, isRecording, sampleOnce]);

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      setIsRecording(false);
    } else {
      setRecordedRows([]);
      setIsRecording(true);
    }
  }, [isRecording]);

  const handleDownloadCsv = useCallback(() => {
    if (recordedRows.length === 0) return;
    const csv = formatStatsCsv(recordedRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const safeLabel = (scenario.trim() || 'netstream-stats').replace(/[^a-zA-Z0-9_-]/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [recordedRows, scenario]);

  if (!visible) return null;

  const resolutionDisplay =
    snapshot?.width !== null &&
    snapshot?.width !== undefined &&
    snapshot?.height !== null &&
    snapshot?.height !== undefined
      ? `${snapshot.width}x${snapshot.height}`
      : '-';

  const candidateDisplay =
    snapshot?.candidateType || snapshot?.protocol
      ? `${snapshot.candidateType ?? '-'} / ${snapshot.protocol ?? '-'}`
      : '-';

  const concealmentDisplay =
    snapshot?.audioConcealmentRatio !== null && snapshot?.audioConcealmentRatio !== undefined
      ? `${(snapshot.audioConcealmentRatio * 100).toFixed(2)}%`
      : '-';

  const freezeDisplay =
    snapshot?.freezeCount !== null && snapshot?.freezeCount !== undefined
      ? `${snapshot.freezeCount} (${formatDisplayMetric(snapshot.totalFreezesDurationSec, { decimals: 2, suffix: 's' })})`
      : '-';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      className="absolute top-3 left-3 z-30 w-[340px] sm:w-[410px] max-h-[calc(100%-5rem)] overflow-y-auto rounded-xl bg-slate-950/90 border border-slate-700/80 backdrop-blur-md shadow-2xl p-3 text-slate-200 select-text"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-100">
            WebRTC Network Stats
          </h4>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
            Key: S
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors"
          title="Hide stats (S)"
        >
          ✕
        </button>
      </div>

      {/* Sparklines (last 60s) */}
      <div className="grid grid-cols-3 gap-1.5 mb-2.5">
        <Sparkline
          label="Bitrate"
          values={bitrateHistory}
          color="#38bdf8"
          unit=" kbps"
          decimals={0}
        />
        <Sparkline
          label="Loss"
          values={lossHistory}
          color="#fb7185"
          unit="%"
          decimals={2}
        />
        <Sparkline
          label="RTT"
          values={rttHistory}
          color="#a78bfa"
          unit=" ms"
          decimals={0}
        />
      </div>

      {/* Core Metrics Grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono bg-slate-900/60 border border-slate-800/80 rounded-lg p-2 mb-2.5">
        <MetricRow
          label="Video Bitrate"
          value={formatDisplayMetric(snapshot?.bitrateKbps, { decimals: 1, suffix: ' kbps' })}
        />
        <MetricRow
          label="FPS / Res"
          value={`${formatDisplayMetric(snapshot?.fps, { decimals: 1 })} / ${resolutionDisplay}`}
        />
        <MetricRow
          label="Packets Lost"
          value={`${formatDisplayMetric(snapshot?.packetsLost)} (${formatDisplayMetric(snapshot?.lossPct, { decimals: 2, suffix: '%' })})`}
        />
        <MetricRow
          label="Jitter"
          value={formatDisplayMetric(snapshot?.jitterMs, { decimals: 2, suffix: ' ms' })}
        />
        <MetricRow label="Freezes" value={freezeDisplay} />
        <MetricRow
          label="NACK / PLI"
          value={`${formatDisplayMetric(snapshot?.nackCount)} / ${formatDisplayMetric(snapshot?.pliCount)}`}
        />
        <MetricRow
          label="JB Delay/Frame"
          value={formatDisplayMetric(snapshot?.jitterBufferDelayMs, { decimals: 1, suffix: ' ms' })}
        />
        <MetricRow
          label="Audio Bitrate"
          value={formatDisplayMetric(snapshot?.audioBitrateKbps, { decimals: 1, suffix: ' kbps' })}
        />
        <MetricRow label="Audio Conceal" value={concealmentDisplay} />
        <MetricRow
          label="RTT (Pair)"
          value={formatDisplayMetric(snapshot?.rttMs, { decimals: 1, suffix: ' ms' })}
        />
        <MetricRow label="Candidate" value={candidateDisplay} />
        <MetricRow
          label="Active Layer"
          value={formatDisplayMetric(snapshot?.layer)}
          highlight
        />
      </div>

      {/* Scenario Recorder Panel */}
      <div className="border-t border-slate-800 pt-2 space-y-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="uppercase tracking-wider font-semibold text-slate-400">
            Record Scenario
          </span>
          <span className="font-mono text-slate-400">
            {isRecording ? (
              <span className="text-rose-400 font-semibold">
                ● REC ({recordedRows.length}s)
              </span>
            ) : (
              `${recordedRows.length} samples`
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            disabled={isRecording}
            placeholder="loss-5pct-run1"
            aria-label="Scenario label"
            className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleToggleRecording}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
              isRecording
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isRecording ? 'Stop' : 'Start'}
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={recordedRows.length === 0}
            className="px-2.5 py-1 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Download recorded stats as CSV"
          >
            CSV
          </button>
        </div>
      </div>

      {/* Dev-only ICE Transport Policy Toggle (TURN Relay testing) */}
      {import.meta.env.DEV && (
        <div className="border-t border-slate-800 mt-2 pt-2 flex items-center justify-between gap-2">
          <label
            htmlFor="viewer-force-relay"
            className="text-[11px] text-amber-300 font-medium flex items-center gap-1.5 cursor-pointer select-none"
          >
            <input
              id="viewer-force-relay"
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

const MetricRow: React.FC<{ label: string; value: string; highlight?: boolean }> = ({
  label,
  value,
  highlight = false,
}) => (
  <div className="flex items-center justify-between gap-2 min-w-0">
    <span className="text-slate-400 truncate">{label}</span>
    <span className={`truncate font-semibold ${highlight ? 'text-purple-300' : 'text-slate-100'}`}>
      {value}
    </span>
  </div>
);
