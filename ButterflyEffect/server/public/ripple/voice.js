// Push-to-talk speech input.
//   "server": record with MediaRecorder, the server transcribes it (works in the Quest Browser,
//             which has no built-in speech recognition). Needs STT_API_KEY in server/.env.
//   "browser": the Web Speech API, where the browser has it (desktop Chrome).
//   "none":   no speech available; the app falls back to trigger = kind, grip = harsh.

export class Voice {
  constructor() { this.mode = "none"; this.active = false; }

  async init(serverTranscribes) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (serverTranscribes && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mode = "server";
        return this.mode;
      } catch (error) { console.warn("Microphone unavailable:", error.message); }
    }
    if (Recognition) {
      this.recognition = new Recognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.lang = "en-US";
      this.mode = "browser";
    }
    return this.mode;
  }

  start() {
    if (this.active || this.mode === "none") return;
    this.active = true;
    if (this.mode === "server") {
      this.chunks = [];
      this.recorder = new MediaRecorder(this.stream);
      this.recorder.ondataavailable = (event) => { if (event.data.size) this.chunks.push(event.data); };
      this.recorder.start();
    } else {
      this.heard = [];
      this.failed = false;
      this.recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) this.heard.push(event.results[i][0].transcript);
        }
      };
      this.recognition.onerror = (event) => { if (event.error !== "no-speech" && event.error !== "aborted") this.failed = true; };
      try { this.recognition.start(); } catch { /* already running */ }
    }
  }

  /** Resolves { transcript, failed }. An empty transcript with failed=false means silence. */
  async stop() {
    if (!this.active) return { transcript: "", failed: false };
    this.active = false;
    if (this.mode === "server") {
      const recorder = this.recorder;
      await new Promise((resolve) => { recorder.onstop = resolve; recorder.stop(); });
      const audio = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
      if (audio.size < 1500) return { transcript: "", failed: false };
      try {
        const reply = await fetch("/transcribe", { method: "POST", headers: { "Content-Type": audio.type }, body: audio });
        const body = await reply.json();
        if (!reply.ok) throw new Error(body.error);
        return { transcript: (body.text ?? "").trim(), failed: false };
      } catch (error) {
        console.warn("Transcription failed:", error.message);
        return { transcript: "", failed: true };
      }
    }
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2500);
      this.recognition.onend = () => { clearTimeout(timeout); resolve(); };
      try { this.recognition.stop(); } catch { resolve(); }
    });
    return { transcript: this.heard.join(" ").trim(), failed: this.failed };
  }
}
