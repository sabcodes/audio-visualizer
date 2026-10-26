import type { ModeFrame } from './types';
import { approach, settleStep } from './shared';

/** A hat-heavy onset reads as the snare; everything else is a kick (the same split Slit Dancer uses). */
export const isSnare = (frame: Pick<ModeFrame, 'audio'>) => frame.audio.highs > frame.audio.bass + 0.15;

/** Bounce scaled by the sensitivity slider (default 1.8 reads as 1), so motion follows the slider directly. */
export const drive = (frame: Pick<ModeFrame, 'response' | 'sensitivity'>) => frame.response.bounce * ((frame.sensitivity ?? 1.8) / 1.8);

/**
 * Section changes: a sustained jump in loudness (a drop after a build) or, failing that, a fixed time. Returns
 * true on the frame a new section starts; `minGap` keeps two drops from firing back to back.
 */
export function sectionWatch(every = 60, minGap = 8) {
  let slow = 0, fast = 0, since = 0;
  return (frame: ModeFrame) => {
    const step = settleStep(frame);
    slow = approach(slow, frame.response.loudness, step, 6);
    fast = approach(fast, frame.response.loudness, step, 0.6);
    since += step;
    if ((since > minGap && fast - slow > 0.22) || since > every) { since = 0; slow = fast; return true; }
    return false;
  };
}
