Task 29: Test suite reliability and CI pipeline.
Stabilized server test suite (fileParallelism: false, isolated test channels, synchronous closeWs cleanup), passing 117/117 tests across 21 test files.
Added Playwright E2E suite in apps/web/e2e covering registration, broadcast/playback (fake media), live chat, moderation, and stream termination.
Configured GitHub Actions workflow (.github/workflows/ci.yml) with Postgres/Redis services, lint, typecheck, Vitest, E2E, and Python lab tests.
Verified web Vitest (9/9 pass) and Python lab pytest (14/14 pass); uncovered server files noted: seed.ts and ffmpeg-manager live process spawns.
