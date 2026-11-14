# Models

## `hand_landmarker.task`

MediaPipe HandLandmarker, **float16** variant. Used by `src/camera/tracker.js`
to locate both hands in the webcam image.

| | |
|---|---|
| Source | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task` |
| Size | 7,819,105 bytes |
| md5 | `15318430ea3851670fe9914116a9cfad` (`FTGEMOo4UWcP6ZFBFqnPrQ==` base64, as served in `x-goog-hash`) |
| Retrieved | 2026-11-14 |
| Licence | Apache-2.0, matching `@mediapipe/tasks-vision` |

### Why this file is committed

The MediaPipe **wasm runtime** ships inside the npm package
(`@mediapipe/tasks-vision/wasm/`) and arrives with `npm install`, so it is not
committed — `node_modules/` is gitignored and `vite.config.js` serves it.

The **model** does not ship in the npm package. Committing it is what lets the
game run with no network, which
`docs/superpowers/specs/2026-11-14-phase2-camera-design.md` requires: a rhythm
game that half-works on bad wifi is worse than a slightly larger repo.

### Upgrading

Re-download, check the byte count and md5 against a fresh `curl -I`, update
the table above, and re-measure frame rate before trusting the main-thread
inference decision — the variant choice is what that budget rests on.

Note that git keeps every committed version of a binary forever and binaries
do not delta-compress, so each upgrade adds its full size to the pack
permanently. Upgrade deliberately, not routinely.
