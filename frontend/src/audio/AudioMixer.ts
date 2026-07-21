import type { AudioSourceOptions } from '../@types';

/**
 * Captures and mixes the user's selected audio sources into a single
 * {@link MediaStream} suitable for streaming to an ASR service.
 *
 * Sources:
 *  - zero or more microphones, selected by `deviceId` (getUserMedia);
 *  - optionally computer/tab output audio (getDisplayMedia with audio). The
 *    browser prompts the user to pick a screen/tab and enable "share audio".
 *    Full system audio capture works on Chrome (Windows/ChromeOS); elsewhere it
 *    is typically limited to tab audio.
 *
 * All inputs are summed through a single Web Audio graph so the consumer sees
 * one mixed track regardless of how many sources are active.
 */
class AudioMixer {
  private context: AudioContext | null = null;
  private sourceStreams: MediaStream[] = [];
  private destination: MediaStreamAudioDestinationNode | null = null;

  /** List the available audio input devices (microphones). */
  static async listMicrophones(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  /**
   * Acquire and mix the configured sources. Returns the mixed MediaStream.
   * Throws if no source could be captured.
   */
  async start(options: AudioSourceOptions): Promise<MediaStream> {
    const context = new AudioContext();
    this.context = context;
    const destination = context.createMediaStreamDestination();
    this.destination = destination;

    let connected = 0;

    // Microphones. An empty list means "use the default microphone".
    const micIds = options.microphoneIds.length > 0 ? options.microphoneIds : [''];
    for (const deviceId of micIds) {
      try {
        const constraints: MediaStreamConstraints = {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.addStream(stream);
        connected++;
      } catch {
        // Skip a mic that fails (e.g. removed/denied) and continue with others.
      }
    }

    // Computer / tab output audio.
    if (options.systemAudio) {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        // We only want the audio; stop any video track immediately.
        display.getVideoTracks().forEach((t) => t.stop());
        if (display.getAudioTracks().length > 0) {
          this.addStream(new MediaStream(display.getAudioTracks()));
          connected++;
        }
      } catch {
        // User cancelled the picker or denied audio sharing.
      }
    }

    if (connected === 0) {
      await this.stop();
      throw new Error(
        'No audio source could be captured. Select at least one microphone or enable system audio.',
      );
    }

    return destination.stream;
  }

  private addStream(stream: MediaStream): void {
    if (!this.context || !this.destination) {
      return;
    }
    this.sourceStreams.push(stream);
    const node = this.context.createMediaStreamSource(stream);
    node.connect(this.destination);
  }

  /** Stop all capture and release devices. */
  async stop(): Promise<void> {
    for (const stream of this.sourceStreams) {
      stream.getTracks().forEach((t) => t.stop());
    }
    this.sourceStreams = [];
    this.destination = null;
    if (this.context) {
      const ctx = this.context;
      this.context = null;
      try {
        await ctx.close();
      } catch {
        // Already closed.
      }
    }
  }

  /** The underlying AudioContext, exposed so providers can build PCM worklets. */
  getContext(): AudioContext | null {
    return this.context;
  }
}

export default AudioMixer;
