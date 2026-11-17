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
    // Consider at bottom if within 50px
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAtBottom(atBottom);
    if (atBottom) {
      setHasUnread(false);
    }
  };

  // Join channel chat on mount, leave on unmount, and resubscribe on reconnect
  useEffect(() => {
    let isMounted = true;

    async function joinChat() {
      try {
        const res = await request<ChatJoinResponse>('chat.join', { channelId });
        if (isMounted && res?.messages) {
          setMessages(res.messages.slice(-150));
          setTimeout(() => scrollToBottom(false), 50);
        }
      } catch {
        // Failed to join chat
      }
    }

    if (status === 'open') {
      void joinChat();
    }

    // Resubscribe on reconnect
    const unsubOpen = client.onOpen(() => {
      void joinChat();
    });

    // Listen for live messages
    const unsubMsg = client.on<ChatMessageDto>('chat.message', (newMsg) => {
      if (!isMounted || newMsg.channelId !== channelId) return;

      setMessages((prev) => {
        // Keep only the last 150 messages
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
    if (!textToSend || isSending) return;

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
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      setSendError(msg);
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
            const timeStr = new Date(msg.ts).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div key={msg.mid} className="text-gray-200 text-xs sm:text-sm break-words leading-relaxed group">
                <span className="text-[11px] text-gray-500 font-mono mr-2 select-none">{timeStr}</span>
                <span
                  className="font-semibold mr-1.5 hover:underline cursor-pointer"
                  style={{ color: msg.user.color }}
                >
                  {msg.user.name}:
                </span>
                {/* Plain text only */}
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
                placeholder="Send a message..."
                disabled={isSending || status !== 'open'}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-16 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition disabled:opacity-50"
              />
              <div className="absolute right-1.5">
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  disabled={!inputText.trim() || isSending || status !== 'open'}
                  isLoading={isSending}
                >
                  Send
                </Button>
              </div>
            </div>

            <div className="flex justify-between items-center px-1 text-[11px] text-gray-500">
              <span>Press Enter to send</span>
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
