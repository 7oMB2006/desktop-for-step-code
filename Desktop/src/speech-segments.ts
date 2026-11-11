const RATE = 16000;
const BLOCK = 1600;
const SILENCE = 11200;
const MAX_SEGMENT = 4 * RATE;

export function speechLevel(samples: Float32Array) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / Math.max(1, samples.length));
}

// Non-overlapping PCM phrases, cut on a pause or at four seconds.
export class SpeechSegments {
  private pending = new Float32Array(BLOCK);
  private pendingLength = 0;
  private lead: Float32Array[] = [];
  private phrase: Float32Array[] = [];
  private length = 0;
  private voiced = 0;
  private silence = 0;

  push(samples: Float32Array): Float32Array[] {
    const ready: Float32Array[] = [];
    for (let offset = 0; offset < samples.length;) {
      const size = Math.min(BLOCK - this.pendingLength, samples.length - offset);
      this.pending.set(samples.subarray(offset, offset + size), this.pendingLength);
      this.pendingLength += size;
      offset += size;
      if (this.pendingLength === BLOCK) {
        const block = this.pending;
        this.pending = new Float32Array(BLOCK); this.pendingLength = 0;
        const segment = this.block(block);
        if (segment) ready.push(segment);
      }
    }
    return ready;
  }

  finish(): Float32Array | undefined {
    if (this.pendingLength) this.block(this.pending.slice(0, this.pendingLength));
    this.pendingLength = 0;
    return this.take();
  }

  private block(samples: Float32Array): Float32Array | undefined {
    const speaking = speechLevel(samples) >= 0.01;
    if (!this.phrase.length && !speaking) {
      this.lead.push(samples);
      if (this.lead.length > 2) this.lead.shift();
      return;
    }
    if (!this.phrase.length) {
      this.phrase = this.lead;
      this.length = this.lead.reduce((sum, block) => sum + block.length, 0);
      this.lead = [];
    }
    this.phrase.push(samples); this.length += samples.length;
    if (speaking) { this.voiced += samples.length; this.silence = 0; }
    else this.silence += samples.length;
    if (this.length >= MAX_SEGMENT || this.silence >= SILENCE) return this.take();
  }

  private take(): Float32Array | undefined {
    let segment: Float32Array | undefined;
    if (this.voiced >= 3200) {
      segment = new Float32Array(this.length);
      let offset = 0;
      for (const block of this.phrase) { segment.set(block, offset); offset += block.length; }
    }
    this.phrase = []; this.lead = []; this.length = 0; this.voiced = 0; this.silence = 0;
    return segment;
  }
}

export function appendSpeechText(draft: string, text: string, continuation: boolean) {
  if (!draft) return text;
  if (!continuation) return `${draft}\n${text}`;
  const space = /[A-Za-z0-9][,.;:!?]?$/.test(draft) && /^[A-Za-z0-9]/.test(text) ? ' ' : '';
  return `${draft}${space}${text}`;
}
