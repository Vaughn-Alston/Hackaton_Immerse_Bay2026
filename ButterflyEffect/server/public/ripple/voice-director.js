import { castVoice } from "./voice-casting.js";

// One AudioContext, one source, one promise queue: character speech can never overlap.
export class VoiceDirector {
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.casting = {};
    this.queue = Promise.resolve();
    this.buffers = new Map();
    this.current = null;
  }

  configure(manifest) { this.casting = manifest?.voiceCasting ?? {}; }

  unlock() {
    this.context ??= new (window.AudioContext || window.webkitAudioContext)();
    this.context.resume().catch(() => {});
  }

  assign(character) {
    if (!character) return null;
    const voice = castVoice(character, this.casting);
    if (voice && !character.voice) character.voice = voice;
    return character.voice ?? voice;
  }

  speak(character, text = "") {
    const voice = this.assign(character);
    if (!voice?.assetUrl) return Promise.resolve(false);
    this.queue = this.queue.catch(() => {}).then(() => this.play(character, voice, text));
    return this.queue;
  }

  speakSequence(turns) {
    return turns.reduce((pending, turn) => pending.then(() => this.speak(turn.character, turn.text)), Promise.resolve());
  }

  async load(url) {
    if (!this.buffers.has(url)) {
      this.buffers.set(url, fetch(url).then((response) => {
        if (!response.ok) throw new Error(`voice ${response.status}`);
        return response.arrayBuffer();
      }).then((bytes) => this.context.decodeAudioData(bytes)));
    }
    return this.buffers.get(url);
  }

  async play(character, voice, text) {
    this.unlock();
    const buffer = await this.load(voice.assetUrl);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = voice.playbackRate ?? 1;
    // Saved sounds provide identity/texture while captions carry the generated words.
    // Long AI turns repeat the requested loop until the estimated spoken turn ends.
    const spokenSeconds = Math.max(0.8, String(text).trim().split(/\s+/).filter(Boolean).length / 2.5);
    const turnSeconds = Math.min(15, Math.max(buffer.duration / source.playbackRate.value, spokenSeconds));
    source.loop = Boolean(voice.loopForTurn && turnSeconds > buffer.duration / source.playbackRate.value);
    gain.gain.value = 0.9;
    source.connect(gain).connect(this.context.destination);
    this.current = source;
    this.onStatus({ character, voice, text, playing: true });
    await new Promise((resolve) => {
      source.onended = resolve;
      source.start();
      if (source.loop) source.stop(this.context.currentTime + turnSeconds);
    });
    if (this.current === source) this.current = null;
    this.onStatus({ character, voice, text, playing: false });
    return true;
  }

  stop() {
    try { this.current?.stop(); } catch {}
    this.current = null;
    this.queue = Promise.resolve();
    this.onStatus(null);
  }
}
