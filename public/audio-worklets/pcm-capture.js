// PCM-capture AudioWorklet — emits raw 24kHz mono Float32 frames from mic input.
// Loaded by src/hooks/useMrImagineLive.ts via addModule().
// Served as a static file (not a blob URL) so CSP can accept it.

class PCMCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length > 0) {
      this.port.postMessage(ch.slice());
    }
    return true;
  }
}

registerProcessor("pcm-capture", PCMCaptureProcessor);
