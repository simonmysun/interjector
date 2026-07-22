import type { AudioSourceOptions, PublicConfig, RecognitionResult } from './@types';
import { fetchConfig } from './config';
import DeepgramProvider from './speech/DeepgramProvider';
import AudioMixer from './audio/AudioMixer';
import ResultManager from './ResultManager';
import ConsolePanel from './ConsolePanel';
import CompletionPanel from './CompletionPanel';
import { translate } from './translation';
import { runCompletion } from './completion';

/** Debounce window (ms) for translating in-progress (interim) transcripts. */
const INTERIM_TRANSLATE_DEBOUNCE_MS = 400;

class Interjector {
  private config: PublicConfig;
  private resultManager = new ResultManager();
  private consolePanel = new ConsolePanel();
  private speech: DeepgramProvider | null = null;
  private interimTranslateTimer: ReturnType<typeof setTimeout> | null = null;
  private interimTranslateController: AbortController | null = null;

  // Per-preset completion panels and their in-flight abort controllers.
  private completionsContainerDom = document.getElementById('completions') as HTMLDivElement;
  private completionControllers = new Map<string, AbortController>();

  // Audio source UI elements.
  private micListDom = document.getElementById('mic-list') as HTMLSpanElement;
  private refreshDevicesDom = document.getElementById('refresh-devices') as HTMLButtonElement;
  private systemAudioDom = document.getElementById('system-audio') as HTMLInputElement;
  private configSummaryDom = document.getElementById('config-summary') as HTMLSpanElement;

  constructor(config: PublicConfig) {
    this.config = config;
    this.showConfigSummary();
    this.wireConsole();
    this.wireAudioControls();
    this.buildCompletionPanels();
  }

  /**
   * Create one completion panel per prompt preset. Each panel has its own
   * button that triggers a completion for that preset over the current
   * transcript, appending the result to its scrollable history. Falls back to a
   * single unnamed panel (using the server's default COMPLETION_PROMPT) when no
   * presets are configured.
   */
  private buildCompletionPanels(): void {
    const presets = this.config.completion.presets;
    const list = presets.length > 0 ? presets : [{ id: '', label: 'Completion' }];
    this.completionsContainerDom.replaceChildren();
    for (const preset of list) {
      const panel = new CompletionPanel(preset);
      panel.onComplete(() => this.runPanelCompletion(panel));
      panel.onAbort(() => this.completionControllers.get(panel.preset.id)?.abort());
      this.completionsContainerDom.appendChild(panel.element);
    }
  }

  private runPanelCompletion(panel: CompletionPanel): void {
    if (panel.isRunning) {
      return;
    }
    // An empty transcript is allowed: some presets are useful with prompt-only
    // input (the model just runs on the system prompt).
    const transcript = this.resultManager.getTranscript();
    this.consolePanel.clearStatus();
    panel.begin();

    const controller = runCompletion(
      transcript,
      {
        onToken: (token) => panel.appendToken(token),
        onError: (error) => panel.appendError(String((error as Error)?.message ?? error)),
        onDone: () => {
          panel.finish();
          this.completionControllers.delete(panel.preset.id);
        },
      },
      panel.preset.id || undefined,
    );
    this.completionControllers.set(panel.preset.id, controller);
  }

  private showConfigSummary(): void {
    const t = this.config.translation;
    const parts = [
      `ASR: ${this.config.speech.language}${this.config.speech.diarize ? ' +diarize' : ''}`,
      `translate: ${t.sourceLanguage || '?'}→${t.targetLanguage || '?'} (${t.backend})`,
    ];
    this.configSummaryDom.textContent = parts.join('  ·  ');
  }

  private wireAudioControls(): void {
    this.refreshDevicesDom.addEventListener('click', () => void this.refreshMicrophones());
  }

