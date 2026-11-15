jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {}),
  };
  return {__esModule: true, default: store, ...store};
});

import AsyncStorage from '@react-native-async-storage/async-storage';

import {formatSpeed, modelSpeedStore, nextSpeed} from '../modelSpeed';

describe('nextSpeed', () => {
  it('ignores short or broken timings', () => {
    expect(nextSpeed(undefined, undefined)).toBeNull();
    expect(
      nextSpeed(undefined, {predicted_per_second: 20, predicted_n: 5}),
    ).toBeNull();
    expect(
      nextSpeed(undefined, {predicted_per_second: NaN, predicted_n: 50}),
    ).toBeNull();
  });

  it('starts with the first reply and averages after', () => {
    const one = nextSpeed(undefined, {
      predicted_per_second: 20,
      predicted_n: 50,
    });
    expect(one).toEqual({tokensPerSecond: 20, replies: 1});
    const two = nextSpeed(one!, {predicted_per_second: 10, predicted_n: 50});
    expect(two).toEqual({tokensPerSecond: 15, replies: 2});
  });

  it('follows recent replies after ten', () => {
    const many = {tokensPerSecond: 10, replies: 50};
    const next = nextSpeed(many, {predicted_per_second: 21, predicted_n: 50});
    expect(next!.tokensPerSecond).toBeCloseTo(11);
  });
});

describe('formatSpeed', () => {
  it('rounds for reading', () => {
    expect(formatSpeed(undefined)).toBe('');
    expect(formatSpeed({tokensPerSecond: 12.4, replies: 1})).toBe(
      '12 tokens/s',
    );
    expect(formatSpeed({tokensPerSecond: 3.44, replies: 1})).toBe(
      '3.4 tokens/s',
    );
  });
});

describe('modelSpeedStore', () => {
  it('remembers per model and saves', async () => {
    await modelSpeedStore.record('m1', {
      predicted_per_second: 8,
      predicted_n: 100,
    });
    await modelSpeedStore.record('m1', {
      predicted_per_second: 2,
      predicted_n: 3,
    });
    expect(modelSpeedStore.speedOf('m1')).toEqual({
      tokensPerSecond: 8,
      replies: 1,
    });
    expect(modelSpeedStore.speedOf('m2')).toBeUndefined();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@pocketagent/model-speed/v1',
      expect.stringContaining('"m1"'),
    );
  });
});
