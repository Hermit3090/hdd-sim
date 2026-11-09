# hdd-sim specification

Status: DRAFT, awaiting owner approval. No code is written before this is approved and committed.

## 1. Purpose

hdd-sim synthesizes the sound of an old hard drive and shows an emulated drive activity light.
It serves two uses:

- An audible and visible readout of disk activity on the local machine, real or simulated.
- A source of clean, licence-free head-click samples for other projects (first consumer: an
  Android launcher that plays one-shot clicks through SoundPool).

All sound is generated from parameters. No recorded audio is shipped, loaded or mixed in.

## 2. Scope

### In v1

- HDD synth: head (seek) sound and spindle sound, spin-up and spin-down.
- Drive model that turns disk activity into mechanical events.
- One activity light.
- Live mode (real disk statistics) and simulation mode (editable parameters).
- WAV export of one-shot clicks and of sequences.

### Not in v1

- CPU, network and memory layers (see section 12).
- Any Android code or runtime synth for Android.
- Platforms other than Linux for live mode. Simulation mode and export work wherever Node 20+
  and a current browser run.

## 3. Terms

- **Operation**: one emulated disk request (a seek followed by a transfer).
- **Seek**: a head movement. Produces head sound.
- **Click**: one synthesized head impulse.
- **Head layer / spindle layer**: the two sound layers, mixed separately.
- **Preset**: a named set of drive parameters. **Scenario**: a named set of simulation
  parameters.

## 4. Architecture

- R4.1 The project has no third-party dependencies. It uses plain JavaScript ES modules, Node
  built-in modules and standard browser APIs.
- R4.2 The synth core (drive model, click, spindle, mixer, random generator, WAV encoder) uses no
  Node-only and no browser-only API. The same source files run in the browser audio worklet, in
  Node for export, and in tests.
- R4.3 The core is sample-rate independent. Supported rates: 44100 and 48000 Hz.
- R4.4 All randomness comes from one seeded generator. The same parameters, seed and sample rate
  produce bit-identical output.
- R4.5 Every tunable value is part of one parameter object that serializes to JSON. The page
  can export and import it, and the export command reads it.

## 5. Drive model

Input is a stream of activity: operations per second and bytes per second, split into reads and
writes. Output is a timed list of seeks and a busy signal.

- R5.1 Incoming operations enter a queue. The emulated drive serves one operation at a time.
- R5.2 Each operation has a seek distance between 0 and 1 (fraction of full stroke), drawn from
  the configured distribution. Distance 0 means no seek (sequential access) and makes no click.
- R5.3 Seek time = settle time + (full-stroke time − settle time) × √distance.
  Defaults: settle 2 ms, full stroke 22 ms.
- R5.4 Transfer time = operation size ÷ media transfer rate, plus a rotational wait drawn
  uniformly between 0 and one revolution. Default transfer rate: 8 MB/s.
- R5.5 The queue has a maximum length (default 64). When it is full, new operations are merged
  into the newest queued one (its size grows). This bounds latency under SSD-level load, so heavy
  load sounds like continuous thrashing, not like a backlog that plays for minutes.
- R5.6 The drive is busy while it serves an operation. Idle otherwise.
- R5.7 Idle behaviour: after a configurable idle time the drive makes occasional single
  recalibration seeks (default: one every 20–60 s, can be switched off).
- R5.8 The model never emits more seeks per second than 1 ÷ settle time.

## 6. Sound synthesis

Reference measurements behind the defaults are in section 11.

### 6.1 Head click

- R6.1 A click is a short noise burst (default 1.5 ms, range 0.3–3 ms) fed into a bank of damped
  resonators, plus one low-frequency body resonator.
- R6.2 Resonator bank of the default preset "laptop-2000s": 1115, 1390, 1600, 1935 and 3620 Hz
  with decay times (to −20 dB) between 5 and 10 ms; body at 175 Hz, decay 15 ms. Bank of the
  "desktop-90s" preset: 850, 1430, 2100, 3100 Hz, decay 4–12 ms; body at 300 Hz. Number of
  resonators is configurable from 2 to 8.
