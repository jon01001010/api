import {createSegmenter} from '../endpointer';

/** 100 ms of 16-bit PCM at a loudness. */
const chunk = (amplitude: number) => {
  const samples = new Int16Array(1600);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin(i / 3) * amplitude * 32767);
  }
  return new Uint8Array(samples.buffer);
};
const feed = (
  s: ReturnType<typeof createSegmenter>,
  amp: number,
  ms: number,
) => {
  for (let t = 0; t < ms; t += 100) {
    s.push(chunk(amp));
  }
};

describe('segmenter (always-on listening)', () => {
  it('hands over each utterance after a pause, with the lead-in kept', () => {
    const got: Uint8Array[] = [];
    const s = createSegmenter(a => got.push(a));
    feed(s, 0.001, 1000); // quiet room
    feed(s, 0.3, 1000); // "hey agent"
    expect(got).toHaveLength(0);
    feed(s, 0.001, 700); // pause
    expect(got).toHaveLength(1);
    // 400 ms lead-in + 1 s speech + 700 ms pause = 2.1 s of audio.
    expect(got[0].length).toBe(2.1 * 16000 * 2);

    feed(s, 0.3, 500);
    feed(s, 0.001, 700);
    expect(got).toHaveLength(2);
  });

  it('ignores clicks', () => {
    const got: Uint8Array[] = [];
    const s = createSegmenter(a => got.push(a));
    feed(s, 0.001, 500);
    feed(s, 0.3, 100);
    feed(s, 0.001, 1000);
    expect(got).toHaveLength(0);
  });

  it('cuts very long speech', () => {
    const got: Uint8Array[] = [];
    const s = createSegmenter(a => got.push(a), {maxMs: 2000});
    feed(s, 0.001, 500);
    feed(s, 0.3, 4000);
    expect(got.length).toBeGreaterThanOrEqual(1);
  });

  it('adapts to a steady background noise', () => {
    const got: Uint8Array[] = [];
    const s = createSegmenter(a => got.push(a));
    feed(s, 0.02, 10000); // fan or traffic
    got.length = 0;
    feed(s, 0.02, 3000);
    expect(got).toHaveLength(0);
    feed(s, 0.3, 800);
    feed(s, 0.02, 800);
    expect(got).toHaveLength(1);
  });

  it('reset() drops a half-heard utterance', () => {
    const got: Uint8Array[] = [];
    const s = createSegmenter(a => got.push(a));
    feed(s, 0.3, 500);
    s.reset();
    feed(s, 0.001, 1000);
    expect(got).toHaveLength(0);
  });
});
