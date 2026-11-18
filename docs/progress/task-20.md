# Task 20: Chat Polish
- Created 12 original SVG emotes + manifest in `apps/web/public/emotes/` (`emotes.json`, `wave`, `pog`, `fire`, `heart`, `gg`, `lul`, `hype`, `cool`, `sad`, `rocket`, `star`, `clap`).
- Built O(n) XSS-safe tokenizer `apps/web/src/features/chat/tokenizer.ts` splitting text, `:emote:`, `@mention`, and http/https-only links (everything else plain text).
- Updated `ChatPanel.tsx` to render emotes, safe links (`noopener noreferrer nofollow`), owner/mod badges, current-user mention row highlights, and an inline Emote Picker popover.
- Verified with `apps/web/src/features/chat/tokenizer.test.ts` (5/5 adversarial tests pass) and web typecheck.