- R6.3 Per-click variation, each within a configurable range: resonator frequencies ±4 %, level
  ±3 dB, decay ±20 %.
- R6.4 Click level and brightness rise with seek distance. Seeks longer than a threshold
  (default distance 0.3) produce two clicks, one at the start and one at the end of the seek.
  Shorter seeks produce one.
- R6.5 A single click lasts at most 60 ms from onset to below −60 dB relative to its peak.
- R6.6 The head layer contains nothing but clicks: no noise floor, no hum, no reverb.

### 6.2 Spindle

- R6.7 The spindle sound has three parts, each with its own level: motor harmonics of the
  rotation frequency (rpm ÷ 60, with emphasis on configurable harmonic numbers, default 1, 10
  and 12), a bearing whine (narrow band; 4.3 kHz in "desktop-90s", off in "laptop-2000s"), and
  band-limited noise (airflow).
- R6.8 Speed is set by the preset: 4200 rpm (70 Hz) for "laptop-2000s", 5400 rpm (90 Hz) for
  "desktop-90s". Range: 3600–7200 rpm.
- R6.9 Spin-up: speed rises from 0 to the target over the spin-up time (default 4 s) on an
  easing curve; pitch and level follow speed. Spin-down: the reverse, default 6 s.
- R6.10 Spin-up ends with a short head-unlock sequence of clicks (can be switched off).

### 6.3 Mixer

- R6.11 Separate gains for head, spindle and master, each from silence to +6 dB.
- R6.12 With spindle gain at silence the output is exactly the head layer, and the reverse.
- R6.13 Output is mono. A soft limiter on the master prevents clipping. The limiter is bypassed
  for one-shot export, which is normalized instead (R10.2).

### 6.4 Presets

- R6.14 Shipped presets: "laptop-2000s" (the default; 4200 rpm, crisp ticking head, tuned to the
  primary reference in section 11) and "desktop-90s" (5400 rpm, louder and clackier head, bearing
  whine). A preset sets every drive parameter. More may be added without a spec change, as they
  are parameter values only.

## 7. Activity light

- R7.1 One light. It follows the drive model's busy signal (R5.6), not the raw statistics.
- R7.2 Brightness rises and falls with short time constants (defaults: 2 ms on, 30 ms off), so
  rapid activity reads as flicker and sustained activity as steady light.
- R7.3 Colour is selectable: red, green, amber.
- R7.4 The light works with sound muted.

## 8. Live mode

- R8.1 A local Node server serves the page and a statistics stream. It listens on 127.0.0.1 only
  (default port 8125, configurable). It has no authentication, no write endpoints, and serves no
  files outside the project's web and synth-core directories.
- R8.2 The server reads `/proc/diskstats` at 20 Hz and streams, per whole-disk device, the
  change since the previous sample: reads, writes, bytes read, bytes written. Transport is
  server-sent events.
- R8.3 The page lists the devices and lets the user pick one or "all devices summed".
- R8.4 The page feeds these changes into the drive model as operations, spread evenly over the
  sample interval.
- R8.5 If the stream stops, the page shows that live data is unavailable and the drive goes
  idle. Simulation mode keeps working without the server's statistics.

## 9. Simulation mode

- R9.1 Activity comes from a generator with these controls: operations per second (0–500),
  burstiness (0 = even, 1 = long pauses and dense bursts), mean burst length, seek-distance
  spread (0 = all sequential, 1 = full random), read/write mix, mean operation size.
- R9.2 Scenario defaults follow the burst figures in section 11 (bursts of 2–7 seeks, 25–35 ms
  apart). Shipped scenarios: "idle", "boot", "file copy" (mostly sequential), "thrash" (random,
  defrag-like), "light desktop use".
- R9.3 Buttons trigger a single seek at a chosen distance, spin-up and spin-down, for auditioning
  individual sounds.
- R9.4 All drive parameters from sections 5–7 are editable in the page while sound plays, and
  changes are audible within 100 ms.

## 10. Export

