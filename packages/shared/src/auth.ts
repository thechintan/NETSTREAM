import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(24, 'Username cannot exceed 24 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username must contain only letters, numbers, and underscores'
    ),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password cannot exceed 72 characters'),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    identifier: z.string().trim().min(1, 'Username or email is required').optional(),
    username: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((data) => Boolean(data.identifier || data.username || data.email), {
    message: 'Must provide username, email, or identifier',
  });

export type LoginInput = z.infer<typeof loginSchema>;

export const userDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string(),
  createdAt: z.union([z.string(), z.date()]),
});

export type UserDto = z.infer<typeof userDtoSchema>;

export const channelDtoSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string(),
  title: z.string(),
  categoryId: z.string().uuid().nullable(),
  isLive: z.boolean(),
  slowSeconds: z.number(),
  createdAt: z.union([z.string(), z.date()]),
});

export type ChannelDto = z.infer<typeof channelDtoSchema>;

export const authResponseSchema = z.object({
  user: userDtoSchema,
  accessToken: z.string(),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const meResponseSchema = z.object({
  user: userDtoSchema,
  channel: channelDtoSchema.nullable(),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

export const wsTicketResponseSchema = z.object({
  ticket: z.string(),
});

export type WsTicketResponse = z.infer<typeof wsTicketResponseSchema>;
