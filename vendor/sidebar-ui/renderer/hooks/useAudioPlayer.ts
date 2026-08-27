import { useCallback, useSyncExternalStore } from 'react';
import { subscribeAudio, toggleAudio, seekTo } from '@/utils/audioPlayer';
import type { AudioState } from '@/utils/audioPlayer';

const defaultState: AudioState = { playing: false, currentPath: null, progress: 0, duration: 0 };
let latestState: AudioState = defaultState;

// Single shared subscription that updates latestState
const subscribers = new Set<() => void>();
let unsubGlobal: (() => void) | null = null;

function ensureGlobalSub() {
  if (!unsubGlobal) {
    unsubGlobal = subscribeAudio((state) => {
      latestState = state;
      for (const fn of subscribers) fn();
    });
  }
}

function subscribe(onStoreChange: () => void): () => void {
  ensureGlobalSub();
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

function getSnapshot(): AudioState {
  return latestState;
}

/**
 * React hook for audio playback.
 * Returns the global audio state and toggle function for a specific file.
 *
 * `isCurrent` = this file is the loaded one (playing OR paused) — progress/
 * duration are valid and the file is scrubbable. `isPlaying` = actively playing
 * (vs paused). Keeping the two separate lets a paused player still show its
 * position and seek, instead of snapping back to 0 (PRD 0.2.31 pause/resume).
 */
export function useAudioPlayer(filePath: string) {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const isCurrent = state.currentPath === filePath;
  const isPlaying = isCurrent && state.playing;

  // toggleAudio/seekTo read internal singleton state, so no dependency on play state
  const toggle = useCallback(() => toggleAudio(filePath), [filePath]);
  const seek = useCallback((time: number) => seekTo(time), []);

  return {
    isCurrent,
    isPlaying,
    progress: isCurrent ? state.progress : 0,
    duration: isCurrent ? state.duration : 0,
    toggle,
    seek,
  };
}
