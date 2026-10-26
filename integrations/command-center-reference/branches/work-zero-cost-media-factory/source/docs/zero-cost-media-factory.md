# Zero-Cost Media Factory — experiment 0

This branch tests one bounded claim: a phone-triggerable GitHub Actions run in this public repository can compile a vertical MP4 and a machine-readable evidence receipt without a paid media API.

It deliberately does **not** publish anywhere. A successful workflow establishes compilation, not publication.

## Outputs

- `ngl-short.mp4` — 1080×1920 H.264 video
- `ngl-short.sha256` — artifact digest
- `receipt.json` — distinguishes observed compilation from unverified publication

## Falsification

The experiment fails if the workflow cannot install FFmpeg, cannot render the MP4, cannot produce a non-empty artifact, or cannot emit the receipt. A green run is evidence only for the bounded build assertions encoded in the workflow; it is not evidence that social distribution, autonomous research, narration, or generative video works.
