# WXHN Spotify Lyrics Studio — Render Patch Copy

This folder is a copy of the original ZIP with only the required render/export patches applied.

## Patched files

### `src/utils/export.worker.ts`
- Removed Opus fallback from the MP4 audio path; AAC profiles only.
- Kept audio at 44.1 kHz and tied sample/timestamp calculations to the negotiated target sample rate.
- Changed audio encoder backpressure from `break` to wait-until-drained.
- Added encoder error checks while draining.

### `src/utils/spotifyVideoRecorder.ts`
- Removed Opus from WebCodecs preflight AAC negotiation.
- Added actual AAC codec negotiation to the main-thread WebCodecs exporter instead of hardcoding `mp4a.40.2`.
- Added audio encoder backpressure in progressive and tail encoding.
- Added basic MP4 buffer/blob sanity validation before returning Worker/WebCodecs output.
- Improved FFmpeg fallback frame pacing so render time is included in the target frame interval rather than added to a full-frame sleep.

### `server.ts`
- Removed `-r` as an FFmpeg input option.
- Replaced `-vsync 1` with `-fps_mode passthrough` for the fallback transcode.

## Intentionally unchanged
- `downloadBlob()`
- audio normalization utilities
- WAV conversion utility
- UI components
- server validation logic

## Validation note
The original ZIP already fails TypeScript parsing in `src/utils/spotifyVideoRecorder.ts` with pre-existing `TS1128` / `TS1005` syntax errors. The patched copy preserves those unrelated errors; this patch does not claim the project builds cleanly until that baseline syntax issue is fixed.
