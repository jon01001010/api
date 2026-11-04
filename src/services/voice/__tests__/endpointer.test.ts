import {createEndpointer, rms} from '../endpointer';

const RATE = 16000;
/** A 100 ms chunk at a given loudness (0–1). */
const chunk = (amplitude: number) => {
  const samples = new Int16Array(RATE / 10);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin(i / 3) * amplitude * 32767);
  }
  return samples;
};
const feed = (
  ep: ReturnType<typeof createEndpointer>,
  amp: number,
  ms: number,
) => {
  let state = ep.push(chunk(amp));
  for (let t = 100; t < ms; t += 100) {
    state = ep.push(chunk(amp));
  }
  return state;
};

describe('endpointer', () => {
  it('measures loudness', () => {
    expect(rms(new Int16Array(10))).toBe(0);
    expect(rms(chunk(0.5))).toBeGreaterThan(0.3);
  });

  it('ends the turn after speech followed by a pause', () => {
    const ep = createEndpointer();
    expect(feed(ep, 0.001, 300)).toBe('waiting'); // background noise
    expect(feed(ep, 0.3, 1000)).toBe('speaking');
    expect(feed(ep, 0.001, 600)).toBe('speaking'); // short pause
    expect(feed(ep, 0.001, 700)).toBe('done');
    expect(ep.push(chunk(0.3))).toBe('done'); // stays done
  });

  it('gives up when nobody speaks', () => {
    const ep = createEndpointer({noSpeechMs: 2000});
    expect(feed(ep, 0.001, 2000)).toBe('no-speech');
  });

  it('ignores a short click', () => {
    const ep = createEndpointer({noSpeechMs: 3000});
    feed(ep, 0.001, 300);
    feed(ep, 0.3, 100);
    expect(feed(ep, 0.001, 2600)).toBe('no-speech');
  });

  it('raises the bar in a noisy room', () => {
    const ep = createEndpointer({noSpeechMs: 2000});
    feed(ep, 0.05, 300); // loud background
    // Same loudness as the background is not speech.
    expect(feed(ep, 0.05, 1700)).toBe('no-speech');
  });

  it('caps one utterance', () => {
    const ep = createEndpointer({maxMs: 1000});
    expect(feed(ep, 0.3, 1000)).toBe('done');
  });

  it('hears a user who starts talking right after the tap', () => {
    const ep = createEndpointer();
    expect(feed(ep, 0.3, 1000)).toBe('speaking');
    expect(feed(ep, 0.001, 1300)).toBe('done');
  });
});
