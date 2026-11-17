import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export const NotFound: React.FC = () => {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-20 h-20 rounded-2xl bg-purple-900/30 border border-purple-700/40 flex items-center justify-center text-purple-400 mb-6">
        <span className="text-3xl font-extrabold font-mono">404</span>
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Page Not Found</h1>
      <p className="text-gray-400 max-w-md mt-2 text-sm leading-relaxed">
        The channel, page, or resource you are looking for doesn&apos;t exist or might have been removed.
      </p>
      <div className="mt-6">
        <Link to="/">
          <Button variant="primary">Return to Home</Button>
        </Link>
      </div>
    </div>
  );
};
