import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChatJoinResponse, ChatMessageDto } from '@netstream/shared';
import { useAuth } from '../auth/AuthContext';
import { useWs } from '../../lib/ws';
import { Button } from '../../components/ui/Button';

interface ChatPanelProps {
  channelId: string;
  channelName: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ channelId, channelName }) => {
  const { user } = useAuth();
  const { client, status, request, send } = useWs();

  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [cooldownReason, setCooldownReason] = useState<'RATE_LIMITED' | 'SLOW_MODE' | null>(null);

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
        // De-duplicate by mid
        if (prev.some((m) => m.mid === newMsg.mid)) return prev;
        lastSeenMidRef.current = newMsg.mid;

        const updated = prev.length >= 150 ? [...prev.slice(1), newMsg] : [...prev, newMsg];
        return updated;
      });

      // Handle auto-scroll
      if (isAtBottom) {
        setTimeout(() => scrollToBottom(false), 20);
      } else {
        setHasUnread(true);
      }
    });

    return () => {
      isMounted = false;
      unsubOpen();
      unsubMsg();
      send('chat.leave', { channelId });
    };
  }, [channelId, client, request, send, status, isAtBottom]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const textToSend = inputText.trim();
    if (!textToSend || isSending || cooldownSeconds > 0) return;

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

      if (code === 'RATE_LIMITED' || code === 'SLOW_MODE') {
        const retryMs = errorObj?.retryAfterMs || 3000;
        const seconds = Math.max(1, Math.ceil(retryMs / 1000));
        setCooldownSeconds(seconds);
        setCooldownReason(code);

        // Add inline system notice into chat list
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-lg">
      {/* Chat Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-950/70 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <h2 className="text-sm font-semibold text-white tracking-wide">Stream Chat</h2>
        </div>
        <span className="text-xs text-gray-400">#{channelName}</span>
      </div>

      {/* Message List */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] text-sm relative"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 py-12">
            <svg className="w-8 h-8 text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

            return (
              <div key={msg.mid} className="text-gray-200 text-xs sm:text-sm break-words leading-relaxed group">
                <span className="text-[11px] text-gray-500 font-mono mr-2 select-none">{timeStr}</span>
                <span
                  className="font-semibold mr-1.5 hover:underline cursor-pointer"
                  style={{ color: msg.user.color }}
                >
                  {msg.user.name}:
                </span>
                {/* Rendered strictly as plain text */}
                <span className="text-gray-100">{msg.text}</span>
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
        {sendError && (
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
                  cooldownSeconds > 0
                    ? `${cooldownReason === 'SLOW_MODE' ? 'Slow mode' : 'Rate limit'}: wait ${cooldownSeconds}s...`
                    : 'Send a message...'
                }
                disabled={isSending || status !== 'open' || cooldownSeconds > 0}
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
                    disabled={!inputText.trim() || isSending || status !== 'open'}
                    isLoading={isSending}
                  >
                    Send
                  </Button>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center px-1 text-[11px] text-gray-500">
              {cooldownSeconds > 0 ? (
                <span className="text-amber-400 font-medium">Cooldown active: please wait {cooldownSeconds}s</span>
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
