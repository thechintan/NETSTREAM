import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../features/auth/AuthContext';
import { ApiError } from '../lib/api';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!identifier.trim() || !password) {
      setError('Please provide both username/email and password.');
      return;
    }

    setIsLoading(true);
    try {
      await login({ identifier: identifier.trim(), password });
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
        <header className="text-center space-y-1.5">
          <h2 className="text-2xl font-bold tracking-tight text-white">Welcome back</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Log in to NetStream Live to watch, chat, and follow channels.
          </p>
        </header>

        {error && (
          <div className="p-3 bg-rose-950/60 border border-rose-500/40 text-rose-200 rounded-lg text-xs font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Username or Email"
            placeholder="alice or alice@netstream.live"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={isLoading}
            required
            autoFocus
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            required
          />

          <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
            Sign in
          </Button>
        </form>

        <footer className="text-center text-xs text-slate-400 pt-2 border-t border-slate-800">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="text-indigo-400 hover:text-indigo-300 font-semibold underline">
            Sign up
          </Link>
        </footer>
      </div>
    </div>
  );
};
