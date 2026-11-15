// One live Visko Orbis video (a Reactor session), or a stand-in when ?mock=1.
// Each LiveStream is billed per second while connected. The Main Story Window has one and
// so does every Side Story Window (capped by ?live=N in main.js).

import * as THREE from "three";

const SDK = "https://cdn.jsdelivr.net/npm/@reactor-team/js-sdk@3.4.0/+esm";

export class LiveStream {
  constructor(name, { mock = false, onStatus = () => {}, onLost = () => {} } = {}) {
    this.name = name;
    this.mock = mock;
    this.onStatus = onStatus;
    this.onLost = onLost;
    this.started = false;
    this.runEnded = false;
    this.lastPrompt = null;
    this.queue = Promise.resolve();

    if (mock) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = 640; this.canvas.height = 360;
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.drawMock("waiting");
    } else {
      this.video = document.createElement("video");
      this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true;
      this.texture = new THREE.VideoTexture(this.video);
    }
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  async connect() {
    if (this.mock) { this.onStatus("ready (mock)"); return; }
    const { Reactor } = await import(SDK);
    const session = await (await fetch("/session", { method: "POST" })).json();
    if (!session.token) throw new Error(`${session.error ?? "no token"} ${session.detail ?? ""}`.trim());

    this.reactor = new Reactor({ modelName: session.model });
    this.reactor.on("trackReceived", (name, _track, stream) => {
      if (name === "main_video") { this.video.srcObject = stream; this.video.play().catch(() => {}); }
    });
    this.reactor.on("message", (message) => {
      if (message.type !== "generation_complete") return;
      // The run played out while we were still on this beat: start it again so the
      // window never freezes while the player is thinking.
      this.runEnded = true;
      if (this.lastPrompt) this.show(this.lastPrompt).catch(() => {});
    });
    this.reactor.on("error", (error) => this.onStatus(`error: ${error.code ?? ""} ${error.message ?? error}`));

    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for the model")), 90000);
      this.reactor.on("statusChanged", (status) => {
        this.onStatus(status === "waiting" ? "waiting for a GPU" : status);
        if (status === "ready") { clearTimeout(timeout); resolve(); }
        if (status === "disconnected" && this.started) this.onLost();
      });
    });
    await this.reactor.connect(session.token);
    await ready;
  }

  /** Shows a new beat. `cut` starts a fresh run (new person or place); otherwise the picture morphs. */
  show(prompt, { cut = false } = {}) {
    this.queue = this.queue.catch(() => {}).then(() => this.apply(prompt, cut));
    return this.queue;
  }

  async apply(prompt, cut) {
    this.lastPrompt = prompt;
    if (this.mock) { this.drawMock(prompt); return; }
    if (!this.reactor) return;
    if (this.started && !this.runEnded && !cut) {
      // A refused command resolves undefined; fall through to a fresh run.
      if ((await this.reactor.sendCommand("set_prompt", { prompt })) !== undefined) return;
    }
    if (this.started) await this.reactor.sendCommand("reset", {});
    await this.reactor.sendCommand("set_audio_enabled", { audio_enabled: false });
    await this.reactor.sendCommand("set_prompt", { prompt });
    await this.reactor.sendCommand("start", {});
    this.started = true;
    this.runEnded = false;
  }

  /** Holds the picture on its current frame (true) or lets it run again (false). The session stays open. */
  hold(on) {
    if (!this.video) return;
    if (on) this.video.pause(); else this.video.play().catch(() => {});
  }

  /** A still copy of the current picture, for a side window that is not the live one. */
  snapshot() {
    const copy = document.createElement("canvas");
    copy.width = 640; copy.height = 360;
    const source = this.mock ? this.canvas : this.video;
    try { if (this.mock || this.video.readyState >= 2) copy.getContext("2d").drawImage(source, 0, 0, 640, 360); } catch { /* keep it black */ }
    return copy;
  }

  drawMock(prompt) {
    const g = this.canvas.getContext("2d");
    g.fillStyle = "#15151a"; g.fillRect(0, 0, 640, 360);
    g.fillStyle = "#c2452d"; g.font = "bold 20px system-ui"; g.fillText(`${this.name} (mock video)`, 20, 34);
    g.fillStyle = "#d8d6d0"; g.font = "16px system-ui";
    let line = "", y = 64;
    for (const word of prompt.split(" ")) {
      if (g.measureText(line + word).width > 600) { g.fillText(line, 20, y); line = ""; y += 21; if (y > 350) break; }
      line += word + " ";
    }
    if (y <= 350) g.fillText(line, 20, y);
    this.texture.needsUpdate = true;
  }

  async close() {
    this.lastPrompt = null;
    this.started = false;
    const reactor = this.reactor;
    this.reactor = undefined;
    if (reactor) await reactor.disconnect().catch(() => {}); // ends the session, which stops billing
  }
}
