import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { Button } from '../components/ui/Button';

export const Studio: React.FC = () => {
  const { user, channel } = useAuth();

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gray-800 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Creator Studio</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Manage your broadcast settings and stream session for{' '}
            <span className="text-purple-400 font-medium">@{channel?.name || user?.username}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to={`/c/${channel?.name || user?.username}`}>
            <Button variant="secondary" size="sm">
              View Public Channel
            </Button>
          </Link>
          <Link to="/settings">
            <Button variant="ghost" size="sm">
              Channel Settings
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Broadcast Placeholder Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-purple-900/40 text-purple-400 flex items-center justify-center border border-purple-700/50">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </div>

        <h2 className="text-xl font-semibold text-white">Go live panel coming soon</h2>
        <p className="text-gray-400 max-w-lg mx-auto text-sm leading-relaxed">
          Browser-to-SFU WebRTC broadcasting with mediasoup will be enabled in an upcoming task.
          You will be able to capture video, audio, and screen sharing with real-time network metrics.
        </p>

        <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800/80 border border-gray-700 text-xs text-gray-300">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            Status: Offline
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800/80 border border-gray-700 text-xs text-gray-300">
            Stream Title: <span className="text-white font-medium">{channel?.title || 'Untitled Stream'}</span>
          </div>
        </div>
      </div>

      {/* Quick Setup Instructions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-5">
          <h3 className="text-base font-medium text-white mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Broadcast Preparation
          </h3>
          <p className="text-sm text-gray-400 leading-normal">
            Configure your broadcast title and select a category before going live so viewers can easily discover your stream.
          </p>
          <div className="mt-4">
            <Link to="/settings" className="text-xs text-purple-400 hover:text-purple-300 font-medium">
              Update Stream Details &rarr;
            </Link>
          </div>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-5">
          <h3 className="text-base font-medium text-white mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Stream Key & Ingestion
          </h3>
          <p className="text-sm text-gray-400 leading-normal">
            Keep your stream key private. If it is compromised, rotate it immediately in channel settings.
          </p>
          <div className="mt-4">
            <Link to="/settings" className="text-xs text-purple-400 hover:text-purple-300 font-medium">
              Manage Stream Key &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
