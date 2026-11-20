# Guitar Tuner

A simple, dependency-free guitar tuner web app.

## Features

- Microphone-based pitch detection (autocorrelation, no dependencies)
- Auto mode: detects which string you plucked
- Manual mode: pick a string to tune against standard pitch (E2 A2 D3 G3 B3 E4)
- Ukulele support: standard high-G tuning (G4 C4 E4 A4) via the instrument selector
- Cents deviation gauge with flat/sharp/in-tune feedback
- Reference tone playback for tuning by ear
- Works on desktop and mobile browsers, fully offline once loaded

## How to run

Any static file server works. For example:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in a browser, click **Enable microphone**, and pluck a string.

Microphone access requires a secure context: serve over `https://` or use `localhost`.

## Files

- `index.html` — page structure
- `style.css` — dark-themed styling
- `app.js` — pitch detection (autocorrelation), tuning logic, and reference tone

## Notes

- Audio is analyzed in real time in the browser; nothing is recorded or uploaded.
- "In tune" tolerance is ±5 cents.
