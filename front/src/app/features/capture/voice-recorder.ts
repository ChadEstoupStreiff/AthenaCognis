import type { IMediaRecorder } from 'extendable-media-recorder';

let encoderRegistered: Promise<void> | null = null;

/**
 * Register the WAV encoder once (WAV keeps parity with the Streamlit recorder and Whisper).
 *
 * @returns Resolves when registered.
 */
async function ensureWavEncoder(): Promise<void> {
  encoderRegistered ??= (async (): Promise<void> => {
    const [{ register }, { connect }] = await Promise.all([
      import('extendable-media-recorder'),
      import('extendable-media-recorder-wav-encoder'),
    ]);
    await register(await connect());
  })();
  return encoderRegistered;
}

/** A running WAV recording. */
export interface Recording {
  /** Stop and get the audio. */
  stop(): Promise<Blob>;
  /** Abort without keeping audio. */
  cancel(): void;
}

/**
 * Check whether the browser can record audio here (needs a secure context).
 *
 * @returns `null` when recording works, else the reason.
 */
export function recordingUnavailableReason(): string | null {
  if (!window.isSecureContext) {
    return 'Microphone access needs HTTPS (or localhost). Open AthenaCognis through an HTTPS address to record.';
  }
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  return typeof devices?.getUserMedia === 'function' ? null : 'This browser cannot record audio.';
}

/**
 * Start recording the microphone as WAV.
 *
 * @returns The recording handle.
 */
export async function startRecording(): Promise<Recording> {
  await ensureWavEncoder();
  const { MediaRecorder } = await import('extendable-media-recorder');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder: IMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/wav' });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    chunks.push(event.data);
  });
  const release = (): void => {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  };
  recorder.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.addEventListener('stop', () => {
          release();
          resolve(new Blob(chunks, { type: 'audio/wav' }));
        });
        recorder.stop();
      }),
    cancel: () => {
      recorder.stop();
      release();
    },
  };
}
