/**
 * Tiny 8-bit style SFX via Web Audio (no asset files).
 * Muted by default until user interacts once (browser autoplay policy).
 */

let ctx: AudioContext | null = null;
let muted = false;

function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

export function isSfxMuted() {
  return muted;
}

export function setSfxMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem("arb-guardian-sfx-muted", value ? "1" : "0");
  } catch {
    // ignore
  }
}

export function loadSfxMuted() {
  try {
    muted = localStorage.getItem("arb-guardian-sfx-muted") === "1";
  } catch {
    muted = false;
  }
  return muted;
}

async function resume() {
  const c = getCtx();
  if (c && c.state === "suspended") await c.resume();
  return c;
}

function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = "square",
  gain = 0.04
) {
  const c = getCtx();
  if (!c || muted) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.02);
}

export async function sfxClick() {
  await resume();
  tone(520, 0, 0.05, "square", 0.03);
  tone(780, 0.04, 0.05, "square", 0.025);
}

export async function sfxXp() {
  await resume();
  tone(660, 0, 0.07, "square", 0.045);
  tone(880, 0.07, 0.08, "square", 0.04);
  tone(1175, 0.14, 0.12, "square", 0.035);
}

export async function sfxSuccess() {
  await resume();
  tone(523, 0, 0.08, "triangle", 0.04);
  tone(659, 0.08, 0.08, "triangle", 0.04);
  tone(784, 0.16, 0.14, "triangle", 0.045);
}

export async function sfxBlock() {
  await resume();
  tone(220, 0, 0.1, "sawtooth", 0.035);
  tone(165, 0.08, 0.14, "sawtooth", 0.03);
}

export async function sfxFreeze() {
  await resume();
  tone(392, 0, 0.08, "square", 0.04);
  tone(311, 0.09, 0.1, "square", 0.035);
  tone(247, 0.18, 0.16, "triangle", 0.04);
  tone(196, 0.3, 0.2, "triangle", 0.03);
}

export async function sfxBadge() {
  await resume();
  tone(784, 0, 0.06, "square", 0.04);
  tone(988, 0.07, 0.07, "square", 0.04);
  tone(1319, 0.14, 0.16, "square", 0.045);
}
