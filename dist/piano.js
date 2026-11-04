'use strict';
const piano = {
  context: null,
  buffers: new Map(),
  voices: new Set(),
  generation: 0,

  buffer(midi) {
    if (!this.buffers.has(midi)) {
      const bytes = Uint8Array.from(atob(window.pianoSamples[midi]), c => c.charCodeAt(0));
      this.buffers.set(midi, this.context.decodeAudioData(bytes.buffer));
    }
    return this.buffers.get(midi);
  },

  async play(notes) {
    try {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        this.context = new Context({latencyHint: 'interactive'});
        this.output = this.context.createDynamicsCompressor();
        this.output.connect(this.context.destination);
      }
      const resume = this.context.resume();
      const generation = this.generation;
      const requestedAt = this.context.currentTime;
      const keys = Object.keys(window.pianoSamples).map(Number);
      const prepared = await Promise.all(notes.map(async midi => {
        const key = keys.reduce((best, candidate) => Math.abs(candidate - midi) < Math.abs(best - midi) ? candidate : best);
        return {midi, key, buffer: await this.buffer(key)};
      }));
      await resume;
      if (generation !== this.generation || this.context.currentTime - requestedAt > 0.25) return;
      const when = this.context.currentTime + 0.005;
      for (const {midi, key, buffer} of prepared) {
        while (this.voices.size >= 32) {
          const oldest = this.voices.values().next().value;
          oldest.stop();
          this.voices.delete(oldest);
        }
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = 2 ** ((midi - key) / 12);
        const gain = this.context.createGain();
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.linearRampToValueAtTime(0.4, when + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.5);
        source.connect(gain);
        gain.connect(this.output);
        this.voices.add(source);
        source.onended = () => {
          this.voices.delete(source);
          source.disconnect();
          gain.disconnect();
        };
        source.start(when);
        source.stop(when + 1.55);
      }
    } catch (error) {
      this.mute();
    }
  },

  mute() {
    this.generation++;
    for (const voice of this.voices) voice.stop();
    this.voices.clear();
  }
};
