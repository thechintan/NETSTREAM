export type ChatToken =
  | { type: 'text'; value: string }
  | { type: 'emote'; name: string; src: string }
  | { type: 'mention'; username: string; raw: string }
  | { type: 'link'; href: string; label: string };

export type EmoteManifest = Record<string, string>;

export const DEFAULT_EMOTES: EmoteManifest = {
  wave: 'wave.svg',
  pog: 'pog.svg',
  fire: 'fire.svg',
  heart: 'heart.svg',
  gg: 'gg.svg',
  lul: 'lul.svg',
  hype: 'hype.svg',
  cool: 'cool.svg',
  sad: 'sad.svg',
  rocket: 'rocket.svg',
  star: 'star.svg',
  clap: 'clap.svg',
};

const MAX_EMOTE_NAME_LEN = 32;
const MAX_MENTION_LEN = 32;
const MAX_URL_SCAN_LEN = 2048;

function isWordOrEmailPrevChar(ch: string): boolean {
  return /[a-zA-Z0-9._-]/.test(ch);
}

function isEmoteChar(ch: string): boolean {
  return /[a-zA-Z0-9_-]/.test(ch);
}

function isMentionChar(ch: string): boolean {
  return /[a-zA-Z0-9_-]/.test(ch);
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

const TRAILING_PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':', ')', ']', '}', "'", '"', '>']);

/**
 * Safely parses a chat message into typed tokens: text, emote, mention, and safe http(s) link.
 * Runs in O(n) linear time with zero HTML parsing or regex backtracking.
 */
export function tokenizeMessage(
  text: string,
  emotes: EmoteManifest = DEFAULT_EMOTES,
  emoteBasePath = '/emotes'
): ChatToken[] {
  if (!text) return [];

  const tokens: ChatToken[] = [];
  let textStart = 0;

  const flushText = (endIdx: number) => {
    if (endIdx > textStart) {
      const slice = text.slice(textStart, endIdx);
      const last = tokens[tokens.length - 1];
      if (last && last.type === 'text') {
        last.value += slice;
      } else {
        tokens.push({ type: 'text', value: slice });
      }
    }
  };

  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    // 1. Safe HTTP / HTTPS links only
    if (
      (ch === 'h' || ch === 'H') &&
      (i === 0 || isWhitespace(text[i - 1]) || text[i - 1] === '(' || text[i - 1] === '[')
    ) {
      const prefix8 = text.slice(i, i + 8).toLowerCase();
      if (prefix8.startsWith('http://') || prefix8 === 'https://') {
        let j = i;
        const limit = Math.min(len, i + MAX_URL_SCAN_LEN);
        while (j < limit && !isWhitespace(text[j])) {
          j++;
        }

        // Trim trailing punctuation not part of URL
        let end = j;
        while (end > i + 8 && TRAILING_PUNCTUATION.has(text[end - 1])) {
          end--;
        }

        const candidate = text.slice(i, end);
        let parsed: URL | null = null;
        try {
          const u = new URL(candidate);
          if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0) {
            parsed = u;
          }
        } catch {
          parsed = null;
        }

        if (parsed) {
          flushText(i);
          tokens.push({
            type: 'link',
            href: parsed.href,
            label: candidate,
          });
          i = end;
          textStart = i;
          continue;
        }
      }
    }

    // 2. Emotes (:name:)
    if (ch === ':') {
      let j = i + 1;
      const limit = Math.min(len, i + 1 + MAX_EMOTE_NAME_LEN);
      while (j < limit && isEmoteChar(text[j])) {
        j++;
      }

      if (j > i + 1 && j < len && text[j] === ':') {
        const name = text.slice(i + 1, j);
        if (Object.prototype.hasOwnProperty.call(emotes, name)) {
          const file = emotes[name];
          if (typeof file === 'string' && file.length > 0) {
            flushText(i);
            tokens.push({
              type: 'emote',
              name,
              src: `${emoteBasePath}/${file}`,
            });
            i = j + 1;
            textStart = i;
            continue;
          }
        }
      }
    }

    // 3. Mentions (@username)
    if (ch === '@' && (i === 0 || !isWordOrEmailPrevChar(text[i - 1]))) {
      let j = i + 1;
      const limit = Math.min(len, i + 1 + MAX_MENTION_LEN);
      while (j < limit && isMentionChar(text[j])) {
        j++;
      }

      if (j > i + 1) {
        const username = text.slice(i + 1, j);
        flushText(i);
        tokens.push({
          type: 'mention',
          username,
          raw: text.slice(i, j),
        });
        i = j;
        textStart = i;
        continue;
      }
    }

    i++;
  }

  flushText(len);
  return tokens;
}

export function messageMentionsUser(
  tokens: ChatToken[],
  currentUsername: string | null | undefined
): boolean {
  if (!currentUsername) return false;
  const target = currentUsername.toLowerCase();
  return tokens.some((t) => t.type === 'mention' && t.username.toLowerCase() === target);
}