  /** List microphones as checkboxes (requires permission to reveal labels). */
  private async refreshMicrophones(): Promise<void> {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
      const mics = await AudioMixer.listMicrophones();
      if (mics.length === 0) {
        this.micListDom.textContent = 'No microphones found.';
        return;
      }
      this.micListDom.replaceChildren();
      mics.forEach((mic, index) => {
        const label = document.createElement('label');
        label.className = 'mic-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = mic.deviceId;
        checkbox.checked = index === 0; // default to the first mic
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + (mic.label || `Microphone ${index + 1}`)));
        this.micListDom.appendChild(label);
      });
    } catch {
      this.micListDom.textContent = 'Could not access microphones (permission denied or unsupported).';
    }
  }

  /** Read the current audio source selection from the in-page controls. */
  private collectAudioOptions(): AudioSourceOptions {
    const boxes = this.micListDom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const microphoneIds: string[] = [];
    boxes.forEach((box) => {
      if (box.checked) {
        microphoneIds.push(box.value);
      }
    });
    return { microphoneIds, systemAudio: this.systemAudioDom.checked };
  }

  private wireConsole(): void {
    this.consolePanel.on('start', () => this.startRecognition());
    this.consolePanel.on('stop', () => this.speech?.stop());
    this.consolePanel.on('clear', () => this.resultManager.clearTranscript());
  }

  private startRecognition(): void {
    this.consolePanel.clearStatus();
    const speech = new DeepgramProvider(this.collectAudioOptions());
    this.speech = speech;

    speech.on('start', () => this.consolePanel.start());
    speech.on('end', () => {
      this.cancelInterimTranslation();
      this.consolePanel.reset();
      this.speech = null;
    });
    speech.on('error', (message?: string) =>
      this.consolePanel.setStatus(
        message ? `Speech recognition error: ${message}` : 'Speech recognition error',
        true,
      ),
    );
    speech.on('audiostart', () => this.consolePanel.activeAudioIndicator());
    speech.on('audioend', () => this.consolePanel.deactiveAudioIndicator());
    speech.on('soundstart', () => this.consolePanel.activeSoundIndicator());
    speech.on('soundend', () => this.consolePanel.deactiveSoundIndicator());
    speech.on('speechstart', () => this.consolePanel.activeSpeechIndicator());
    speech.on('speechend', () => this.consolePanel.deactiveSpeechIndicator());
    speech.on('result', (result: RecognitionResult) => this.handleResult(result));

    speech.start();
  }

  /**
   * Handle a single recognition result. State is derived from the DOM
   * (DOM-as-state): the interim region is the only mirror of the in-progress
   * transcript, so we compare against it directly.
   */
  private handleResult(result: RecognitionResult): void {
    if (result.isFinal) {
      this.cancelInterimTranslation();
      this.resultManager.addFinalTranscript(result.transcript, result.speaker);
      this.resultManager.setOnGoingTranscript('');
      this.translateInto(result.transcript, (text) => this.resultManager.addTranslatedTranscript(text));
      return;
    }

    const previous = this.resultManager.getOnGoingTranscript();
    this.resultManager.setOnGoingTranscript(result.transcript);
    if (result.transcript && result.transcript !== previous) {
      this.scheduleInterimTranslation(result.transcript);
    }
  }

  /**
   * Interim results arrive many times per second; debounce them and keep only
   * one in-flight request so we don't flood the translation backend or apply
   * stale, out-of-order responses.
   */
  private scheduleInterimTranslation(text: string): void {
    if (this.interimTranslateTimer) {
      clearTimeout(this.interimTranslateTimer);
    }
    this.interimTranslateTimer = setTimeout(() => {
      this.interimTranslateTimer = null;
      this.interimTranslateController?.abort();
      const controller = new AbortController();
      this.interimTranslateController = controller;
      this.translateInto(
        text,
        (translated) => this.resultManager.setOnGoingTranscriptTranslation(translated),
        controller.signal,
      );
    }, INTERIM_TRANSLATE_DEBOUNCE_MS);
  }

  private cancelInterimTranslation(): void {
    if (this.interimTranslateTimer) {
      clearTimeout(this.interimTranslateTimer);
      this.interimTranslateTimer = null;
    }
    this.interimTranslateController?.abort();
    this.interimTranslateController = null;
  }

  private translateInto(
    text: string,
    apply: (translated: string) => void,
    signal?: AbortSignal,
  ): void {
    translate(text, signal)
      .then(apply)
      .catch((error) => {
        if ((error as Error)?.name === 'AbortError') {
          return;
        }
        this.consolePanel.setStatus(String((error as Error).message ?? error), true);
      });
  }

}

fetchConfig()
  .then((config) => new Interjector(config))
  .catch((error) => {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = `Failed to load server config: ${(error as Error).message}`;
      status.classList.add('error');
    }
  });
