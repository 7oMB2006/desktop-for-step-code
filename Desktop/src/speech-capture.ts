export interface SpeechCapture {
  stop(): Promise<void>;
  cancel(): void;
}

export async function captureSpeech(stream: MediaStream, onSamples: (samples: Float32Array) => void,
  onError: () => void): Promise<SpeechCapture> {
  const context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
  let source: MediaStreamAudioSourceNode | undefined, node: AudioWorkletNode | undefined;
  let stopped = false, ending: Promise<void> | undefined;
  let resolveStop: (() => void) | undefined, rejectStop: ((error: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    stopped = true;
    clearTimeout(timer);
    source?.disconnect(); node?.disconnect();
    if (node) node.port.onmessage = null;
    stream.getTracks().forEach(track => track.stop());
    void context.close().catch(() => {});
  };
  try {
    if (context.sampleRate !== 16000) throw new Error('Unsupported capture sample rate');
    await context.audioWorklet.addModule(new URL('speech-worklet.js', document.baseURI).href);
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'desktop-speech-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = event => {
      if (stopped) return;
      if (event.data?.type === 'samples' && event.data.samples instanceof Float32Array
        && event.data.samples.length <= 1600) onSamples(event.data.samples);
      if (event.data?.type === 'stopped') { dispose(); resolveStop?.(); }
    };
    node.onprocessorerror = () => {
      if (stopped) return;
      dispose(); rejectStop?.(new Error('Audio capture failed')); onError();
    };
    source.connect(node);
    // The worklet's output is silent; the destination keeps audio processing alive.
    node.connect(context.destination);
    await context.resume();
    return {
      stop() {
        if (ending) return ending;
        if (stopped) return Promise.resolve();
        ending = new Promise<void>((resolve, reject) => {
          resolveStop = resolve; rejectStop = reject;
          timer = setTimeout(() => { dispose(); reject(new Error('Audio capture did not stop')); }, 2000);
          node!.port.postMessage('stop');
        });
        return ending;
      },
      cancel() { dispose(); resolveStop?.(); },
    };
  } catch (error) { dispose(); throw error; }
}
