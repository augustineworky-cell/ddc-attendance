# Staffly voice line

- **staffly-soft.mp3** – the one the app plays (v52+). Same "Staffly" recording as
  staffly.mp3, but 12 dB quieter, harsh treble smoothed out, gentle fade in/out,
  after staff said the original was too loud.
- **staffly.mp3** – the original loud recording, kept for reference only (not played).

To change the sound, replace staffly-soft.mp3 (keep it soft: peak around -16 dB)
and bump CACHE_NAME in service-worker.js.
