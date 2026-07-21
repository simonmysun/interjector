import type {
  AudioSourceOptions,
  SpeechRecognitionProvider,
  SpeechRecognitionProviderEvent,
  RecognitionResult,
} from '../@types';
import AudioMixer from '../audio/AudioMixer';

type ResultHandler = (result: RecognitionResult) => void;
type VoidHandler = () => void;
type ErrorHandler = (message?: string) => void;

const PCM_WORKLET_URL = '/static/pcm-worklet.js';

/**
 * Streaming ASR provider for Deepgram (https://deepgram.com).
 *
 * - Mixes the user's selected audio sources (mics + optional system/tab audio)
 *   via {@link AudioMixer} and streams linear16 PCM over a WebSocket.
 * - Connects to this server's `/api/asr` proxy, which authenticates to Deepgram
 *   server-side. Recognition settings (model, language, diarization) and the
 *   API key all live on the server; the browser only chooses audio sources.
 * - Diarization speaker labels (角色识别) are surfaced via
 *   {@link RecognitionResult.speaker}.
 */
class DeepgramProvider implements SpeechRecognitionProvider {
  private audio: AudioSourceOptions;
  private mixer = new AudioMixer();
  private socket: WebSocket | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private resultListeners: ResultHandler[] = [];
  private errorListeners: ErrorHandler[] = [];
  private voidListeners: Record<
    Exclude<SpeechRecognitionProviderEvent, 'result' | 'error'>,
    VoidHandler[]
  > = {
    start: [],
    end: [],
    audiostart: [],
    audioend: [],
    soundstart: [],
    soundend: [],
    speechstart: [],
    speechend: [],
  };

  constructor(audio: AudioSourceOptions) {
    this.audio = audio;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.run().catch((error: unknown) => {
      this.emitError((error as Error)?.message ?? String(error));
      this.stop();
    });
  }

  private async run(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await this.mixer.start(this.audio);
    } catch (error) {
      throw new Error(`Audio capture failed: ${(error as Error).message}`);
    }
    const context = this.mixer.getContext();
    if (!context) {
      throw new Error('Audio context unavailable.');
    }
    this.emitVoid('audiostart');

    try {
      await context.audioWorklet.addModule(PCM_WORKLET_URL);
    } catch (error) {
      throw new Error(
        `Could not load audio worklet (${PCM_WORKLET_URL}): ${(error as Error).message}`,
      );
    }
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, 'pcm-processor');
    this.workletNode = worklet;
    source.connect(worklet);

    this.openSocket(context.sampleRate);

    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(event.data);
      }
    };
  }

  private openSocket(sampleRate: number): void {
    // Only the audio format is sent; the proxy fills in model/language/diarize
    // from the server environment and authenticates to Deepgram itself.
    const params = new URLSearchParams({
      encoding: 'linear16',
      sample_rate: String(Math.round(sampleRate)),
      channels: '1',
    });

    // Connect to our own backend proxy (same origin), not Deepgram directly.
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const proxyUrl = `${wsProtocol}//${window.location.host}/api/asr?${params.toString()}`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(proxyUrl);
    } catch (error) {
      this.emitError(`Could not open ASR WebSocket: ${(error as Error).message}`);
      this.stop();
      return;
    }
    this.socket = socket;
    let opened = false;

    socket.onopen = () => {
      opened = true;
      this.emitVoid('start');
      // Keep the connection alive during silence.
      this.keepAlive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 8000);
    };
    socket.onerror = () => {
      // The error event itself carries no detail in browsers; the close event
      // that follows has the code/reason, so report there.
    };
    socket.onclose = (event: CloseEvent) => {
      // A close before open almost always means auth/handshake failure.
      if (!opened) {
        this.emitError(this.describeClose(event));
      } else if (event.code !== 1000 && event.code !== 1005 && this.running) {
        this.emitError(this.describeClose(event));
      }
      void this.cleanup();
    };
    socket.onmessage = (event) => this.handleMessage(event.data as string);
  }

  /** Turn a WebSocket close event into a user-facing explanation. */
  private describeClose(event: CloseEvent): string {
    if (event.reason) {
      return `Deepgram connection closed: ${event.reason} (code ${event.code})`;
    }
    switch (event.code) {
      case 1006:
        return (
          'ASR proxy connection failed (code 1006). Check that the server is running ' +
          'and reachable, and that a Deepgram API key is configured (server ' +
          'DEEPGRAM_API_KEY, or your key in Settings).'
        );
      case 1008:
        return 'ASR rejected the connection — no/invalid Deepgram API key.';
      default:
        return `ASR connection closed unexpectedly (code ${event.code}).`;
    }
  }

  private handleMessage(raw: string): void {
    let data: DeepgramResult;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    // Deepgram may send an in-band error/warning frame.
    if (data.type === 'Error' || data.error) {
      this.emitError(`Deepgram error: ${data.error ?? data.description ?? data.message ?? 'unknown'}`);
      return;
    }
    if (data.type && data.type !== 'Results') {
      return;
    }
    const alternative = data.channel?.alternatives?.[0];
    const transcript = alternative?.transcript ?? '';
    if (!transcript) {
      return;
    }
    // Diarization (configured server-side): Deepgram tags each word with a
    // speaker index. Use the first word's speaker as the segment label, if any.
    const speaker = alternative?.words?.[0]?.speaker;
    this.emitResult({
      transcript,
      isFinal: Boolean(data.is_final),
      confidence: alternative?.confidence,
      speaker,
    });
  }

  stop(): void {
    this.running = false;
    if (this.socket?.readyState === WebSocket.OPEN) {
      // Tell Deepgram to flush and close gracefully.
      this.socket.send(JSON.stringify({ type: 'CloseStream' }));
    }
    this.socket?.close();
    void this.cleanup();
  }

  private cleaningUp = false;

  private async cleanup(): Promise<void> {
    if (this.cleaningUp) {
      return;
    }
    this.cleaningUp = true;
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.socket = null;
    await this.mixer.stop();
    this.emitVoid('audioend');
    this.emitVoid('end');
    this.cleaningUp = false;
  }

  on(event: 'result', handler: ResultHandler): void;
  on(event: 'error', handler: ErrorHandler): void;
  on(event: Exclude<SpeechRecognitionProviderEvent, 'result' | 'error'>, handler: VoidHandler): void;
  on(
    event: SpeechRecognitionProviderEvent,
    handler: ResultHandler | VoidHandler | ErrorHandler,
  ): void {
    if (event === 'result') {
      this.resultListeners.push(handler as ResultHandler);
    } else if (event === 'error') {
      this.errorListeners.push(handler as ErrorHandler);
    } else {
      this.voidListeners[event].push(handler as VoidHandler);
    }
  }

  private emitResult(result: RecognitionResult): void {
    for (const handler of this.resultListeners) {
      handler(result);
    }
  }

  private emitError(message?: string): void {
    for (const handler of this.errorListeners) {
      handler(message);
    }
  }

  private emitVoid(event: Exclude<SpeechRecognitionProviderEvent, 'result' | 'error'>): void {
    for (const handler of this.voidListeners[event]) {
      handler();
    }
  }
}

/** Minimal shape of the Deepgram streaming response we consume. */
interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  error?: string;
  message?: string;
  description?: string;
  channel?: {
    alternatives?: {
      transcript?: string;
      confidence?: number;
      words?: { speaker?: number }[];
    }[];
  };
}

export default DeepgramProvider;
