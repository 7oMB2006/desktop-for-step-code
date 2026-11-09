class SpeechCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1600);
    this.length = 0;
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data !== 'stop' || this.stopped) return;
      this.stopped = true;
      this.flush();
      this.port.postMessage({ type: 'stopped' });
    };
  }
  flush() {
    if (!this.length) return;
    const samples = this.block.slice(0, this.length);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.length = 0;
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      this.block[this.length++] = sample / channels.length;
      if (this.length === this.block.length) this.flush();
    }
    return true;
  }
}
registerProcessor('desktop-speech-capture', SpeechCaptureProcessor);
