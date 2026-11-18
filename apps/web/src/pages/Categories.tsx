import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CategoryDto } from '@netstream/shared';
import { Skeleton } from '../components/ui/Skeleton';
import { api } from '../lib/api';

const CATEGORY_GRADIENTS = [
  'from-indigo-600/30 to-purple-900/50 border-indigo-500/30',
  'from-emerald-600/30 to-teal-900/50 border-emerald-500/30',
  'from-rose-600/30 to-pink-900/50 border-rose-500/30',
  'from-amber-600/30 to-orange-900/50 border-amber-500/30',
  'from-sky-600/30 to-blue-900/50 border-sky-500/30',
  'from-fuchsia-600/30 to-violet-900/50 border-fuchsia-500/30',
];

export const Categories: React.FC = () => {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const list = await api.get<CategoryDto[]>('/api/categories');
        if (active) setCategories(list || []);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load categories');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-800 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Categories</h1>
          <p className="text-sm text-slate-400 mt-1">
            Browse live channels by topic and community.
          </p>
        </div>
        <Link
          to="/"
          className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition"
        >
          ← Back to Live Channels
        </Link>
      </header>

      {error && (
        <div className="p-4 bg-rose-950/60 border border-rose-500/40 text-rose-200 rounded-xl text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">No categories found.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {categories.map((cat, idx) => {
            const grad = CATEGORY_GRADIENTS[idx % CATEGORY_GRADIENTS.length];
            const liveCount = cat.liveCount ?? 0;

            return (
              <Link
                key={cat.id}
                to={`/categories/${cat.id}`}
                className={`group relative rounded-xl border bg-gradient-to-br ${grad} p-4 flex flex-col justify-between h-36 hover:scale-[1.02] transition-all shadow-lg overflow-hidden`}
              >
                <div className="flex items-start justify-between">
                  <span className="w-9 h-9 rounded-lg bg-slate-950/60 border border-white/10 flex items-center justify-center text-base font-bold text-white">
                    {cat.name.slice(0, 1).toUpperCase()}
                  </span>
                  {liveCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-600/90 text-white text-[10px] font-bold uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      {liveCount} live
                    </span>
                  )}
                </div>

                <div>
                  <h2 className="text-base font-bold text-white group-hover:text-indigo-200 transition truncate">
                    {cat.name}
                  </h2>
                  <p className="text-xs text-slate-300/80 mt-0.5">
                    {liveCount === 1 ? '1 live channel' : `${liveCount} live channels`}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};
