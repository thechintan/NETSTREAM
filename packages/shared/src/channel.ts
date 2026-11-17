import { z } from 'zod';

export const categoryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  thumbnailUrl: z.string().nullable(),
});

export type CategoryDto = z.infer<typeof categoryDtoSchema>;

export const channelDetailDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: z.string(),
  category: categoryDtoSchema.nullable(),
  followerCount: z.number(),
  isLive: z.boolean(),
  ownerUsername: z.string(),
  isFollowing: z.boolean().optional(),
});

export type ChannelDetailDto = z.infer<typeof channelDetailDtoSchema>;

export const updateChannelSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title cannot be empty')
    .max(100, 'Title cannot exceed 100 characters')
    .optional(),
  categoryId: z.string().uuid('Invalid category ID').nullable().optional(),
  slowSeconds: z
    .number()
    .int()
    .min(0, 'Slow mode seconds cannot be negative')
    .max(120, 'Slow mode seconds cannot exceed 120')
    .optional(),
});

export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

export const chatHistoryQuerySchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ChatHistoryQuery = z.infer<typeof chatHistoryQuerySchema>;

export const rotateStreamKeyResponseSchema = z.object({
  streamKey: z.string(),
});

export type RotateStreamKeyResponse = z.infer<typeof rotateStreamKeyResponseSchema>;

export const followedChannelDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: z.string(),
  category: categoryDtoSchema.nullable(),
  isLive: z.boolean(),
  ownerUsername: z.string(),
  followedAt: z.union([z.string(), z.date()]),
});

export type FollowedChannelDto = z.infer<typeof followedChannelDtoSchema>;

export const liveChannelDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: z.string(),
  category: categoryDtoSchema.nullable(),
  ownerUsername: z.string(),
  viewerCount: z.number(),
  startedAt: z.union([z.string(), z.date()]).nullable().optional(),
});

export type LiveChannelDto = z.infer<typeof liveChannelDtoSchema>;
