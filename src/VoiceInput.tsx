import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import './voice.css';

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 59;
const ANSWER_LIMIT = 4000;
const languages = [['auto', 'Detect language'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ur', 'Urdu'], ['it', 'Italian'], ['pt', 'Portuguese']];

function wav(chunks: Float32Array[]) {
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(44 + size * 2), view = new DataView(bytes.buffer);
  const str = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, size * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const value of chunk) { view.setInt16(offset, Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767), true); offset += 2; }
  return bytes;
}

type Phase = 'idle' | 'requesting' | 'recording' | 'processing';
type Transcript = { text: string; onsetMs: number | null; processingMs: number };
type Capture = {
  stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode;
  chunks: Float32Array[]; samples: number; onsetMs: number | null; lastLevelAt: number;
  answerAtStart: string | undefined; language: string; onEnded: () => void;
};
type Props = {
  onTranscript: (text: string, onsetMs: number | null, processingMs: number) => void;
  disabled: boolean; prompt: string; active?: boolean; answer?: string; onBusyChange?: (busy: boolean) => void;
};

function releaseCapture(capture: Capture | null) {
  if (!capture) return;
  capture.processor.onaudioprocess = null;
  try { capture.processor.disconnect(); capture.source.disconnect(); } catch { /* Already disconnected. */ }
  for (const track of capture.stream.getTracks()) { track.removeEventListener('ended', capture.onEnded); track.stop(); }
  if (capture.context.state !== 'closed') void capture.context.close().catch(() => {});
}

