// app/(app)/_components/FeedbackProvider.tsx
//
// App-wide sound + haptics preferences. Both default to on; the values are
// persisted in localStorage so the choice survives reloads and tabs.
// Controlled from Settings → My account.

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

const SOUND_KEY = "comparta:feedback:sound";
const HAPTICS_KEY = "comparta:feedback:haptics";
// Preferences used to live on the transfer screen only.
const LEGACY_SOUND_KEY = "comparta:transfer:sound";
const LEGACY_HAPTICS_KEY = "comparta:transfer:haptics";
const CHANGE_EVENT = "comparta-feedback-change";

export type Cue = "tap" | "next" | "back" | "success" | "error";

type Ctx = {
  sound: boolean;
  haptics: boolean;
  setSound: (v: boolean) => void;
  setHaptics: (v: boolean) => void;
  toggleSound: () => void;
  toggleHaptics: () => void;
  cue: (kind: Cue) => void;
};

const FeedbackContext = createContext<Ctx | null>(null);

// ── persistence ──────────────────────────────────────────────────────────

function readPref(key: string, legacyKey: string): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    // Anything other than an explicit "off" means enabled (default on).
    if (raw !== null) return raw !== "off";
    return window.localStorage.getItem(legacyKey) !== "off";
  } catch {
    return true;
  }
}

function writePref(key: string, legacyKey: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "on" : "off");
    window.localStorage.removeItem(legacyKey);
  } catch {
    // private mode — keep the in-memory value for this session
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function readSound() {
  return readPref(SOUND_KEY, LEGACY_SOUND_KEY);
}

function readHaptics() {
  return readPref(HAPTICS_KEY, LEGACY_HAPTICS_KEY);
}

function getServerSnapshot() {
  // SSR + first client render must match the default (enabled).
  return true;
}

function subscribe(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// ── tones ────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  if (typeof window === "undefined") return null;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

function tone(freq: number, duration = 0.08, gain = 0.03, delay = 0) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

function playCue(kind: Cue) {
  if (kind === "tap") tone(560, 0.045, 0.018);
  else if (kind === "next") {
    tone(660, 0.06, 0.028);
    tone(880, 0.07, 0.02, 0.055);
  } else if (kind === "back") tone(420, 0.06, 0.02);
  else if (kind === "error") {
    tone(300, 0.09, 0.03);
    tone(220, 0.1, 0.025, 0.08);
  } else {
    tone(660, 0.09, 0.032);
    tone(880, 0.09, 0.028, 0.09);
    tone(1320, 0.14, 0.024, 0.18);
  }
}

function vibrate(kind: Cue) {
  try {
    navigator.vibrate?.(
      kind === "success"
        ? [14, 40, 18]
        : kind === "error"
          ? [30]
          : kind === "tap"
            ? 6
            : 10
    );
  } catch {
    // unsupported
  }
}

// ── provider ─────────────────────────────────────────────────────────────

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const sound = useSyncExternalStore(subscribe, readSound, getServerSnapshot);
  const haptics = useSyncExternalStore(
    subscribe,
    readHaptics,
    getServerSnapshot
  );

  const setSound = useCallback((v: boolean) => {
    writePref(SOUND_KEY, LEGACY_SOUND_KEY, v);
  }, []);

  const setHaptics = useCallback((v: boolean) => {
    writePref(HAPTICS_KEY, LEGACY_HAPTICS_KEY, v);
  }, []);

  const toggleSound = useCallback(() => {
    const next = !readSound();
    writePref(SOUND_KEY, LEGACY_SOUND_KEY, next);
    // Preview the change when turning sound on.
    if (next) playCue("next");
  }, []);

  const toggleHaptics = useCallback(() => {
    const next = !readHaptics();
    writePref(HAPTICS_KEY, LEGACY_HAPTICS_KEY, next);
    if (next) vibrate("next");
  }, []);

  const cue = useCallback((kind: Cue) => {
    // Read live values so a freshly saved preference applies immediately.
    if (readHaptics()) vibrate(kind);
    if (readSound()) playCue(kind);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      sound,
      haptics,
      setSound,
      setHaptics,
      toggleSound,
      toggleHaptics,
      cue,
    }),
    [sound, haptics, setSound, setHaptics, toggleSound, toggleHaptics, cue]
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
    </FeedbackContext.Provider>
  );
}

const fallbackCtx: Ctx = {
  sound: true,
  haptics: true,
  setSound: () => {},
  setHaptics: () => {},
  toggleSound: () => {},
  toggleHaptics: () => {},
  cue: () => {},
};

export function useFeedback(): Ctx {
  return useContext(FeedbackContext) ?? fallbackCtx;
}
