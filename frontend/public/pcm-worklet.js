// AudioWorklet processor that converts the mixed audio graph into 16-bit PCM
// (linear16) chunks and posts them to the main thread. Streaming ASR services
// such as Deepgram accept raw linear16 over the WebSocket.
//
// Served as a static asset (loaded via audioWorklet.addModule). Kept dependency
// free and in plain JS because it runs in the AudioWorklet global scope.
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    if (!channel || channel.length === 0) {
      return true;
    }
    // Convert Float32 [-1, 1] samples to little-endian Int16 PCM.
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
