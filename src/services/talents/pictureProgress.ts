/**
 * Progress while a picture is made: the PC's picture maker
 * (src-tauri/src/image_gen.rs) sends `image-progress` events with a phase
 * word and step numbers only (never its own text). The running tool sets a
 * short line here and the chat's pending indicator shows it next to Stop.
 */
import {makeAutoObservable} from 'mobx';

export type PicturePhase = 'loading' | 'sampling' | 'decoding' | 'saving';

/** The `image-progress` event's payload. */
export type PictureProgress = {
  id: string;
  phase: PicturePhase;
  step: number;
  steps: number;
  /** About how many seconds of sampling are left; null until known. */
  seconds: number | null;
  /** The chat model is loaded on the same graphics card. */
  chatOnCard?: boolean;
};

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;

/** "about 40 s left" / "about 2 min left". */
function timeLeft(seconds: number): string {
  if (seconds < 10) {
    return `about ${Math.max(1, Math.round(seconds))} s left`;
  }
  if (seconds < 60) {
    return `about ${Math.round(seconds / 5) * 5} s left`;
  }
  return `about ${Math.round(seconds / 60)} min left`;
}

/** A hint only: the chat model is never unloaded for a picture. */
export const CHAT_ON_CARD_HINT =
  'The chat model is also on the graphics card; pictures are slower. Unloading it makes pictures faster.';

/**
 * The line shown for one event; null for anything malformed. The hint
 * about the chat model shows once, until the first step.
 */
export function pictureProgressText(
  p: Partial<PictureProgress>,
): string | null {
  const line = phaseText(p);
  const early =
    p?.phase === 'loading' || (p?.phase === 'sampling' && !count(p.step));
  return line && p?.chatOnCard === true && early
    ? `${line} ${CHAT_ON_CARD_HINT}`
    : line;
}

function phaseText(p: Partial<PictureProgress>): string | null {
  switch (p?.phase) {
    case 'loading':
      return 'Loading the model…';
    case 'sampling': {
      const step = count(p.step);
      const steps = count(p.steps);
      if (!step || !steps || step > steps) {
        return 'Making the picture…';
      }
      const seconds = count(p.seconds);
      const left = seconds && step < steps ? `, ${timeLeft(seconds)}` : '';
      return `Making the picture… step ${step} of ${steps}${left}`;
    }
    case 'decoding':
    case 'saving':
      return 'Finishing…';
    default:
      return null;
  }
}

/** Phone: the PC makes it; nothing streams over the link. */
export const PC_MAKING_PICTURE = 'Your PC is making the picture…';

class ToolProgressStore {
  text: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  set(text: string | null) {
    this.text = text;
  }
}

/** The running tool's progress line (one tool runs at a time). */
export const toolProgress = new ToolProgressStore();
