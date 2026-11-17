import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../features/auth/AuthContext';
import { ApiError } from '../lib/api';

export const Register: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUser = username.trim();
    if (trimmedUser.length < 3 || trimmedUser.length > 24) {
      setError('Username must be between 3 and 24 characters.');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUser)) {
      setError('Username can only contain letters, numbers, and underscores.');
      return;
    }

    if (password.length < 8 || password.length > 72) {
      setError('Password must be between 8 and 72 characters.');
      return;
    }

    setIsLoading(true);
    try {
      await register({
        email: email.trim(),
        username: trimmedUser,
        password,
      });
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
        <header className="text-center space-y-1.5">
          <h2 className="text-2xl font-bold tracking-tight text-white">Create an account</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Join NetStream Live to start broadcasting and chatting.
          </p>
        </header>

        {error && (
          <div className="p-3 bg-rose-950/60 border border-rose-500/40 text-rose-200 rounded-lg text-xs font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            required
            autoFocus
          />

          <Input
            label="Username"
            placeholder="streamer_name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            helperText="3-24 characters, letters, digits, and underscores"
            disabled={isLoading}
            required
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText="At least 8 characters"
            disabled={isLoading}
            required
          />

          <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
            Create Account
          </Button>
        </form>

        <footer className="text-center text-xs text-slate-400 pt-2 border-t border-slate-800">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-semibold underline">
            Log in
          </Link>
        </footer>
      </div>
    </div>
  );
};