function VoiceIcon({ kind }: { kind: 'mic' | 'stop' | 'speaker' | 'settings' | 'close' }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'mic' && <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 10v1a6 6 0 0 0 12 0v-1M12 17v4M9 21h6"/></>}
    {kind === 'stop' && <rect x="6" y="6" width="12" height="12" rx="2"/>}
    {kind === 'speaker' && <><path d="m11 4-6 5H2v6h3l6 5V4ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/></>}
    {kind === 'settings' && <><path d="M4 7h4m4 0h8M4 17h8m4 0h4"/><circle cx="10" cy="7" r="2"/><circle cx="14" cy="17" r="2"/></>}
    {kind === 'close' && <path d="m7 7 10 10M17 7 7 17"/>}
  </svg>;
}

export function VoiceInput({ onTranscript, disabled, prompt, active = true, answer, onBusyChange }: Props) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [language, setLanguage] = useState('auto');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [savedTranscript, setSavedTranscript] = useState<Transcript | null>(null);
  const mounted = useRef(true), epoch = useRef(0), phaseRef = useRef<Phase>('idle');
  const captureRef = useRef<Capture | null>(null), utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), clock = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const transcription = useRef<Promise<unknown> | null>(null), backendSettled = useRef<Promise<unknown>>(Promise.resolve());
  const rendered = useRef(performance.now()), speechEpoch = useRef(0), focusFrame = useRef(0);
  const container = useRef<HTMLDivElement>(null), recordButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({ active, answer, disabled, onTranscript, onBusyChange });
  latest.current = { active, answer, disabled, onTranscript, onBusyChange };

  const updatePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (mounted.current) { setPhase(next); latest.current.onBusyChange?.(next !== 'idle'); }
  }, []);

  const stopCapture = useCallback(() => {
    clearTimeout(timer.current); clearInterval(clock.current);
    timer.current = undefined; clock.current = undefined;
    const capture = captureRef.current;
    captureRef.current = null;
    releaseCapture(capture);
    return capture;
  }, []);

  const stopReading = useCallback(() => {
    speechEpoch.current++;
    if (utteranceRef.current) {
      utteranceRef.current.onend = null; utteranceRef.current.onerror = null;
      utteranceRef.current = null;
      window.speechSynthesis?.cancel();
    }
    if (mounted.current) setSpeaking(false);
  }, []);

  const cancelVoice = useCallback((notice = '', discardTranscript = false) => {
    epoch.current++;
    const capture = stopCapture();
    if (capture) capture.chunks = [];
    stopReading();
    // Wait for the cancelled process to settle before accepting another recording.
    if (transcription.current && window.onTheSpot) {
      backendSettled.current = Promise.allSettled([window.onTheSpot.command('voice:cancel'), transcription.current]);
    }
    updatePhase('idle');
    if (mounted.current) {
      setMessage(notice); setLevel(0); setElapsed(0);
      if (discardTranscript) setSavedTranscript(null);
    }
  }, [stopCapture, stopReading, updatePhase]);

  const isCurrent = (attempt: number) => mounted.current && latest.current.active && epoch.current === attempt && !container.current?.closest('[hidden]');
  const restoreFocus = () => {
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      if (mounted.current && latest.current.active) recordButton.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    mounted.current = true;
    // Warm up the installed-voice list; speaking still requires an explicit press.
    window.speechSynthesis?.getVoices();
    const onHidden = () => {
      if (document.hidden && (phaseRef.current !== 'idle' || utteranceRef.current)) cancelVoice('Voice stopped when the window was hidden.');
    };
    const onPageHide = () => cancelVoice();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      mounted.current = false;
      cancelVoice();
      latest.current.onBusyChange?.(false);
      cancelAnimationFrame(focusFrame.current);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [cancelVoice]);

  const previous = useRef({ active, prompt });
  useEffect(() => {
    const changedPrompt = previous.current.prompt !== prompt;
    previous.current = { active, prompt };
    if (changedPrompt) { rendered.current = performance.now(); cancelVoice('', true); }
    else if (!active) cancelVoice();
  }, [active, prompt, cancelVoice]);

  const transcribe = async (attempt: number) => {
    // The timeout and a click can arrive together. Only one may consume the audio.
    if (!isCurrent(attempt) || phaseRef.current !== 'recording') return;
    updatePhase('processing'); setMessage('');
    const capture = stopCapture();
    if (!capture || !capture.samples) {
      updatePhase('idle'); setMessage('No audio was captured. Check the microphone and try again.'); return;
    }
    const started = performance.now();
    const bytes = wav(capture.chunks);
    capture.chunks = [];
    let request: Promise<unknown> | null = null;
    try {
      if (!window.onTheSpot) throw new Error('desktop_required');
      const resultPromise = window.onTheSpot.command('voice:transcribe', { wav: bytes, language: capture.language });
      request = resultPromise; transcription.current = resultPromise;
      const result = await resultPromise;
      if (!isCurrent(attempt)) return;
      const text = result?.voice?.transcript?.text?.trim();
      if (!text) throw new Error('transcript_empty');
      const ready = { text, onsetMs: capture.onsetMs, processingMs: Math.round(performance.now() - started) };
      updatePhase('idle');
      if (latest.current.disabled || latest.current.answer !== capture.answerAtStart || latest.current.answer?.trim()) {
        setSavedTranscript(ready);
        setMessage('');
      } else {
        latest.current.onTranscript(text, ready.onsetMs, ready.processingMs);
        setMessage('Speech added. Check the text before checking your answer.');
      }
    } catch (error) {
      if (isCurrent(attempt)) {
        const reason = String(error);
        setMessage(reason.includes('voice_runtime_missing') ? 'Offline speech is not installed in this build. Use the full desktop app, or type your answer.'
          : reason.includes('recording_silent') ? 'No speech was heard. Check your microphone and try again.'
          : reason.includes('transcription_timeout') ? 'Transcription took too long. Try a shorter recording, or type your answer.'
          : 'No usable speech was transcribed. Try again, or type your answer.');
      }
    } finally {
      if (transcription.current === request) transcription.current = null;
      if (isCurrent(attempt)) { updatePhase('idle'); setLevel(0); }
    }
  };

  const record = async () => {
    if (phaseRef.current !== 'idle' || latest.current.disabled || !latest.current.active) return;
    if (!window.onTheSpot) { setMessage('Open the desktop app to use offline speech input.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setMessage('The microphone is unavailable here. You can type your answer.'); return; }
    const attempt = ++epoch.current, answerAtStart = latest.current.answer;
    stopReading(); setSavedTranscript(null); setMessage(''); setElapsed(0); setLevel(0);
    updatePhase('requesting');
    let incoming: MediaStream | null = null;
    let openingContext: AudioContext | null = null;
    try {
      await backendSettled.current;
      if (!isCurrent(attempt)) return;
      const permission = await window.onTheSpot.command('voice:consent');
      if (!isCurrent(attempt)) return;
      if (!permission?.voice?.consent) { setMessage('Microphone permission was declined. You can still type your answer.'); return; }
      if (permission.voice.available === false) { setMessage('Offline speech is not installed in this build. Use the full desktop app, or type your answer.'); return; }
      incoming = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: SAMPLE_RATE, echoCancellation: true }, video: false });
      // A late permission result owns only its own stream, never a newer capture.
      if (!isCurrent(attempt)) { incoming.getTracks().forEach(track => track.stop()); return; }
      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      openingContext = context;
      if (context.sampleRate !== SAMPLE_RATE) { void context.close().catch(() => {}); throw new Error('unsupported_audio_format'); }
      const source = context.createMediaStreamSource(incoming), processor = context.createScriptProcessor(4096, 1, 1);
      const capture: Capture = { stream: incoming, context, source, processor, chunks: [], samples: 0, onsetMs: null, lastLevelAt: 0, answerAtStart, language,
        onEnded: () => { if (isCurrent(attempt)) cancelVoice('Microphone disconnected. Try again, or type your answer.'); } };
      captureRef.current = capture;
      incoming.getTracks().forEach(track => track.addEventListener('ended', capture.onEnded));
      if (context.state === 'suspended') await context.resume();
      if (!isCurrent(attempt)) { releaseCapture(capture); return; }
      processor.onaudioprocess = event => {
        if (!isCurrent(attempt) || phaseRef.current !== 'recording') return;
        const samples = event.inputBuffer.getChannelData(0), remaining = SAMPLE_RATE * MAX_SECONDS - capture.samples;
        const chunk = new Float32Array(samples.subarray(0, remaining));
        capture.chunks.push(chunk); capture.samples += chunk.length;
        // Keep the processor alive without playing the microphone back to speakers.
        event.outputBuffer.getChannelData(0).fill(0);
        const rms = Math.sqrt(chunk.reduce((sum, x) => sum + x * x, 0) / (chunk.length || 1));
        const now = performance.now();
        if (capture.onsetMs === null && rms > 0.015) capture.onsetMs = Math.round(now - rendered.current);
        if (now - capture.lastLevelAt > 100) { capture.lastLevelAt = now; setLevel(Math.min(1, rms * 6)); }
        // The sample cap also works if the operating system delays the wall timer.
        if (capture.samples >= SAMPLE_RATE * MAX_SECONDS) void transcribe(attempt);
      };
      updatePhase('recording');
      source.connect(processor); processor.connect(context.destination);
      const started = performance.now();
      clock.current = setInterval(() => { if (isCurrent(attempt)) setElapsed(Math.min(MAX_SECONDS, Math.floor((performance.now() - started) / 1000))); }, 250);
      timer.current = setTimeout(() => void transcribe(attempt), MAX_SECONDS * 1000);
    } catch (error) {
      incoming?.getTracks().forEach(track => track.stop());
      if (openingContext && openingContext.state !== 'closed') void openingContext.close().catch(() => {});
      if (isCurrent(attempt)) {
        stopCapture(); updatePhase('idle');
        const reason = String(error);
        setMessage(reason.includes('NotAllowed') ? 'Microphone permission was not granted. You can still type your answer.'
          : reason.includes('NotFound') ? 'No microphone was found. Connect one and try again.'
          : reason.includes('unsupported_audio_format') ? 'This microphone cannot use the offline speech format. You can type your answer.'
          : 'The microphone could not start. Check it is connected and available, then try again.');
      }
    } finally {
      if (isCurrent(attempt) && (phaseRef.current as Phase) === 'requesting') updatePhase('idle');
    }
  };

  const readPrompt = () => {
    if (utteranceRef.current) { stopReading(); return; }
    if (!active || phaseRef.current !== 'idle') return;
    const synthesis = window.speechSynthesis;
    if (!synthesis) { setMessage('Offline read-aloud is unavailable on this device.'); return; }
    const voices = synthesis.getVoices().filter(voice => voice.localService);
    const preferred = language === 'auto' ? document.documentElement.lang || 'en' : language;
    const voice = voices.find(item => item.lang.toLowerCase().startsWith(preferred.toLowerCase()))
      ?? (language === 'auto' ? voices.find(item => item.default) ?? voices[0] : undefined);
    if (!voice) { setMessage('No matching offline voice is available. Choose another speech language or install a Windows voice.'); return; }
    const attempt = ++speechEpoch.current, utterance = new SpeechSynthesisUtterance(prompt);
    utterance.voice = voice; utterance.lang = voice.lang;
    utterance.onend = () => { if (mounted.current && attempt === speechEpoch.current) { utteranceRef.current = null; setSpeaking(false); } };
    utterance.onerror = () => { if (mounted.current && attempt === speechEpoch.current) { utteranceRef.current = null; setSpeaking(false); setMessage('The prompt could not be read aloud. Try again or read it above.'); } };
    utteranceRef.current = utterance; setSpeaking(true); setMessage('');
    synthesis.cancel(); synthesis.speak(utterance);
  };

  const useTranscript = (append: boolean) => {
    if (!savedTranscript || disabled || !active) return;
    const existing = answer?.trim() ?? '';
    const text = append && existing ? `${existing}\n${savedTranscript.text}` : savedTranscript.text;
    if (text.length > ANSWER_LIMIT) { setMessage('That would exceed the 4,000-character answer limit. Shorten your answer first, or replace it with the transcript.'); return; }
    onTranscript(text, savedTranscript.onsetMs, savedTranscript.processingMs);
    setSavedTranscript(null); setMessage('Speech added. Check the text before checking your answer.');
  };

  const working = phase !== 'idle';
  const status = phase === 'requesting' ? 'Opening microphone…' : phase === 'processing' ? 'Transcribing on this PC…' : phase === 'recording' ? 'Recording locally' : message;
  return <div ref={container} className="voice-input" data-phase={phase}>
    <div className="voice-toolbar">
      <button ref={recordButton} className="voice-control voice-record" type="button" disabled={!active || phase === 'requesting' || phase === 'processing' || (disabled && phase !== 'recording')} onClick={() => phaseRef.current === 'recording' ? void transcribe(epoch.current) : void record()}>
        <VoiceIcon kind={phase === 'recording' ? 'stop' : 'mic'}/><span>{phase === 'recording' ? 'Stop and transcribe' : savedTranscript ? 'Record again' : 'Speak answer'}</span>
      </button>
      <button className="voice-control voice-read" type="button" disabled={!active || working} aria-pressed={speaking} onClick={readPrompt}>
        <VoiceIcon kind={speaking ? 'stop' : 'speaker'}/><span>{speaking ? 'Stop reading' : 'Read prompt aloud'}</span>
      </button>
      <button className="voice-control voice-settings-toggle" type="button" aria-expanded={settingsOpen} aria-controls={`${id}-settings`} onClick={() => setSettingsOpen(open => !open)}>
        <VoiceIcon kind="settings"/><span>Speech settings</span><span className="voice-chevron" aria-hidden="true"/>
      </button>
    </div>
    <div className="voice-fold voice-status-fold" data-open={!!status}>
      <div className="voice-fold-inner">
        <div className="voice-status">
          <div className="voice-status-copy" role="status" aria-live="polite">
            {working && <span className="voice-status-dot" aria-hidden="true"/>}<span>{status}</span>
          </div>
          {phase === 'recording' && <div className="voice-capture" aria-label="Microphone is recording. Recording stops after 59 seconds.">
            <span className="voice-level" title="Microphone input level" aria-hidden="true"><span style={{ transform: `scaleX(${level})` }}/></span>
            <span className="voice-time" aria-hidden="true">0:{String(elapsed).padStart(2, '0')}<span> / 0:59</span></span>
          </div>}
          {working && <button className="voice-control voice-cancel" type="button" onClick={() => { cancelVoice('Voice input cancelled.'); restoreFocus(); }}><VoiceIcon kind="close"/><span>Cancel</span></button>}
        </div>
      </div>
    </div>
    {savedTranscript && <section className="voice-transcript" aria-label="Your speech transcript">
      <span className="voice-transcript-heading">Speech ready</span>
      <p className="voice-transcript-note">Your typed answer is kept. Choose how to use this transcript.</p>
      <blockquote>{savedTranscript.text}</blockquote>
      <div className="voice-transcript-actions">
        <button className="voice-control voice-apply" type="button" disabled={disabled || !active} onClick={() => useTranscript(true)}>{answer?.trim() ? 'Add to answer' : 'Use transcript'}</button>
        {!!answer?.trim() && <button className="voice-control" type="button" disabled={disabled || !active} onClick={() => useTranscript(false)}>Replace answer</button>}
        <button className="voice-control" type="button" onClick={() => { setSavedTranscript(null); setMessage('Transcript discarded.'); restoreFocus(); }}>Discard</button>
      </div>
    </section>}
    <div id={`${id}-settings`} className="voice-fold voice-settings-fold" data-open={settingsOpen} inert={!settingsOpen} aria-hidden={!settingsOpen}>
      <div className="voice-fold-inner">
        <div className="voice-settings-content">
          <label className="voice-language" htmlFor={`${id}-language`}>Speech language
            <select id={`${id}-language`} value={language} disabled={working || speaking} onChange={event => setLanguage(event.target.value)}>{languages.map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select>
          </label>
          <p>Speech is recognised on this PC. Record up to 59 seconds, then check the text. Audio is discarded after transcription. Read-aloud uses an installed offline voice.</p>
        </div>
      </div>
    </div>
  </div>;
}
