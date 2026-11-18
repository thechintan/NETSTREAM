import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SearchResponseDto } from '@netstream/shared';
import { useAuth } from '../../features/auth/AuthContext';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { api } from '../../lib/api';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

export interface NavbarProps {
  onToggleSidebar?: () => void;
}

type SearchNavItem =
  | { kind: 'channel'; id: string; name: string; title: string; isLive: boolean; viewerCount: number; to: string }
  | { kind: 'category'; id: string; name: string; to: string };

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Interactive Search state (Task 19)
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponseDto>({ channels: [], categories: [] });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Debounced search query
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ channels: [], categories: [] });
      setActiveIndex(-1);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<SearchResponseDto>(
          `/api/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!cancelled) {
          setResults(res || { channels: [], categories: [] });
          setActiveIndex(0);
        }
      } catch {
        if (!cancelled) {
          setResults({ channels: [], categories: [] });
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close search dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const navItems: SearchNavItem[] = useMemo(() => {
    const items: SearchNavItem[] = [];
    for (const ch of results.channels) {
      items.push({
        kind: 'channel',
        id: ch.id,
        name: ch.name,
        title: ch.title,
        isLive: ch.isLive,
        viewerCount: ch.viewerCount,
        to: `/c/${ch.name}`,
      });
    }
    for (const cat of results.categories) {
      items.push({
        kind: 'category',
        id: cat.id,
        name: cat.name,
        to: `/categories/${cat.id}`,
      });
    }
    return items;
  }, [results]);

  const handleSelectItem = (item: SearchNavItem) => {
    setSearchOpen(false);
    setQuery('');
    setActiveIndex(-1);
    navigate(item.to);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      if (query.trim()) setSearchOpen(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (navItems.length > 0) {
        setActiveIndex((prev) => (prev + 1) % navItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (navItems.length > 0) {
        setActiveIndex((prev) => (prev <= 0 ? navItems.length - 1 : prev - 1));
      }
    } else if (e.key === 'Enter') {
      if (navItems.length > 0) {
        e.preventDefault();
        const target = navItems[activeIndex >= 0 ? activeIndex : 0];
        if (target) handleSelectItem(target);
      }
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
      setActiveIndex(-1);
    }
  };

  const handleLogout = async () => {
    setDropdownOpen(false);
    await logout();
    navigate('/');
  };

  const channelCount = results.channels.length;

  return (
    <header className="sticky top-0 z-40 h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-3 md:px-5">
      {/* Left: Hamburger, Logo & Browse Links */}
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 md:hidden focus:outline-none"
            aria-label="Toggle sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-white select-none">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-base font-bold bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent hidden sm:inline">
            NetStream Live
          </span>
        </Link>

        <Link
          to="/categories"
          className="hidden md:inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
        >
          Categories
        </Link>
      </div>

      {/* Middle: Interactive Debounced Search Box with Keyboard Navigation */}
      <div className="flex-1 max-w-xs md:max-w-md mx-2 sm:mx-6" ref={searchContainerRef}>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => {
              if (query.trim()) setSearchOpen(true);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search channels & categories..."
            aria-label="Search channels and categories"
            aria-expanded={searchOpen && query.trim().length > 0}
            aria-autocomplete="list"
            role="combobox"
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700/80 rounded-lg text-xs md:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition"
          />

          {searchOpen && query.trim().length > 0 && (
            <div
              role="listbox"
              className="absolute left-0 right-0 mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50 max-h-96 overflow-y-auto"
            >
              {searching && navItems.length === 0 ? (
                <div className="px-4 py-3 text-xs text-slate-400">Searching...</div>
              ) : navItems.length === 0 ? (
                <div className="px-4 py-3 text-xs text-slate-500">
                  No matching channels or categories.
                </div>
              ) : (
                <div className="py-1">
                  {results.channels.length > 0 && (
                    <div>
                      <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Channels
                      </div>
                      {results.channels.map((ch, idx) => {
                        const isActive = activeIndex === idx;
                        return (
                          <button
                            key={ch.id}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() =>
                              handleSelectItem({
                                kind: 'channel',
                                id: ch.id,
                                name: ch.name,
                                title: ch.title,
                                isLive: ch.isLive,
                                viewerCount: ch.viewerCount,
                                to: `/c/${ch.name}`,
                              })
                            }
                            className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition ${
                              isActive ? 'bg-indigo-600/30 text-white' : 'hover:bg-slate-800/80 text-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Avatar name={ch.ownerUsername} size="sm" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate">{ch.name}</p>
                                <p className="text-[11px] text-slate-400 truncate">{ch.title}</p>
                              </div>
                            </div>
                            {ch.isLive ? (
                              <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600/90 text-white text-[10px] font-bold uppercase">
                                LIVE · {ch.viewerCount}
                              </span>
                            ) : (
                              <span className="shrink-0 text-[10px] text-slate-500">Offline</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {results.categories.length > 0 && (
                    <div className={results.channels.length > 0 ? 'border-t border-slate-800 mt-1 pt-1' : ''}>
                      <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Categories
                      </div>
                      {results.categories.map((cat, idx) => {
                        const globalIdx = channelCount + idx;
                        const isActive = activeIndex === globalIdx;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActiveIndex(globalIdx)}
                            onClick={() =>
                              handleSelectItem({
                                kind: 'category',
                                id: cat.id,
                                name: cat.name,
                                to: `/categories/${cat.id}`,
                              })
                            }
                            className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs transition ${
                              isActive ? 'bg-indigo-600/30 text-white' : 'hover:bg-slate-800/80 text-slate-200'
                            }`}
                          >
                            <span className="font-medium truncate">{cat.name}</span>
                            <span className="text-[10px] text-indigo-300">Category</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Notifications Bell, Studio & User Menu or Auth Buttons */}
      <div className="flex items-center gap-2 sm:gap-3">
        {user ? (
          <>
            <Link to="/studio" className="hidden sm:inline-flex">
              <Button size="sm" variant="secondary" className="gap-1.5">
                <svg className="w-4 h-4 text-rose-400 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8" />
                </svg>
                <span>Studio</span>
              </Button>
            </Link>

            <NotificationBell />

            {/* Dropdown container */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen((prev) => !prev)}
                className="flex items-center gap-2 p-1 rounded-full hover:ring-2 hover:ring-indigo-500 focus:outline-none transition"
                aria-label="User menu"
              >
                <Avatar name={user.username} size="sm" />
              </button>

              {dropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1 z-50 text-sm text-slate-200 animate-fade-in">
                    <div className="px-4 py-2 border-b border-slate-700/80">
                      <p className="font-semibold text-slate-100 truncate">{user.username}</p>
                      <p className="text-xs text-slate-400 truncate">{user.email}</p>
                    </div>

                    <Link
                      to={`/c/${user.username}`}
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 hover:bg-slate-700/60 transition"
                    >
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      My Channel
                    </Link>

                    <Link
                      to="/studio"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 hover:bg-slate-700/60 transition"
                    >
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Creator Studio
                    </Link>

                    <Link
                      to="/settings"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 hover:bg-slate-700/60 transition"
                    >
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Settings
                    </Link>

                    <div className="border-t border-slate-700/80 my-1" />

                    <button
                      onClick={() => void handleLogout()}
                      className="w-full text-left flex items-center gap-2 px-4 py-2 text-rose-400 hover:bg-slate-700/60 transition"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Log out
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <Link to="/login">
              <Button size="sm" variant="ghost">
                Log in
              </Button>
            </Link>
            <Link to="/register">
              <Button size="sm" variant="primary">
                Sign up
              </Button>
            </Link>
          </>
        )}
      </div>
    </header>
  );
};