- R10.1 Format: WAV, mono, 16-bit PCM, 44100 or 48000 Hz (default 44100).
- R10.2 One-shot click set: N variants (default 16) of the head layer only, spread over a
  configurable range of seek distances. Each file: starts within 1 ms of the onset, peak
  normalized to −1 dBFS, ends in digital silence after a fade, at most 60 ms long. Files are
  named `click_NN.wav`.
- R10.3 Sequences, each as one file: burst (configurable scenario and length), spin-up,
  spin-down, spindle loop (seamless when looped, default 4 s), idle with spindle.
  Head and spindle gains apply, so head-only sequences are possible.
- R10.4 The page offers these exports as downloads using the current parameters and seed.
- R10.5 A command, `node cli/render.js`, produces the same exports into a directory from a
  parameter JSON file. Page and command produce identical files for identical input.

## 11. Reference measurements

Measured on recordings from the owner's private reference collection, with a simple onset
detector. They set the defaults above and are approximate. The recordings themselves are not
part of this repository.

### Primary reference: 2004 laptop drive (two curated clips, 46 s and 103 s)

This is the reference the owner rates best. The "laptop-2000s" preset is tuned to it.

| Property | Measured |
|---|---|
| Spindle fundamental | 70 Hz (4200 rpm), with a weaker tone at 59 Hz |
| Motor harmonics | 700 and 842 Hz (10th and 12th), about 25–29 dB below the fundamental |
| Click resonances | 1115, 1390, 1600, 1935 and 3620 Hz; body at 165–190 Hz |
| Click energy | Mostly 1.2–2.5 kHz, second region 3.5–5 kHz |
| Click attack | 1.3–3 ms, typically 2 ms |
| Click decay to −20 dB | 6–18 ms, typically 6.5–9 ms |
| Click level above idle noise | 16–20 dB, a narrow spread |
| Spacing of clicks inside a burst | Mostly 12–100 ms, typically 25–35 ms |
| Clicks per burst | Typically 2–7, up to about 25 |
| Burst length | Typically 30–250 ms, up to about 1 s |

### Other references (eight recordings, various desktop drives)

| Property | Measured |
|---|---|
| Click energy | Mostly between 300 Hz and 4 kHz |
| Recurring click resonances | Around 800–1000, 1430, 2100 and 3000–3200 Hz; body around 200–400 Hz |
| Click decay to −20 dB | 3–24 ms, typically 8–12 ms |
| Click level above idle noise | 16–25 dB typical, up to 37 dB for spin-up/park clunks |
| Spindle fundamental | 90 Hz (5400 rpm) and 120 Hz (7200 rpm) |
| Motor harmonics | 900 and 1080 Hz on a 90 Hz drive (10th and 12th) |
| Bearing whine on old drives | Narrow tones between 4 and 8.5 kHz |
| Spin-up time | About 3.5–5 s |

## 12. Roadmap (not part of v1)

- CPU layer: sci-fi bleeps whose rate and intensity follow CPU load.
- Network layer: modem-style handshake on connection events, filtered noise whose brightness
  follows transfer speed.
- Memory layer.
- One light per layer, and an on/off toggle per sound layer.

## 13. Open questions

1. Runtime synth on Android in place of exported WAVs. Current answer: no, SoundPool one-shots
   use the least resources.
2. A second light mode that follows raw statistics, to show the SSD's real all-or-nothing
   pattern next to the emulated one.
3. Stereo output (head and spindle placed slightly apart). v1 is mono.
4. Different click character for reads and writes. v1 treats them the same.

## 14. Acceptance

- A1 Automated tests cover: R4.4 (bit-identical renders), R5.5 and R5.8 (queue bound, seek rate
  cap), R6.5 (click length), R6.12 (layer isolation), R6.13 (no clipping, no NaN), R10.2
  (one-shot format, onset, peak, silent end, length), R10.3 (loop seam), R10.5 (page core and
  command agree).
- A2 Live mode reacts to a real disk load within 200 ms and returns to idle when the load ends.
- A3 The owner judges realism by ear against the reference collection. Parameter retuning that
  stays inside the ranges in this spec is not a spec change.
