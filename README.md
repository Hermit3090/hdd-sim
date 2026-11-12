# hdd-sim

A synthesized old-school hard drive: head clicks, spindle, and an activity light, driven by this
computer's real disk activity or by a simulation. It also exports clean one-shot click samples
and longer sequences as WAV files. All sound is generated from parameters; no recordings are used.

The specification is in [docs/SPEC.md](docs/SPEC.md).

## Requirements

Node 20 or newer and a current browser. There are no dependencies to install.
Live mode needs Linux. Simulation and export work anywhere.

## Run

```
npm start
```

Then open http://127.0.0.1:8125/ and press **Spin up**. Use `npm start -- --port 9000` for
another port. The server only listens on this computer and only reads disk statistics.

The preset selector also lists the parameter files in `presets/`, under their file names. Save
a file there with "Save parameters (JSON)" and it appears in the list. To use another folder:
`npm start -- --presets ~/my-hdd-presets`. The server only reads from that folder.

- **Live** (the start mode) follows the disks of this computer. Real activity passes through the emulated drive, so
  an SSD still produces the pulsing pattern of a hard drive.
- **Simulation** plays a scenario; every parameter can be changed while it runs.
- **Presets** set everything in the Drive, Mix and Filters sections. The master volume is kept.
- **Spindle volume at −60 dB** leaves the head sound alone, for sampling.
- **Idle baseline** (live mode): keeps a system's background disk activity quiet. "Adaptive"
  starts every activity dim and quiet and raises it to normal while the activity lasts (ramp-up
  time), then lets it fall back (cooldown time). "Manual" is a fixed threshold instead.
  Each of the two modes has its own background brightness and background click level.
- **Read/write pattern** (optional): reads scatter over the disk, writes stay close together,
  and simulated writes are flushed in bursts.
- **Filters**: a high-pass and a low-pass, either one for everything or one per sound part (head
  clicks, motor tones, airflow noise, bearing whine). A high-pass on the motor tones removes the
  deep rumble on headphones.
- **Read and write sound**: in "Separate" mode write clicks get their own pitch and level.

## Export

From the page, or from the command line:

```
node cli/render.js --out out
node cli/render.js --params hdd-sim-params.json --out out --only clicks
```

`--params` takes a file saved with "Save parameters (JSON)" in the page. Other options:
`--preset`, `--rate 44100|48000`, `--seed`, `--only clicks|sequences|all`.

Output: `click_01.wav` … `click_16.wav` (head only, at most 60 ms, peak at −1 dBFS) and
`burst.wav`, `spinup.wav`, `spindown.wav`, `spindle_loop.wav`, `idle.wav`. All mono, 16-bit.
With separate read and write sound the clicks are `click_read_NN.wav` and `click_write_NN.wav`.
Filters that are switched on apply to every export. The same parameters and seed always give
the same files.

## Tests

```
npm test
```

## Layout

| Path | Content |
|---|---|
| `src/dsp/` | Synth core, shared by the browser and Node |
| `src/server/` | Local server and disk statistics |
| `web/` | The page and its audio worklet |
| `cli/render.js` | Export command |
| `test/` | Tests, named after the spec requirements they cover |

## Known deviations from the spec

- **R10.5, identical files.** Page and command share the same code and give byte-identical files
  in Chromium, Brave and Firefox (checked by the user with the `laptop-2000s` preset). Safari has
  not been checked; it may round sine and exponential functions differently in the last digit.

## Licence

MIT, see [LICENSE](LICENSE).
