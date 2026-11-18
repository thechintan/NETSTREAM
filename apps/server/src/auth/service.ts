import { eq, sql } from 'drizzle-orm';
import {
  LoginInput,
  RegisterInput,
} from '@netstream/shared';
import {
  channels,
  db,
  refreshTokens,
  users,
  withTransaction,
} from '../db/index.js';
import {
  generateRandomToken,
  generateStreamKey,
  hashPassword,
  hashToken,
  verifyPassword,
} from './crypto.js';
import { signAccessToken } from './jwt.js';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthSuccessResult {
  user: {
    id: string;
    email: string;
    username: string;
    createdAt: Date;
  };
  accessToken: string;
  rawRefreshToken: string;
  refreshTokenExpiresAt: Date;
}

export async function registerUser(
  input: RegisterInput
): Promise<{ status: number; result?: AuthSuccessResult; error?: { code: string; message: string } }> {
  // Check if email already exists
  const [existingEmail] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()));

  if (existingEmail) {
    return {
      status: 409,
      error: { code: 'EMAIL_EXISTS', message: 'Email is already registered' },
    };
  }

  // Check if username already exists case-insensitively
  const [existingUsername] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${input.username})`);

  if (existingUsername) {
    return {
      status: 409,
      error: { code: 'USERNAME_EXISTS', message: 'Username is already taken' },
    };
  }

  const passwordHash = await hashPassword(input.password);
  const streamKey = generateStreamKey();
  const streamKeyHash = await hashPassword(streamKey);
  const rawRefreshToken = generateRandomToken(32);
  const tokenHash = hashToken(rawRefreshToken);
  const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const createdUser = await withTransaction(async (tx) => {
    const [newUser] = await tx
      .insert(users)
      .values({
        email: input.email.toLowerCase(),
        username: input.username,
        passwordHash,
      })
      .returning();

    await tx.insert(channels).values({
      ownerId: newUser.id,
      name: newUser.username,
      title: `${newUser.username}'s stream`,
      streamKeyHash,
      isLive: false,
      slowSeconds: 0,
    });

    await tx.insert(refreshTokens).values({
      userId: newUser.id,
      tokenHash,
      expiresAt: refreshTokenExpiresAt,
    });

    return newUser;
  });

  const accessToken = await signAccessToken({
    id: createdUser.id,
    username: createdUser.username,
    email: createdUser.email,
  });

  return {
    status: 201,
    result: {
      user: {
        id: createdUser.id,
        email: createdUser.email,
        username: createdUser.username,
        createdAt: createdUser.createdAt,
      },
      accessToken,
      rawRefreshToken,
      refreshTokenExpiresAt,
    },
  };
}

export async function loginUser(
  input: LoginInput
): Promise<{ status: number; result?: AuthSuccessResult; error?: { code: string; message: string } }> {
  const identifier = (input.identifier || input.username || input.email)!.trim();

  // Find user by username or email case-insensitively
  const [user] = await db
    .select()
    .from(users)
    .where(
      sql`lower(${users.username}) = lower(${identifier}) OR lower(${users.email}) = lower(${identifier})`
    );

  // Return identical error messages for unknown user and wrong password
  if (!user) {
    return {
      status: 401,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
    };
  }

  const passwordValid = await verifyPassword(user.passwordHash, input.password);
  if (!passwordValid) {
    return {
      status: 401,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
    };
  }

  const rawRefreshToken = generateRandomToken(32);
  const tokenHash = hashToken(rawRefreshToken);
  const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt: refreshTokenExpiresAt,
  });

  const accessToken = await signAccessToken({
    id: user.id,
    username: user.username,
    email: user.email,
  });

  return {
    status: 200,
    result: {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
      accessToken,
      rawRefreshToken,
      refreshTokenExpiresAt,
    },
  };
}

export async function refreshSession(
  rawToken: string | undefined
): Promise<{ status: number; result?: AuthSuccessResult; error?: { code: string; message: string } }> {
  if (!rawToken) {
    return {
      status: 401,
      error: { code: 'UNAUTHORIZED', message: 'Missing refresh token' },
    };
  }

  const tokenHash = hashToken(rawToken);
  const [record] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash));

  if (!record) {
    return {
      status: 401,
      error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' },
    };
  }

  // Reuse detection: if a revoked token is reused, revoke all of user's refresh tokens
  if (record.revokedAt !== null) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, record.userId));

    return {
      status: 401,
      error: {
        code: 'TOKEN_REUSED',
        message: 'Invalid session. Token reuse detected; all sessions revoked.',
      },
    };
  }

  // Check expiration
  if (record.expiresAt < new Date()) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, record.id));

    return {
      status: 401,
      error: { code: 'TOKEN_EXPIRED', message: 'Refresh token expired' },
    };
  }

  // Valid token: rotate
  const newRawRefreshToken = generateRandomToken(32);
  const newTokenHash = hashToken(newRawRefreshToken);
  const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const [user] = await withTransaction(async (tx) => {
    const [newToken] = await tx
      .insert(refreshTokens)
      .values({
        userId: record.userId,
        tokenHash: newTokenHash,
        expiresAt: refreshTokenExpiresAt,
      })
      .returning();

    await tx
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
        replacedBy: newToken.id,
      })
      .where(eq(refreshTokens.id, record.id));

    return tx.select().from(users).where(eq(users.id, record.userId));
  });

  if (!user) {
    return {
      status: 401,
      error: { code: 'UNAUTHORIZED', message: 'User not found' },
    };
  }

  const accessToken = await signAccessToken({
    id: user.id,
    username: user.username,
    email: user.email,
  });

  return {
    status: 200,
    result: {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
      accessToken,
      rawRefreshToken: newRawRefreshToken,
      refreshTokenExpiresAt,
    },
  };
}

export async function logoutSession(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, tokenHash));
}

export async function getMe(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return null;

  const [channel] = await db
    .select({
      id: channels.id,
      ownerId: channels.ownerId,
      name: channels.name,
      title: channels.title,
      categoryId: channels.categoryId,
      isLive: channels.isLive,
      slowSeconds: channels.slowSeconds,
      recordVod: channels.recordVod,
      createdAt: channels.createdAt,
    })
    .from(channels)
    .where(eq(channels.ownerId, userId));

  return {
    user,
    channel: channel || null,
  };
}
