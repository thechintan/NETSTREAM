import React from 'react';

const COLORS = [
  'bg-red-600',
  'bg-orange-600',
  'bg-amber-600',
  'bg-emerald-600',
  'bg-teal-600',
  'bg-cyan-600',
  'bg-indigo-600',
  'bg-violet-600',
  'bg-purple-600',
  'bg-pink-600',
  'bg-rose-600',
];

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  size = 'md',
  className = '',
}) => {
  // Deterministic color selection
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = COLORS[Math.abs(hash) % COLORS.length];

  // Capitalized initials (up to 2 characters)
  const clean = name.trim();
  const initials = clean.length > 0
    ? clean.slice(0, 2).toUpperCase()
    : '?';

  const sizeStyles = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-12 h-12 text-base font-semibold',
    xl: 'w-16 h-16 text-xl font-bold',
  };

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full text-white font-medium select-none shadow-sm ${color} ${sizeStyles[size]} ${className}`}
      title={name}
    >
      {initials}
    </div>
  );
};
