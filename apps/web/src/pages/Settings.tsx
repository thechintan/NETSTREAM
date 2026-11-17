import React, { useEffect, useState } from 'react';
import { CategoryDto, ChannelDto, RotateStreamKeyResponse } from '@netstream/shared';
import { useAuth } from '../features/auth/AuthContext';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';

export const Settings: React.FC = () => {
  const { channel, refreshUser } = useAuth();
  const { showToast } = useToast();

  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [title, setTitle] = useState(channel?.title || '');
  const [categoryId, setCategoryId] = useState(channel?.categoryId || '');
  const [slowSeconds, setSlowSeconds] = useState(channel?.slowSeconds ?? 0);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  // Stream key modal state
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (channel) {
      setTitle(channel.title || '');
      setCategoryId(channel.categoryId || '');
      setSlowSeconds(channel.slowSeconds ?? 0);
    }
  }, [channel]);

  useEffect(() => {
    let isMounted = true;
    async function loadCategories() {
      try {
        const data = await api.get<CategoryDto[]>('/api/categories');
        if (isMounted && data) {
          setCategories(data);
        }
      } catch {
        showToast('Failed to load categories', 'error');
      } finally {
        if (isMounted) setIsLoadingCategories(false);
      }
    }

    loadCategories();
    return () => {
      isMounted = false;
    };
  }, [showToast]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      showToast('Title cannot be empty', 'error');
      return;
    }
    if (title.length > 100) {
      showToast('Title cannot exceed 100 characters', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await api.patch<ChannelDto>('/api/channels/me', {
        title: title.trim(),
        categoryId: categoryId || null,
        slowSeconds: Number(slowSeconds) || 0,
      });
      await refreshUser();
      showToast('Channel updated successfully', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update channel', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRotateKey = async () => {
    if (!confirm('Are you sure you want to rotate your stream key? Any active stream using the old key will be disconnected.')) {
      return;
    }

    setIsRotating(true);
    try {
      const data = await api.post<RotateStreamKeyResponse>('/api/channels/me/stream-key/rotate');
      setRotatedKey(data.streamKey);
      setIsCopied(false);
      showToast('Stream key rotated successfully', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to rotate stream key', 'error');
    } finally {
      setIsRotating(false);
    }
  };

  const handleCopyKey = async () => {
    if (!rotatedKey) return;
    try {
      await navigator.clipboard.writeText(rotatedKey);
      setIsCopied(true);
      showToast('Stream key copied to clipboard', 'success');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-10">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Channel Settings</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Update your channel information and manage your streaming credentials.
        </p>
      </div>

      {/* Broadcast Details Form */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="border-b border-gray-800 pb-4">
          <h2 className="text-lg font-semibold text-white">Stream Information</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            This information is shown to viewers on your channel page and browse directory.
          </p>
        </div>

        <form onSubmit={handleSaveSettings} className="space-y-5">
          <div>
            <label htmlFor="title" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
              Stream Title ({title.length}/100)
            </label>
            <Input
              id="title"
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Building an SFU WebRTC Streamer from Scratch!"
              required
            />
          </div>

          <div>
            <label htmlFor="category" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
              Category
            </label>
            <select
              id="category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={isLoadingCategories}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition disabled:opacity-50"
            >
              <option value="">-- No Category --</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="slowSeconds" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
              Slow Mode (0 - 120 seconds)
            </label>
            <input
              id="slowSeconds"
              type="number"
              min={0}
              max={120}
              value={slowSeconds}
              onChange={(e) => setSlowSeconds(Math.max(0, Math.min(120, parseInt(e.target.value, 10) || 0)))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
            />
            <p className="text-xs text-gray-500 mt-1">
              Limits chat participants to sending at most one message per interval. Set to 0 to disable slow mode.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" variant="primary" isLoading={isSaving}>
              Save Changes
            </Button>
          </div>
        </form>
      </section>

      {/* Stream Key Section */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="border-b border-gray-800 pb-4">
          <h2 className="text-lg font-semibold text-white">Stream Key</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Your stream key authorizes ingestion to the server. Never share your stream key with anyone.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gray-950 p-4 rounded-lg border border-gray-800">
          <div>
            <div className="text-sm font-medium text-white flex items-center gap-2">
              <span>Primary Stream Key</span>
              <span className="text-xs font-mono text-gray-500">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              For security reasons, your plain stream key is never stored on the server.
            </p>
          </div>

          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleRotateKey}
            isLoading={isRotating}
          >
            Rotate Key
          </Button>
        </div>
      </section>

      {/* Copy Once Modal */}
      <Modal
        isOpen={Boolean(rotatedKey)}
        onClose={() => setRotatedKey(null)}
        title="New Stream Key Generated"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRotatedKey(null)}
            >
              Done
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-950/50 border border-amber-800/60 rounded-lg text-amber-200 text-xs leading-relaxed flex items-start gap-2">
            <svg className="w-5 h-5 flex-shrink-0 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <strong className="font-semibold">Copy this key now!</strong> This key will only be displayed once. Once this window is closed, it cannot be retrieved again.
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
              Your New Stream Key
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={rotatedKey || ''}
                className="w-full px-3 py-2 font-mono text-sm bg-gray-950 border border-gray-700 rounded-lg text-purple-300 select-all focus:outline-none"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCopyKey}
              >
                {isCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
