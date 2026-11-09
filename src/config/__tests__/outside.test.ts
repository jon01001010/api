/**
 * PocketAgent contacts no outside service on its own (2026-11-09 audit):
 * reports and shared benchmarks (PocketPal's Firebase, Google) are refused
 * before any connection, and no device rules are downloaded at start-up.
 */
import axios from 'axios';

import {ONLINE_DEVICE_RULES, OUTSIDE_REPORTS} from '../outside';
import {
  submitContentReport,
  submitFeedback,
  submitModelLoadErrorReport,
} from '../../api/feedback';
import {submitBenchmark} from '../../api/benchmark';

jest.mock('axios');

it('is off', () => {
  expect(OUTSIDE_REPORTS).toBe(false);
  expect(ONLINE_DEVICE_RULES).toBe(false);
});

it('refuses every report before any connection (not even google.com)', async () => {
  const fetchSpy = jest.fn();
  (globalThis as any).fetch = fetchSpy;
  await expect(submitFeedback({} as any)).rejects.toThrow(
    /Sending reports is off/,
  );
  await expect(submitContentReport({} as any)).rejects.toThrow(/off/);
  await expect(submitModelLoadErrorReport({} as any)).rejects.toThrow(/off/);
  await expect(submitBenchmark({} as any, {} as any)).rejects.toThrow(/off/);
  expect(axios.head).not.toHaveBeenCalled();
  expect(axios.post).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});
