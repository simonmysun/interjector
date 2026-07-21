export type TranslationBackend =
  | 'free-google-translate'
  | 'google-translate'
  | 'bing-translate'
  | 'deepl-translate'
  | 'openai-translate';

/**
 * Audio source selection. Chosen in-page at runtime (device IDs and the
 * system-audio share prompt require user interaction, so they cannot come from
 * server config). Used by the Deepgram provider to capture and mix sources.
 */
export type AudioSourceOptions = {
  /** Microphone device IDs to capture and mix. Empty = default microphone. */
  microphoneIds: string[];
  /**
   * Capture computer/tab output audio via getDisplayMedia. The user is
   * prompted to pick a screen/tab and enable "share audio".
   */
  systemAudio: boolean;
};

/**
 * Non-secret configuration the browser fetches from the server (`/api/config`).
 * All keys/prompts/models live on the server and are never exposed here.
 */
export type PublicConfig = {
  speech: {
    provider: 'deepgram';
    diarize: boolean;
    language: string;
  };
  translation: {
    sourceLanguage: string;
    targetLanguage: string;
    backend: TranslationBackend;
  };
};

/** A single recognition result emitted by a SpeechRecognitionProvider. */
export interface RecognitionResult {
  transcript: string;
  isFinal: boolean;
  confidence?: number;
  /** Speaker label from diarization (角色识别), when available. */
  speaker?: number;
}

export type SpeechRecognitionProviderEvent =
  | 'result'
  | 'start'
  | 'end'
  | 'error'
  | 'audiostart'
  | 'audioend'
  | 'soundstart'
  | 'soundend'
  | 'speechstart'
  | 'speechend';

/**
 * Generic speech recognition provider interface. The Deepgram provider streams
 * mixed audio to the backend ASR proxy and implements this contract.
 */
export interface SpeechRecognitionProvider {
  start(): void;
  stop(): void;
  on(event: 'result', handler: (result: RecognitionResult) => void): void;
  on(event: 'error', handler: (message?: string) => void): void;
  on(
    event: Exclude<SpeechRecognitionProviderEvent, 'result' | 'error'>,
    handler: () => void,
  ): void;
}
