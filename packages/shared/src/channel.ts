import { z } from 'zod';

export const categoryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  thumbnailUrl: z.string().nullable(),
  liveCount: z.number().int().min(0).optional(),
});

export type CategoryDto = z.infer<typeof categoryDtoSchema>;

export const channelDetailDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: z.string(),
  category: categoryDtoSchema.nullable(),
  followerCount: z.number(),
  viewerCount: z.number().default(0),
  isLive: z.boolean(),
  ownerUsername: z.string(),
  ownerId: z.string().uuid().optional(),
  isFollowing: z.boolean().optional(),
  isMod: z.boolean().optional(),
});

export type ChannelDetailDto = z.infer<typeof channelDetailDtoSchema>;

export const channelModDtoSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
});

export type ChannelModDto = z.infer<typeof channelModDtoSchema>;

export const addModSchema = z.object({
  username: z.string().min(1, 'Username is required'),
});

export type AddModInput = z.infer<typeof addModSchema>;

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
  recordVod: z.boolean().optional(),
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

// Notifications (Task 18)
export const notificationDtoSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.unknown()),
  readAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]),
});

export type NotificationDto = z.infer<typeof notificationDtoSchema>;

export const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).optional(),
    all: z.boolean().optional(),
  })
  .refine((data) => data.all === true || (data.ids !== undefined && data.ids.length > 0), {
    message: 'Provide either ids or all: true',
  });

export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

// Discovery / Search (Task 19)
export const searchChannelDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: z.string(),
  isLive: z.boolean(),
  viewerCount: z.number().int().min(0),
  ownerUsername: z.string(),
  category: categoryDtoSchema.nullable(),
});

export type SearchChannelDto = z.infer<typeof searchChannelDtoSchema>;

export const searchResponseDtoSchema = z.object({
  channels: z.array(searchChannelDtoSchema),
  categories: z.array(categoryDtoSchema),
});

export type SearchResponseDto = z.infer<typeof searchResponseDtoSchema>;

// VODs (Task 23)
export const vodDtoSchema = z.object({
  id: z.string().uuid(),
  streamId: z.string().uuid(),
  channelId: z.string().uuid(),
  channelName: z.string(),
  ownerUsername: z.string(),
  ownerId: z.string().uuid().optional(),
  title: z.string(),
  path: z.string(),
  playlistUrl: z.string(),
  durationS: z.number().int().min(0),
  createdAt: z.union([z.string(), z.date()]),
});

export type VodDto = z.infer<typeof vodDtoSchema>;
