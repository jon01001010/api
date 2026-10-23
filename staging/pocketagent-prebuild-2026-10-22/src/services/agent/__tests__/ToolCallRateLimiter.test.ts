import {ToolCallRateLimiter} from '../ToolCallRateLimiter';
it('throttles calls per tool and resets after window', () => {
  const limiter = new ToolCallRateLimiter(2, 1000);
  expect(limiter.tryAcquire('web', 1000)).toBe(true);
  expect(limiter.tryAcquire('web', 1001)).toBe(true);
  expect(limiter.tryAcquire('web', 1002)).toBe(false);
  expect(limiter.tryAcquire('files', 1002)).toBe(true);
  expect(limiter.tryAcquire('web', 2001)).toBe(true);
});
