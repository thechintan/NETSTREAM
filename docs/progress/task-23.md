# Task 23: Record Streams as VODs
- Added migration `0002_channel_record_vod.sql` (`channels.record_vod` boolean default `true`), `VOD_RETENTION_DAYS` config (default 7), and Channel Settings toggle.
- Extended FFmpeg pipeline to emit a complete VOD HLS output (`-hls_playlist_type event`, `-hls_list_size 0`) into `VOD_DIR/{streamId}/`, stop cleanly on stream end, probe duration via `ffprobe`, discard clips < 10s, and persist `vods` rows.
- Added REST endpoints (`GET /api/channels/:id/vods`, `GET /api/vods/:id`, owner-only `DELETE /api/vods/:id`), path-safe `/vod/:streamId/:file` serving, Vite `/vod` proxy, and startup + daily retention cleanup job.
- Built Channel **Past broadcasts** tab and `/vod/:id` `hls.js` playback page with seek bar, ±10s skip, duration/date metadata, and owner delete; verified `src/recording/vod.test.ts` (5/5 pass) and server/web typecheck.
