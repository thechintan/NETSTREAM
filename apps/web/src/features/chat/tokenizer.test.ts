import { describe, expect, it } from 'vitest';
import { DEFAULT_EMOTES, messageMentionsUser, tokenizeMessage } from './tokenizer';

describe('Chat message tokenizer (Task 20)', () => {
  it('tokenizes text, emotes, mentions, and http/https links accurately', () => {
    const tokens = tokenizeMessage(
      'Hey @alice :wave: check https://example.com/watch?v=1 and http://localhost:5173/c/demo :gg:!',
      DEFAULT_EMOTES
    );

    expect(tokens).toEqual([
      { type: 'text', value: 'Hey ' },
      { type: 'mention', username: 'alice', raw: '@alice' },
      { type: 'text', value: ' ' },
      { type: 'emote', name: 'wave', src: '/emotes/wave.svg' },
      { type: 'text', value: ' check ' },
      { type: 'link', href: 'https://example.com/watch?v=1', label: 'https://example.com/watch?v=1' },
      { type: 'text', value: ' and ' },
      { type: 'link', href: 'http://localhost:5173/c/demo', label: 'http://localhost:5173/c/demo' },
      { type: 'text', value: ' ' },
      { type: 'emote', name: 'gg', src: '/emotes/gg.svg' },
      { type: 'text', value: '!' },
    ]);

    expect(messageMentionsUser(tokens, 'ALICE')).toBe(true);
    expect(messageMentionsUser(tokens, 'bob')).toBe(false);
  });

  it('keeps HTML tags and script payloads strictly as plain text tokens (no HTML injection)', () => {
    const xssInputs = [
      '<script>alert("xss")</script>',
      '<img src="x" onerror="alert(1)">',
      '<a href="https://evil.com" onclick="steal()">click</a>',
      'hello <b>world</b> &amp; <svg onload=alert(1)>',
    ];

    for (const input of xssInputs) {
      const tokens = tokenizeMessage(input, DEFAULT_EMOTES);
      // None of the tokens are HTML or executable; every HTML tag stays inside text tokens
      expect(tokens.every((t) => t.type === 'text')).toBe(true);
      const reconstructed = tokens.map((t) => (t.type === 'text' ? t.value : '')).join('');
      expect(reconstructed).toBe(input);
    }
  });

  it('rejects javascript:, data:, vbscript:, and file: URLs as plain text', () => {
    const dangerousUrls = [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ];

    for (const url of dangerousUrls) {
      const tokens = tokenizeMessage(`Click ${url} now`, DEFAULT_EMOTES);
      expect(tokens.some((t) => t.type === 'link')).toBe(false);
      expect(tokens).toEqual([{ type: 'text', value: `Click ${url} now` }]);
    }
  });

  it('handles nested colons, unknown emotes, and prototype keys safely', () => {
    const tokens = tokenizeMessage(
      '::wave:: :unknown: :foo:pog:bar: :constructor: :__proto__: :toString: :fire:fire:',
      DEFAULT_EMOTES
    );

    expect(tokens).toEqual([
      { type: 'text', value: ':' },
      { type: 'emote', name: 'wave', src: '/emotes/wave.svg' },
      { type: 'text', value: ': :unknown: :foo' },
      { type: 'emote', name: 'pog', src: '/emotes/pog.svg' },
      { type: 'text', value: 'bar: :constructor: :__proto__: :toString: ' },
      { type: 'emote', name: 'fire', src: '/emotes/fire.svg' },
      { type: 'text', value: 'fire:' },
    ]);
  });

  it('handles unicode, emojis, emails, and very long tokens in linear time', () => {
    const longColonSpam = ':'.repeat(10_000) + 'wave:' + 'a'.repeat(10_000);
    const start = performance.now();
    const longTokens = tokenizeMessage(longColonSpam, DEFAULT_EMOTES);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
    expect(longTokens.some((t) => t.type === 'emote' && t.name === 'wave')).toBe(true);

    // Unicode + email should not trigger a false @mention
    const uniTokens = tokenizeMessage('こんにちは 🚀 contact user@example.com @chintan_99 :rocket:', DEFAULT_EMOTES);
    expect(uniTokens).toEqual([
      { type: 'text', value: 'こんにちは 🚀 contact user@example.com ' },
      { type: 'mention', username: 'chintan_99', raw: '@chintan_99' },
      { type: 'text', value: ' ' },
      { type: 'emote', name: 'rocket', src: '/emotes/rocket.svg' },
    ]);
  });
});
