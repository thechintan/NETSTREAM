import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChatJoinResponse, ChatMessageDto } from '@netstream/shared';
import { useAuth } from '../auth/AuthContext';
import { useWs } from '../../lib/ws';
import { Button } from '../../components/ui/Button';

interface ChatPanelProps {
  channelId: string;
  channelName: string;
  channelOwnerId?: string;
  isMod?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  channelId,
  channelName,
  channelOwnerId,
  isMod,
}) => {
  const { user } = useAuth();
  const { client, status, request, send } = useWs();

  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [deletedMids, setDeletedMids] = useState<Set<string>>(new Set());
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [cooldownReason, setCooldownReason] = useState<
    'RATE_LIMITED' | 'SLOW_MODE' | 'TIMED_OUT' | null
  >(null);
  const [isBanned, setIsBanned] = useState(false);
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);
  const [activeTimeoutMenuMid, setActiveTimeoutMenuMid] = useState<string | null>(null);

  const isOwner = Boolean(user?.id && channelOwnerId && user.id === channelOwnerId);
  const canModerate = Boolean(isOwner || isMod);

  const lastSeenMidRef = useRef<string | undefined>(undefined);

  // Auto-scroll control
  const listRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);

  const scrollToBottom = (smooth = false) => {
    if (listRef.current) {
      listRef.current.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
      setIsAtBottom(true);
      setHasUnread(false);
    }
  };

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAtBottom(atBottom);
    if (atBottom) {
      setHasUnread(false);
    }
  };

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldownSeconds <= 0) {
      setCooldownReason(null);
      return;
    }

    const interval = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  // Join channel chat on mount, leave on unmount, and resubscribe on reconnect
  useEffect(() => {
    let isMounted = true;

    async function joinChat(lastMid?: string) {
      try {
        const res = await request<ChatJoinResponse>('chat.join', {
          channelId,
          lastMid,
        });

        if (isMounted && res?.messages) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.mid));
            const newMsgs = res.messages.filter((m) => !seen.has(m.mid));
            if (newMsgs.length === 0) return prev;

            const combined = [...prev, ...newMsgs].slice(-150);
            if (combined.length > 0) {
              lastSeenMidRef.current = combined[combined.length - 1].mid;
            }
            return combined;
          });

          setTimeout(() => scrollToBottom(false), 50);
        }
      } catch {
        // Failed to join chat
      }
    }

    if (status === 'open') {
      void joinChat();
    }

    // Rejoin automatically after a reconnect using last seen mid
    const unsubOpen = client.onOpen(() => {
      void joinChat(lastSeenMidRef.current);
    });

    // Listen for live messages
    const unsubMsg = client.on<ChatMessageDto>('chat.message', (newMsg) => {
      if (!isMounted || newMsg.channelId !== channelId) return;

      setMessages((prev) => {
        if (prev.some((m) => m.mid === newMsg.mid)) return prev;
        lastSeenMidRef.current = newMsg.mid;

        const updated = prev.length >= 150 ? [...prev.slice(1), newMsg] : [...prev, newMsg];
        return updated;
      });

      if (isAtBottom) {
        setTimeout(() => scrollToBottom(false), 20);
      } else {
        setHasUnread(true);
      }
    });

    // Listen for deleted messages
    const unsubDeleted = client.on<{ mid: string }>('chat.deleted', (data) => {
      if (!isMounted) return;
      setDeletedMids((prev) => new Set([...prev, data.mid]));
    });

    // Listen for user banned events
    const unsubBanned = client.on<{ channelId: string; userId: string }>('user.banned', (data) => {
      if (!isMounted) return;
      if (data.channelId === channelId && user?.id === data.userId) {
        setIsBanned(true);
      }
    });

    return () => {
      isMounted = false;
      unsubOpen();
      unsubMsg();
      unsubDeleted();
      unsubBanned();
      send('chat.leave', { channelId });
    };
  }, [channelId, client, request, send, status, isAtBottom, user?.id]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const textToSend = inputText.trim();
    if (!textToSend || isSending || cooldownSeconds > 0 || isBanned) return;

    if (textToSend.length > 500) {
      setSendError('Message exceeds 500 characters');
      return;
    }

    setSendError(null);
    setIsSending(true);

    try {
      await request('chat.send', { channelId, text: textToSend });
      setInputText('');
      setTimeout(() => scrollToBottom(true), 20);
    } catch (err: unknown) {
      const errorObj = err as { code?: string; message?: string; retryAfterMs?: number };
      const code = errorObj?.code;
      const message = errorObj?.message || 'Failed to send message';

      if (code === 'BANNED') {
        setIsBanned(true);
        setSendError('You are banned from chatting in this channel.');
      } else if (code === 'TIMED_OUT') {
        const retryMs = errorObj?.retryAfterMs || 10000;
        const seconds = Math.max(1, Math.ceil(retryMs / 1000));
        setCooldownSeconds(seconds);
        setCooldownReason('TIMED_OUT');
        setSendError(`You are timed out. Wait ${seconds}s.`);
      } else if (code === 'RATE_LIMITED' || code === 'SLOW_MODE') {
        const retryMs = errorObj?.retryAfterMs || 3000;
        const seconds = Math.max(1, Math.ceil(retryMs / 1000));
        setCooldownSeconds(seconds);
        setCooldownReason(code);

        const noticeMid = `sys_${Date.now()}`;
        const noticeText =
          code === 'SLOW_MODE'
            ? `Slow mode is active. Please wait ${seconds}s before sending another message.`
            : `You are sending messages too quickly. Please wait ${seconds}s.`;

        const systemNotice: ChatMessageDto = {
          mid: noticeMid,
          channelId,
          user: {
            id: 'system',
            name: 'System',
            color: '#F59E0B',
            badges: [],
          },
          text: noticeText,
          ts: Date.now(),
        };

        setMessages((prev) => [...prev.slice(-149), systemNotice]);
        setSendError(noticeText);
        setTimeout(() => scrollToBottom(true), 20);
      } else {
        setSendError(message);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = async (mid: string) => {
    try {
      await request('mod.delete', { channelId, mid });
      setDeletedMids((prev) => new Set([...prev, mid]));
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setSendError(errorObj?.message || 'Failed to delete message');
    }
  };

  const handleTimeoutUser = async (targetUserId: string, seconds: number) => {
    try {
      await request('mod.timeout', { channelId, userId: targetUserId, seconds });
      setActiveTimeoutMenuMid(null);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setSendError(errorObj?.message || 'Failed to timeout user');
    }
  };

  const handleBanUser = async (targetUserId: string) => {
    if (!confirm('Are you sure you want to ban this user from the channel?')) {
      return;
    }
    try {
      await request('mod.ban', { channelId, userId: targetUserId });
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setSendError(errorObj?.message || 'Failed to ban user');
    }
  };

  const handleSetSlowMode = async (seconds: number) => {
    try {
      await request('mod.slow', { channelId, seconds });
      setShowSettingsPopover(false);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setSendError(errorObj?.message || 'Failed to update slow mode');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-lg relative">
      {/* Chat Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-950/70 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <h2 className="text-sm font-semibold text-white tracking-wide">Stream Chat</h2>
        </div>
        <div className="flex items-center gap-2">
          {canModerate && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSettingsPopover((prev) => !prev)}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition"
                title="Chat moderation settings"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>

              {/* Slow Mode Settings Popover */}
              {showSettingsPopover && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-gray-950 border border-gray-800 rounded-lg shadow-xl p-3 z-30">
                  <div className="text-xs font-semibold text-gray-300 mb-2">Set Slow Mode</div>
                  <div className="space-y-1">
                    {[0, 5, 10, 30, 60, 120].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void handleSetSlowMode(s)}
                        className="w-full text-left px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 rounded transition"
                      >
                        {s === 0 ? 'Off' : `${s} seconds`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <span className="text-xs text-gray-400">#{channelName}</span>
        </div>
      </div>

      {/* Message List */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] text-sm relative"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 py-12">
            <svg
              className="w-8 h-8 text-gray-600 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-xs">Welcome to the stream chat!</p>
            <p className="text-xs text-gray-600 mt-1">Be the first to say hello.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isSystem = msg.user.id === 'system';
            const isDeleted = deletedMids.has(msg.mid);
            const timeStr = new Date(msg.ts).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            if (isSystem) {
              return (
                <div
                  key={msg.mid}
                  className="bg-amber-950/40 border border-amber-800/40 rounded px-2.5 py-1.5 text-xs text-amber-300 leading-normal"
                >
                  <span className="font-semibold mr-1.5">[System]:</span>
                  <span>{msg.text}</span>
                </div>
              );
            }

            const targetIsOwner =
              msg.user.badges?.includes('owner') || (channelOwnerId && msg.user.id === channelOwnerId);
            const targetIsMod = msg.user.badges?.includes('mod');
            const canModerateThisUser =
              canModerate &&
              !targetIsOwner &&
              (isOwner || !targetIsMod) &&
              msg.user.id !== user?.id;

            return (
              <div
                key={msg.mid}
                className="text-gray-200 text-xs sm:text-sm break-words leading-relaxed group relative flex items-start justify-between rounded px-1.5 py-0.5 hover:bg-gray-800/40 transition"
              >
                <div className="flex-1 min-w-0 pr-2">
                  <span className="text-[11px] text-gray-500 font-mono mr-2 select-none">
                    {timeStr}
                  </span>

                  {/* Badges */}
                  {msg.user.badges?.includes('owner') && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 mr-1 select-none">
                      OWNER
                    </span>
                  )}
                  {msg.user.badges?.includes('mod') && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mr-1 select-none">
                      MOD
                    </span>
                  )}

                  <span
                    className="font-semibold mr-1.5 hover:underline cursor-pointer"
                    style={{ color: msg.user.color }}
                  >
                    {msg.user.name}:
                  </span>

                  {/* Message body or deleted placeholder */}
                  {isDeleted ? (
                    <span className="italic text-gray-500 select-none">message deleted</span>
                  ) : (
                    <span className="text-gray-100">{msg.text}</span>
                  )}
                </div>

                {/* Mod Hover Menu */}
                {canModerate && !isDeleted && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={() => void handleDeleteMessage(msg.mid)}
                      className="text-gray-400 hover:text-rose-400 p-1 rounded hover:bg-gray-700/60"
                      title="Delete message"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>

                    {canModerateThisUser && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveTimeoutMenuMid(
                              activeTimeoutMenuMid === msg.mid ? null : msg.mid
                            )
                          }
                          className="text-gray-400 hover:text-amber-400 p-1 rounded hover:bg-gray-700/60"
                          title="Timeout user"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>

                        {activeTimeoutMenuMid === msg.mid && (
                          <div className="absolute right-0 top-full mt-1 w-24 bg-gray-950 border border-gray-800 rounded shadow-xl py-1 z-30">
                            <button
                              type="button"
                              onClick={() => void handleTimeoutUser(msg.user.id, 60)}
                              className="w-full text-left px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800"
                            >
                              1m timeout
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleTimeoutUser(msg.user.id, 600)}
                              className="w-full text-left px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800"
                            >
                              10m timeout
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleTimeoutUser(msg.user.id, 3600)}
                              className="w-full text-left px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800"
                            >
                              1h timeout
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {canModerateThisUser && (
                      <button
                        type="button"
                        onClick={() => void handleBanUser(msg.user.id)}
                        className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-gray-700/60"
                        title="Ban user"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Floating Unread "New Messages" Button */}
        {hasUnread && (
          <div className="sticky bottom-2 flex justify-center z-10 pointer-events-none">
            <button
              onClick={() => scrollToBottom(true)}
              className="pointer-events-auto bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 transition-all transform hover:scale-105"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span>More messages below</span>
            </button>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-3 bg-gray-950/70 border-t border-gray-800">
        {/* Banned Banner */}
        {isBanned && (
          <div className="mb-2 text-xs font-semibold text-rose-300 bg-rose-950/60 border border-rose-800/80 rounded px-3 py-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>You have been banned from chatting in this channel.</span>
          </div>
        )}

        {/* Timed-Out Banner */}
        {cooldownReason === 'TIMED_OUT' && (
          <div className="mb-2 text-xs font-semibold text-amber-300 bg-amber-950/60 border border-amber-800/80 rounded px-3 py-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>You are temporarily timed out from chat ({cooldownSeconds}s remaining).</span>
          </div>
        )}

        {sendError && !isBanned && cooldownReason !== 'TIMED_OUT' && (
          <div className="mb-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/40 rounded px-2.5 py-1">
            {sendError}
          </div>
        )}

        {user ? (
          <form onSubmit={handleSendMessage} className="space-y-1.5">
            <div className="relative flex items-center">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={500}
                placeholder={
                  isBanned
                    ? 'You are banned from chat'
                    : cooldownSeconds > 0
                    ? `${cooldownReason === 'SLOW_MODE' ? 'Slow mode' : cooldownReason === 'TIMED_OUT' ? 'Timed out' : 'Rate limit'}: wait ${cooldownSeconds}s...`
                    : 'Send a message...'
                }
                disabled={isSending || status !== 'open' || cooldownSeconds > 0 || isBanned}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-16 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition disabled:opacity-60"
              />
              <div className="absolute right-1.5 flex items-center gap-1.5">
                {cooldownSeconds > 0 ? (
                  <span className="text-xs font-mono font-semibold text-amber-400 bg-amber-950/80 px-2 py-1 rounded">
                    {cooldownSeconds}s
                  </span>
                ) : (
                  <Button
                    type="submit"
                    size="sm"
                    variant="primary"
                    disabled={!inputText.trim() || isSending || status !== 'open' || isBanned}
                    isLoading={isSending}
                  >
                    Send
                  </Button>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center px-1 text-[11px] text-gray-500">
              {isBanned ? (
                <span className="text-rose-400 font-medium">Banned from chat</span>
              ) : cooldownSeconds > 0 ? (
                <span className="text-amber-400 font-medium">
                  {cooldownReason === 'TIMED_OUT' ? 'Timeout active' : 'Cooldown active'}: please wait {cooldownSeconds}s
                </span>
              ) : (
                <span>Press Enter to send</span>
              )}
              <span className={inputText.length >= 480 ? 'text-amber-400 font-semibold' : ''}>
                {inputText.length}/500
              </span>
            </div>
          </form>
        ) : (
          <div className="text-center py-2.5 px-3 bg-gray-800/60 rounded-lg border border-gray-700/60">
            <p className="text-xs text-gray-400 mb-2">You must be logged in to participate in chat</p>
            <Link to="/login">
              <Button size="sm" variant="secondary" className="w-full">
                Log In to Chat
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};
