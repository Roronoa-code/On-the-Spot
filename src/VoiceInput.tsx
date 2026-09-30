import React, { useEffect, useRef, useState } from 'react';

function wav(chunks: Float32Array[]) {
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(44 + size * 2), view = new DataView(bytes.buffer);
  const str = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, size * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const value of chunk) { view.setInt16(offset, Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767), true); offset += 2; }
  return bytes;
}
type Props = { onTranscript: (text: string, onsetMs: number | null, processingMs: number) => void; disabled: boolean; prompt: string };
export function VoiceInput({ onTranscript, disabled, prompt }: Props) {
  const epoch = useRef(0), pending = useRef(false);
  const [recording, setRecording] = useState(false), [processing, setProcessing] = useState(false), [message, setMessage] = useState(''), [language, setLanguage] = useState('auto');
  const stream = useRef<MediaStream | null>(null), context = useRef<AudioContext | null>(null), processor = useRef<ScriptProcessorNode | null>(null), chunks = useRef<Float32Array[]>([]), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), onset = useRef<number | null>(null), rendered = useRef(performance.now()), active = useRef(true);
  const stop = () => { clearTimeout(timer.current); processor.current?.disconnect(); stream.current?.getTracks().forEach(t => t.stop()); void context.current?.close(); stream.current = null; context.current = null; setRecording(false); };
  useEffect(() => { active.current = true; rendered.current = performance.now(); return () => { active.current = false; epoch.current++; stop(); chunks.current = []; void window.onTheSpot?.command('voice:cancel'); speechSynthesis.cancel(); }; }, [prompt]);
  const record = async () => {
    if (pending.current) return;
    pending.current = true;
    const attempt = ++epoch.current;
    try {
      const permission = await window.onTheSpot?.command('voice:consent');
      if (!active.current || epoch.current !== attempt) return;
      if (!permission?.voice?.consent) { setMessage('Microphone permission declined. You can type instead.'); return; }
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true }, video: false });
      if (!active.current || epoch.current !== attempt) { stream.current.getTracks().forEach(t => t.stop()); stream.current = null; return; }
      context.current = new AudioContext({ sampleRate: 16000 });
      if (context.current.sampleRate !== 16000) throw new Error('Unsupported audio format');
      chunks.current = []; onset.current = null;
      processor.current = context.current.createScriptProcessor(4096, 1, 1);
      processor.current.onaudioprocess = event => {
        const samples = event.inputBuffer.getChannelData(0);
        chunks.current.push(new Float32Array(samples));
        const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
        if (onset.current === null && rms > 0.015) onset.current = Math.round(performance.now() - rendered.current);
      };
      context.current.createMediaStreamSource(stream.current).connect(processor.current);
      processor.current.connect(context.current.destination);
      setRecording(true); setMessage('Recording locally. Stop when you are finished.'); timer.current = setTimeout(() => void transcribe(), 59000);
    } catch { stop(); setMessage('Microphone unavailable or permission denied. Typing still works.'); }
    finally { pending.current = false; }
  };
  const transcribe = async () => {
    stop(); setProcessing(true); setMessage('Transcribing on this PC…');
    const started = performance.now();
    const attempt = epoch.current;
    try {
      const result = await window.onTheSpot?.command('voice:transcribe', { wav: wav(chunks.current), language });
      if (!active.current || attempt !== epoch.current) return;
      if (!result?.voice?.transcript) throw new Error('No transcript');
      onTranscript(result.voice.transcript.text, onset.current, Math.round(performance.now() - started)); setMessage('Check and correct the transcript in Your answer before submitting. Recording discarded.');
    } catch { if (active.current && attempt === epoch.current) setMessage('No usable speech was transcribed. Check the microphone, try again, or type your answer.'); }
    finally { if (attempt === epoch.current) { chunks.current = []; setProcessing(false); } }
  };
  const speak = () => {
    const voices = speechSynthesis.getVoices().filter(v => v.localService);
    const voice = voices.find(v => language === 'auto' || v.lang.startsWith(language));
    if (!voice) { setMessage('No matching offline voice is installed in Windows. You can read the prompt instead.'); return; }
    speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(prompt); utterance.voice = voice; speechSynthesis.speak(utterance);
  };
  return <div className="voice-input"><div className="connection-actions"><button className="secondary" type="button" disabled={disabled || processing} onClick={() => recording ? void transcribe() : void record()}>{recording ? 'Stop and transcribe' : 'Speak answer'}</button><button className="text-button" type="button" disabled={recording || processing} onClick={speak}>Read prompt aloud</button>{(recording || processing) && <button className="text-button" type="button" onClick={() => { epoch.current++; stop(); chunks.current = []; void window.onTheSpot?.command('voice:cancel'); setProcessing(false); setMessage('Voice input cancelled.'); }}>Cancel voice</button>}</div><details className="voice-options"><summary>Speech settings</summary><label className="field">Speech language<select value={language} disabled={recording || processing} onChange={e => setLanguage(e.target.value)}>{[['auto', 'Detect language'], ['en','English'], ['es','Spanish'], ['fr','French'], ['de','German'], ['ar','Arabic'], ['hi','Hindi'], ['ur','Urdu'], ['it','Italian'], ['pt','Portuguese']].map(([id,name]) => <option value={id} key={id}>{name}</option>)}</select></label><p className="privacy">Recognised on this PC. Review the text before checking your answer.</p></details>{message && <p className="privacy" role="status">{message}</p>}</div>;
}
