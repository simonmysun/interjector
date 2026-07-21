import * as http from 'http';

export type ServerOptions = {
  port: number;
  host: string;
  key: string | Buffer;
  cert: string | Buffer;
  httpOnly: boolean;
}

export interface RouteHandler {
  (req: http.IncomingMessage, res: http.ServerResponse, ...pathSegments: string[]): void | Promise<void>;
}

export interface Routes {
  [key: string]: RouteHandler | Routes;
}

export interface Mimes {
  [key: string]: string
}

export type TranslationBackend =
  | 'free-google-translate'
  | 'google-translate'
  | 'bing-translate'
  | 'deepl-translate'
  | 'openai-translate';

export interface TranslationResult {
  text: string;
}

export interface TranslationOptions {
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  backend: TranslationBackend,
  apiUrl?: string,
  apiKey?: string,
  model?: string,
  prompt?: string
}

/**
 * A backend translation provider. Receives the (already validated) request
 * options. `apiKey` is resolved by the caller: it is either the user-supplied
 * key forwarded from the frontend, or the server's fallback key when the user
 * did not provide one.
 */
export interface TranslationProvider {
  translate(options: TranslationOptions): Promise<TranslationResult>;
}

export type CompletionStyle = 'openai' | 'gemini';

export interface CompletionOptions {
  text: string;
  prompt: string;
  model: string;
  apiUrl: string;
  apiKey?: string;
}

/**
 * A backend completion provider that streams tokens. `onToken` is called for
 * every decoded text chunk; the returned promise resolves when the stream ends.
 */
export interface CompletionProvider {
  complete(
    options: CompletionOptions,
    onToken: (token: string) => void,
    signal?: AbortSignal
  ): Promise<void>;
}

export interface ChatCompletion {
  choices: {
    content_filter_results: {
      hate: {
        filtered: boolean;
        severity: string;
      };
      self_harm: {
        filtered: boolean;
        severity: string;
      };
      sexual: {
        filtered: boolean;
        severity: string;
      };
      violence: {
        filtered: boolean;
        severity: string;
      };
    };
    finish_reason: string;
    index: number;
    logprobs: null;
    message: {
      content: string;
      role: string;
    };
  }[];
  created: number;
  id: string;
  model: string;
  object: string;
  prompt_filter_results: {
    prompt_index: number;
    content_filter_results: {
      hate: {
        filtered: boolean;
        severity: string;
      };
      self_harm: {
        filtered: boolean;
        severity: string;
      };
      sexual: {
        filtered: boolean;
        severity: string;
      };
      violence: {
        filtered: boolean;
        severity: string;
      };
    };
  }[];
  system_fingerprint: string;
  usage: {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  };
}