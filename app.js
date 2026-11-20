"use strict";

const TUNINGS = {
  guitar: {
    label: "Guitar",
    strings: [
      { name: "E", octave: 2, freq: 82.41 },
      { name: "A", octave: 2, freq: 110.00 },
      { name: "D", octave: 3, freq: 146.83 },
      { name: "G", octave: 3, freq: 196.00 },
      { name: "B", octave: 3, freq: 246.94 },
      { name: "e", octave: 4, freq: 329.63 },
    ],
  },
  ukulele: {
    label: "Ukulele",
    strings: [
      { name: "G", octave: 4, freq: 392.00 },
      { name: "C", octave: 4, freq: 261.63 },
      { name: "E", octave: 4, freq: 329.63 },
      { name: "A", octave: 4, freq: 440.00 },
    ],
  },
};

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const IN_TUNE_CENTS = 5;

const el = {
  startScreen: document.getElementById("startScreen"),
  tunerScreen: document.getElementById("tunerScreen"),
  startBtn: document.getElementById("startBtn"),
  stringPicker: document.getElementById("stringPicker"),
  tuningSelect: document.getElementById("tuningSelect"),
  noteName: document.getElementById("noteName"),
  freqReadout: document.getElementById("freqReadout"),
  centsReadout: document.getElementById("centsReadout"),
  needle: document.getElementById("needle"),
  status: document.getElementById("status"),
  refBtn: document.getElementById("refBtn"),
};

let audioCtx = null;
let analyser = null;
let micStream = null;
let buf = null;
let running = false;
let selectedString = "auto";
let currentTuning = "guitar";
const strings = () => TUNINGS[currentTuning].strings;
let osc = null;
let lastUpdate = 0;

// --- Pitch detection (autocorrelation) ---

function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  }
  const trimmed = buf.slice(r1, r2);
  const N = trimmed.length;

  const c = new Float32Array(N).fill(0);
  for (let lag = 0; lag < N; lag++) {
    for (let i = 0; i < N - lag; i++) {
      c[lag] += trimmed[i] * trimmed[i + lag];
    }
  }

  let d = 0;
  while (d < N - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < N; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  if (maxpos <= 0) return -1;

  let T0 = maxpos;
  const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);

  return sampleRate / T0;
}

// --- Note math ---

function freqToMidiFloat(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

function centsOff(freq, target) {
  return 1200 * Math.log2(freq / target);
}

function nearestNoteInfo(freq) {
  const midi = Math.round(freqToMidiFloat(freq));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const target = 440 * Math.pow(2, (midi - 69) / 12);
  return { name, octave, target, midi };
}

// --- UI ---

function setNoteState(state) {
  el.noteName.dataset.state = state;
}

function updateDisplay(freq) {
  let target = null;

  if (selectedString !== "auto") {
    target = strings()[Number(selectedString)].freq;
  }

  let label, cents;
  if (target !== null) {
    const s = strings()[Number(selectedString)];
    cents = centsOff(freq, target);
    label = s.name + s.octave;
  } else {
    const info = nearestNoteInfo(freq);
    target = info.target;
    cents = centsOff(freq, target);
    label = info.name + info.octave;
  }

  el.noteName.textContent = label;
  el.noteName.dataset.state = "listening";
  el.freqReadout.textContent = freq.toFixed(1) + " Hz";
  el.centsReadout.textContent = (cents > 0 ? "+" : "") + Math.round(cents) + " cents";

  const clamped = Math.max(-50, Math.min(50, cents));
  const pct = 50 + (clamped / 50) * 50;
  el.needle.style.left = pct + "%";

  if (Math.abs(cents) <= IN_TUNE_CENTS) {
    setNoteState("tuned");
    setStatus("In tune ✓", true);
  } else if (cents < 0) {
    setNoteState("flat");
    setStatus("Too flat — tune up", false);
  } else {
    setNoteState("sharp");
    setStatus("Too sharp — tune down", false);
  }
}

function setStatus(text, ok) {
  el.status.textContent = text;
  el.status.classList.toggle("ok", !!ok);
}

// --- Audio loop ---

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);

  const now = performance.now();
  if (now - lastUpdate < 60) return;
  lastUpdate = now;

  analyser.getFloatTimeDomainData(buf);
  const freq = autoCorrelate(buf, audioCtx.sampleRate);
  if (freq > 50 && freq < 1500) {
    updateDisplay(freq);
  }
}

// --- Reference tone ---

function toggleReference() {
  if (osc) {
    osc.stop();
    osc = null;
    el.refBtn.classList.remove("playing");
    el.refBtn.textContent = "Play reference tone";
    return;
  }
  const stringIdx = selectedString !== "auto" ? Number(selectedString) : strings().length - 1;
  osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = strings()[stringIdx].freq;
  osc.connect(audioCtx.destination);
  osc.start();
  el.refBtn.classList.add("playing");
  el.refBtn.textContent = "Stop tone";
  osc.onended = () => {
    osc = null;
    el.refBtn.classList.remove("playing");
    el.refBtn.textContent = "Play reference tone";
  };
}

// --- Start ---

async function start() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    setStatus("Microphone access denied", false);
    el.startBtn.textContent = "Retry";
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  buf = new Float32Array(analyser.fftSize);

  el.startScreen.classList.add("hidden");
  el.tunerScreen.classList.remove("hidden");
  running = true;
  lastUpdate = 0;
  loop();
}

// --- Events ---

function buildStringPicker() {
  el.stringPicker.innerHTML = "";
  strings().forEach((s, i) => {
    const btn = document.createElement("button");
    btn.dataset.string = String(i);
    btn.textContent = s.name;
    const oct = document.createElement("span");
    oct.textContent = s.octave;
    btn.appendChild(oct);
    el.stringPicker.appendChild(btn);
  });
  const autoBtn = document.createElement("button");
  autoBtn.dataset.string = "auto";
  autoBtn.className = "active";
  autoBtn.textContent = "Auto";
  el.stringPicker.appendChild(autoBtn);
}

el.tuningSelect.addEventListener("change", (e) => {
  currentTuning = e.target.value;
  selectedString = "auto";
  buildStringPicker();
  setStatus(TUNINGS[currentTuning].label + " — Auto detect, pluck any string", false);
});

el.startBtn.addEventListener("click", start);

el.stringPicker.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  el.stringPicker.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  selectedString = btn.dataset.string;
  setStatus(
    selectedString === "auto"
      ? "Auto detect — pluck any string"
      : "Tuning " + strings()[Number(selectedString)].name + strings()[Number(selectedString)].octave,
    false
  );
});

el.refBtn.addEventListener("click", toggleReference);
