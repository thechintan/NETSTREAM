import { useEffect, useState } from 'react';
import { VERSION } from '@netstream/shared';

interface HealthData {
  ok: boolean;
  db: boolean;
  redis: boolean;
  version?: string;
}

export function Home() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/health');
      const data = (await response.json()) as HealthData;
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to /api/health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void checkHealth();
  }, []);

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <header className="border-b border-slate-700 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-indigo-400">NetStream Live</h1>
        <p className="text-sm text-slate-400 mt-1">
          University Computer Networks Live Streaming Platform (v{VERSION})
        </p>
      </header>

      <section className="bg-slate-800 rounded-lg p-6 border border-slate-700 shadow-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Backend System Health</h2>
          <button
            onClick={() => void checkHealth()}
            className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 rounded transition"
            disabled={loading}
          >
            {loading ? 'Checking...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-950/60 border border-red-500/50 text-red-200 rounded text-sm">
            {error}
          </div>
        )}

        {health && (
          <div className="grid grid-cols-3 gap-4 text-center mt-4">
            <div className="p-4 bg-slate-900 rounded-md border border-slate-700/80">
              <span className="text-xs uppercase text-slate-400 font-semibold block mb-1">
                Overall API
              </span>
              <span
                data-testid="status-overall"
                className={`text-lg font-bold ${
                  health.ok ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {health.ok ? 'ONLINE' : 'DEGRADED'}
              </span>
            </div>

            <div className="p-4 bg-slate-900 rounded-md border border-slate-700/80">
              <span className="text-xs uppercase text-slate-400 font-semibold block mb-1">
                PostgreSQL 16
              </span>
              <span
                data-testid="status-db"
                className={`text-lg font-bold ${
                  health.db ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {health.db ? 'CONNECTED' : 'DOWN'}
              </span>
            </div>

            <div className="p-4 bg-slate-900 rounded-md border border-slate-700/80">
              <span className="text-xs uppercase text-slate-400 font-semibold block mb-1">
                Redis 7
              </span>
              <span
                data-testid="status-redis"
                className={`text-lg font-bold ${
                  health.redis ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {health.redis ? 'CONNECTED' : 'DOWN'}
              </span>
            </div>
          </div>
        )}

        {health && (
          <div className="pt-2">
            <p className="text-xs text-slate-500">
              Raw response: <code className="text-slate-300 font-mono">{JSON.stringify(health)}</code>
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
