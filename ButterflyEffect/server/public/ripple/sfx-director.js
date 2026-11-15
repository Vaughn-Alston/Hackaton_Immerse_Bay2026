// Small WebAudio adapter for semantic Satie events. The same JSON can drive Lens Studio.
const ASSETS = {
  "grand-piano-g6": "/ripple/satie/audio/grand-piano-g6.mp3",
  "hand-clap-8": "/ripple/satie/audio/hand-clap-8.mp3",
};

export class SfxDirector {
  constructor() {
    this.buffers = new Map();
    this.current = new Set();
    this.startedStories = new Set();
  }

  unlock() {
    this.context ??= new (window.AudioContext || window.webkitAudioContext)();
    this.context.resume().catch(() => {});
  }

  async load(slug) {
    const url = ASSETS[slug];
    if (!url) return null;
    if (!this.buffers.has(url)) {
      this.buffers.set(url, fetch(url).then((response) => {
        if (!response.ok) throw new Error(`Satie sound ${response.status}: ${slug}`);
        return response.arrayBuffer();
      }).then((bytes) => this.context.decodeAudioData(bytes)));
    }
    return this.buffers.get(url);
  }

  async play(slug, { maxDurationMs = 0, gain = 0.9 } = {}) {
    this.unlock();
    const buffer = await this.load(slug);
    if (!buffer) return false;
    const source = this.context.createBufferSource();
    const level = this.context.createGain();
    source.buffer = buffer;
    level.gain.value = gain;
    source.connect(level).connect(this.context.destination);
    this.current.add(source);
    source.onended = () => this.current.delete(source);
    source.start();
    if (maxDurationMs) source.stop(this.context.currentTime + maxDurationMs / 1000);
    return true;
  }

  beginStory(storyInstanceId, definition) {
    if (definition?.oncePerStory && this.startedStories.has(storyInstanceId)) return Promise.resolve(false);
    this.startedStories.add(storyInstanceId);
    return this.play(definition?.sound, { gain: 0.82 });
  }

  playReaction(reaction) {
    const sound = reaction?.sound;
    if (!sound || sound.characterVoice) return Promise.resolve(false);
    return this.play(sound.savedSoundSlug, { maxDurationMs: sound.maxDurationMs ?? 0, gain: 1 });
  }

  stop() {
    for (const source of this.current) try { source.stop(); } catch {}
    this.current.clear();
  }
}
