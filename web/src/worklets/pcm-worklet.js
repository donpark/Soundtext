// Collects mono PCM and posts fixed-size windows to the main thread.
// Window size is 2s; classification therefore runs every 2s.
const WINDOW_SECONDS = 2;

class PcmCollector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(0);
    this.window = sampleRate * WINDOW_SECONDS;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch?.length) {
      const merged = new Float32Array(this.buf.length + ch.length);
      merged.set(this.buf);
      merged.set(ch, this.buf.length);
      this.buf = merged;
      while (this.buf.length >= this.window) {
        this.port.postMessage(this.buf.slice(0, this.window));
        this.buf = this.buf.slice(this.window);
      }
    }
    // Keep the processor alive and output silence.
    return true;
  }
}

registerProcessor("pcm-collector", PcmCollector);
