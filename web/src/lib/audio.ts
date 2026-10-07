// Microphone capture at the 16 kHz mono rate the EmbeddingGemma 2 audio
// encoder expects.

// Root-mean-square level of a window, used to skip near-silent audio before
// running the classifier (which otherwise happily labels silence).
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export class SoundCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  async start(onWindow: (pcm: Float32Array) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule(
      new URL("../worklets/pcm-worklet.js", import.meta.url),
    );
    const node = new AudioWorkletNode(ctx, "pcm-collector");
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onWindow(e.data);
    ctx.createMediaStreamSource(this.stream).connect(node);
    node.connect(ctx.destination); // keeps the graph pulling
    this.ctx = ctx;
    this.node = node;
  }

  async stop(): Promise<void> {
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await this.ctx?.close();
    this.ctx = null;
  }
}
