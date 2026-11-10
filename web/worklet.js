// Audio worklet: runs the synth engine in the browser's audio thread.

import { Engine } from '/dsp/engine.js';
import { sanitizeParams } from '/dsp/params.js';

const STATE_EVERY = 1024; // samples between state messages to the page

class HddSimProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.engine = new Engine(sanitizeParams(options.processorOptions.params), sampleRate);
    this.muted = false;
    this.sinceState = 0;
    this.port.onmessage = (event) => this.handle(event.data);
  }

  handle(msg) {
    const engine = this.engine;
    switch (msg.type) {
      case 'params': engine.setParams(sanitizeParams(msg.params)); break;
      case 'mode': engine.setSimEnabled(msg.mode === 'sim'); break;
      case 'feed': engine.feed(msg.ops, msg.bytes, msg.interval, msg.writes); break;
      case 'baseline-reset': engine.baseline.reset(); break;
      case 'seek': engine.triggerSeek(msg.dist, !!msg.write); break;
      case 'spin': if (msg.up) engine.spinUp(); else engine.spinDown(); break;
      case 'mute': this.muted = !!msg.muted; break;
    }
  }

  process(inputs, outputs) {
    const channels = outputs[0];
    const out = channels[0];
    this.engine.process(out);
    if (this.muted) out.fill(0); // the engine keeps running, so the light still works (R7.4)
    for (let c = 1; c < channels.length; c++) channels[c].set(out);

    this.sinceState += out.length;
    if (this.sinceState >= STATE_EVERY) {
      this.sinceState = 0;
      const e = this.engine;
      this.port.postMessage({
        light: e.takeLight(),
        queue: e.model.queue.length,
        spindle: e.spindle.state,
        speed: e.spindle.speed,
        baseline: e.baseline.baseline,
        rate: e.baseline.rate,
        background: e.baseline.background,
        level: e.baseline.level,
      });
    }
    return true;
  }
}

registerProcessor('hdd-sim', HddSimProcessor);
