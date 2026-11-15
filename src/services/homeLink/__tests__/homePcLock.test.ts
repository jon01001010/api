import {AppState, NativeModules} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {pbkdf2Sync} from 'crypto';

import {
  answerPcQuestion,
  askPcForPicture,
  closeTunnel,
  openTunnel,
  pairWithPc,
  pcQuestions,
  pcStatus,
  startPcModel,
  syncRawWithPc,
} from '../homeLink';
import {
  cancelPinRequest,
  changeLock,
  FIRST_WAIT_MS,
  forgetHomePcLock,
  homePcGate,
  LOCKED,
  noteAppState,
  resetHomePcLockForTests,
  setMonotonicClockForTests,
  subscribePinRequests,
  tryPin,
  turnOnPin,
  unlockedNow,
  unlockHomePc,
  waitAfter,
} from '../homePcLock';
import {PIN_ITERATIONS} from '../pinHash';

const PC = 'c'.repeat(64);
const OTHER = 'e'.repeat(64);

// An in-memory key store standing in for react-native-keychain.
const store = new Map<string, {username: string; password: string}>();
const K = Keychain as jest.Mocked<typeof Keychain>;

jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation((() => ({remove: () => {}})) as any);

beforeEach(() => {
  store.clear();
  resetHomePcLockForTests();
  K.setGenericPassword.mockImplementation((async (
    username: string,
    password: string,
    options?: {service?: string},
  ) => {
    store.set(options?.service ?? 'default', {username, password});
    return {service: options?.service, storage: 'test'};
  }) as any);
  K.getGenericPassword.mockImplementation(
    (async (options?: {service?: string}) =>
      store.get(options?.service ?? 'default') ?? false) as any,
  );
  K.resetGenericPassword.mockImplementation((async (options?: {
    service?: string;
  }) => store.delete(options?.service ?? 'default')) as any);
});

afterEach(() => {
  delete (NativeModules as any).HomeLink;
  setMonotonicClockForTests();
});

/** As after a restart of the app: memory gone, the key store kept. */
const restart = () => resetHomePcLockForTests();

const record = () =>
  JSON.parse(store.get(`pocketagent-homepc-lock-${PC}`)!.password);

describe('the PIN is kept as a slow salted hash only', () => {
  it('stores salt, PBKDF2 hash and rounds, never the PIN', async () => {
    expect((await turnOnPin(PC, '482915')).ok).toBe(true);
    const saved = store.get(`pocketagent-homepc-lock-${PC}`)!;
    expect(saved.password).not.toContain('482915');
    const r = JSON.parse(saved.password);
    expect(r.rounds).toBe(PIN_ITERATIONS);
    expect(r.hash).toBe(
      pbkdf2Sync(
        '482915',
        Buffer.from(r.salt, 'hex'),
        r.rounds,
        32,
        'sha256',
      ).toString('hex'),
    );
  });

  it('the same PIN on two PCs gives different hashes (salted)', async () => {
    await turnOnPin(PC, '1234');
    await turnOnPin(OTHER, '1234');
    const a = JSON.parse(store.get(`pocketagent-homepc-lock-${PC}`)!.password);
    const b = JSON.parse(
      store.get(`pocketagent-homepc-lock-${OTHER}`)!.password,
    );
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('only 4 to 8 digits', async () => {
    expect((await turnOnPin(PC, '123')).ok).toBe(false);
    expect((await turnOnPin(PC, '123456789')).ok).toBe(false);
    expect((await turnOnPin(PC, '12a4')).ok).toBe(false);
    expect(store.size).toBe(0);
    expect((await turnOnPin(PC, '12345678')).ok).toBe(true);
    // Not twice: a second "turn on" can't replace it without the PIN.
    expect((await turnOnPin(PC, '0000')).ok).toBe(false);
  });

  it('a broken or unreadable record refuses (not "no PIN")', async () => {
    store.set(`pocketagent-homepc-lock-${PC}`, {
      username: 'homepc-lock-v1',
      password: '{"v":1}',
    });
    expect(await homePcGate(PC)).toMatchObject({ok: false});
    restart();
    K.getGenericPassword.mockRejectedValueOnce(new Error('keystore'));
    expect(await homePcGate(PC)).toMatchObject({ok: false});
  });

  it('no PIN set: the gate is open (off by default)', async () => {
    expect(await homePcGate(PC)).toEqual({ok: true});
    expect(await unlockHomePc(PC)).toBe(true);
  });
});

describe('wrong PINs: 5 tries, then a wait that doubles', () => {
  it('waits: none, 5 min after 5, 10 after 10, 20 after 15, at most a day', () => {
    expect(waitAfter(1)).toBe(0);
    expect(waitAfter(4)).toBe(0);
    expect(waitAfter(5)).toBe(FIRST_WAIT_MS);
    expect(waitAfter(6)).toBe(0);
    expect(waitAfter(10)).toBe(2 * FIRST_WAIT_MS);
    expect(waitAfter(15)).toBe(4 * FIRST_WAIT_MS);
    expect(waitAfter(500)).toBe(24 * 60 * 60 * 1000);
  });

  it('counts down, then refuses even the right PIN until the wait is over', async () => {
    await turnOnPin(PC, '2468');
    restart();
    let t = 1_000_000;
    const now = () => t;
    // Real time passing: both clocks move.
    setMonotonicClockForTests(() => t);
    for (let i = 4; i >= 1; i--) {
      expect(await tryPin(PC, '1111', now)).toMatchObject({
        ok: false,
        reason: 'wrong',
        triesLeft: i,
      });
    }
    expect(await tryPin(PC, '1111', now)).toMatchObject({
      ok: false,
      reason: 'wait',
      waitUntil: t + FIRST_WAIT_MS,
    });
    t += FIRST_WAIT_MS - 1000;
    expect(await tryPin(PC, '2468', now)).toMatchObject({
      ok: false,
      reason: 'wait',
    });
    expect(unlockedNow(PC)).toBe(false);
    t += 1000;
    expect(await tryPin(PC, '2468', now)).toEqual({ok: true});
    expect(record().fails).toBe(0);
  });

  it('the count and the wait survive a restart of the app', async () => {
    await turnOnPin(PC, '2468');
    let t = 5_000_000;
    const now = () => t;
    setMonotonicClockForTests(() => t);
    for (let i = 0; i < 3; i++) {
      await tryPin(PC, '0000', now);
    }
    restart();
    expect(await tryPin(PC, '0000', now)).toMatchObject({triesLeft: 1});
    restart();
    expect(await tryPin(PC, '0000', now)).toMatchObject({reason: 'wait'});
    restart();
    expect(await tryPin(PC, '2468', now)).toMatchObject({reason: 'wait'});
    // After the wait: 5 more tries, then a 10-minute wait.
    t += FIRST_WAIT_MS;
    for (let i = 0; i < 4; i++) {
      await tryPin(PC, '0000', now);
    }
    expect(await tryPin(PC, '0000', now)).toMatchObject({
      reason: 'wait',
      waitUntil: t + 2 * FIRST_WAIT_MS,
    });
  });

  it('a try is counted before the check (stopping the app gives no free try)', async () => {
    await turnOnPin(PC, '2468');
    const check = tryPin(PC, '0000');
    // The first write (fails + 1) happens before the hash is worked out.
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(record().fails).toBe(1);
    await check;
  });

  it('setting the clock back restarts the wait instead of ending it', async () => {
    await turnOnPin(PC, '2468');
    let t = 10_000_000;
    const now = () => t;
    for (let i = 0; i < 5; i++) {
      await tryPin(PC, '0000', now);
    }
    t -= 60 * 60 * 1000; // an hour back
    expect(await tryPin(PC, '2468', now)).toMatchObject({
      reason: 'wait',
      waitUntil: t + FIRST_WAIT_MS,
    });
  });
});

describe('the wait counts only time the app measured (review 2, finding 4)', () => {
  const fiveWrong = async (now: () => number) => {
    for (let i = 0; i < 5; i++) {
      await tryPin(PC, '0000', now);
    }
  };

  it('setting the clock forward does not shorten the wait', async () => {
    await turnOnPin(PC, '2468');
    let t = 20_000_000;
    let mono = 0;
    setMonotonicClockForTests(() => mono);
    const now = () => t;
    await fiveWrong(now);
    // A day ahead, a second later: still the whole wait.
    t += 24 * 60 * 60 * 1000;
    mono += 1000;
    expect(await tryPin(PC, '2468', now)).toMatchObject({
      reason: 'wait',
      waitUntil: t + FIRST_WAIT_MS - 1000,
    });
    expect(record().waitLeft).toBe(FIRST_WAIT_MS - 1000);
    // And again (each try saves what is left, never less than measured).
    t += 365 * 24 * 60 * 60 * 1000;
    mono += 1000;
    expect(await tryPin(PC, '2468', now)).toMatchObject({reason: 'wait'});
    expect(record().waitLeft).toBe(FIRST_WAIT_MS - 2000);
    // Real time passing ends it.
    t += FIRST_WAIT_MS;
    mono += FIRST_WAIT_MS;
    expect(await tryPin(PC, '2468', now)).toEqual({ok: true});
  });

  it('a restart after moving the clock does not end it either', async () => {
    await turnOnPin(PC, '2468');
    let t = 30_000_000;
    let mono = 5_000;
    setMonotonicClockForTests(() => mono);
    const now = () => t;
    await fiveWrong(now);
    restart();
    t += 7 * 24 * 60 * 60 * 1000;
    mono = 10; // A new run of the app: its clock starts again.
    expect(await tryPin(PC, '2468', now)).toMatchObject({reason: 'wait'});
    expect(record().waitLeft).toBe(FIRST_WAIT_MS);
    // Counted from this run on.
    t += FIRST_WAIT_MS;
    mono += FIRST_WAIT_MS;
    expect(await tryPin(PC, '2468', now)).toEqual({ok: true});
  });

  it('the monotonic clock running faster than the wall clock does not count', async () => {
    await turnOnPin(PC, '2468');
    let t = 40_000_000;
    let mono = 0;
    setMonotonicClockForTests(() => mono);
    const now = () => t;
    await fiveWrong(now);
    mono += FIRST_WAIT_MS;
    t += 1000;
    expect(await tryPin(PC, '2468', now)).toMatchObject({reason: 'wait'});
  });

  it('a record from before (end time only) keeps at most its own length', async () => {
    await turnOnPin(PC, '2468');
    const t = 50_000_000;
    let mono = 0;
    setMonotonicClockForTests(() => mono);
    const old = record();
    delete old.waitLeft;
    store.set(`pocketagent-homepc-lock-${PC}`, {
      username: 'homepc-lock-v1',
      password: JSON.stringify({
        ...old,
        fails: 5,
        waitMs: FIRST_WAIT_MS,
        waitFrom: t,
        waitUntil: t + 10 * FIRST_WAIT_MS,
      }),
    });
    restart();
    expect(await tryPin(PC, '2468', () => t)).toMatchObject({
      reason: 'wait',
      waitUntil: t + FIRST_WAIT_MS,
    });
    mono += FIRST_WAIT_MS;
    expect(await tryPin(PC, '2468', () => t + FIRST_WAIT_MS)).toEqual({
      ok: true,
    });
  });
});

describe('the gate blocks every use of the link until unlocked', () => {
  const nativeLink = () => {
    const ok = jest.fn(async () => JSON.stringify({ok: true, port: 1}));
    (NativeModules as any).HomeLink = {
      pair: jest.fn(async () => JSON.stringify({ok: true, pc: PC})),
      status: ok,
      startModel: ok,
      sync: ok,
      questions: ok,
      answerQuestion: ok,
      picture: ok,
      openTunnel: ok,
      closeTunnel: jest.fn(async () => JSON.stringify({ok: true})),
    };
    return ok;
  };

  const everyUse = () => [
    pcStatus(PC),
    startPcModel(PC),
    syncRawWithPc(PC, '{}'),
    pcQuestions(PC),
    answerPcQuestion(PC, 1, true),
    askPcForPicture(PC, 'a cat'),
    openTunnel(PC),
  ];

  it('locked: nothing reaches the PC; unlocked: everything does', async () => {
    const reached = nativeLink();
    await turnOnPin(PC, '2468');
    restart(); // a fresh start is locked
    const refused = await Promise.all(everyUse());
    for (const r of refused) {
      expect(r).toEqual({ok: false, error: LOCKED, locked: true});
    }
    expect(reached).not.toHaveBeenCalled();
    // Pairing (the PC asks) and closing the tunnel still work.
    expect((await pairWithPc('PA1:P:x')).ok).toBe(true);
    expect((await closeTunnel()).ok).toBe(true);

    expect(await tryPin(PC, '2468')).toEqual({ok: true});
    const answers = await Promise.all(everyUse());
    expect(answers.every(a => a.ok)).toBe(true);
    expect(reached).toHaveBeenCalledTimes(7);
  });

  it('another PC without a PIN is not affected', async () => {
    const reached = nativeLink();
    await turnOnPin(PC, '2468');
    restart();
    expect((await pcStatus(OTHER)).ok).toBe(true);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it('unlocked lasts until the app was away longer than the minutes chosen', async () => {
    const link = nativeLink();
    await turnOnPin(PC, '2468', 5);
    restart();
    await tryPin(PC, '2468');
    let t = 1_000_000;
    // Away 4 minutes: still unlocked.
    noteAppState('background', t);
    t += 4 * 60 * 1000;
    expect(unlockedNow(PC, t)).toBe(true);
    noteAppState('active', t);
    expect(unlockedNow(PC, t + 60 * 60 * 1000)).toBe(true);
    // Away 6 minutes: locked again (even before the app comes back), and
    // the tunnel is closed when it does.
    noteAppState('background', t);
    t += 6 * 60 * 1000;
    expect(unlockedNow(PC, t)).toBe(false);
    noteAppState('active', t);
    expect(unlockedNow(PC, t)).toBe(false);
    expect((NativeModules as any).HomeLink.closeTunnel).toHaveBeenCalled();
    expect(await pcStatus(PC)).toMatchObject({ok: false, locked: true});
    expect(link).not.toHaveBeenCalled();
  });

  it('a PIN just turned on counts as entered', async () => {
    await turnOnPin(PC, '2468');
    expect(await homePcGate(PC)).toEqual({ok: true});
  });
});

describe('asking for the PIN', () => {
  it('opens the PIN window once and waits for it', async () => {
    await turnOnPin(PC, '2468');
    restart();
    const shown: (string | null)[] = [];
    subscribePinRequests(r => shown.push(r ? r.pc : null));
    const a = unlockHomePc(PC);
    const b = unlockHomePc(PC);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(shown.filter(x => x === PC).length).toBeGreaterThanOrEqual(1);
    expect((await tryPin(PC, '0000')).ok).toBe(false);
    expect((await tryPin(PC, '2468')).ok).toBe(true);
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    expect(shown[shown.length - 1]).toBeNull();
  });

  it('Cancel refuses the use', async () => {
    await turnOnPin(PC, '2468');
    restart();
    subscribePinRequests(() => {});
    const asked = unlockHomePc(PC);
    await new Promise(resolve => setTimeout(resolve, 0));
    cancelPinRequest(PC);
    await expect(asked).resolves.toBe(false);
    expect(await homePcGate(PC)).toMatchObject({ok: false});
  });

  it('with no PIN window to ask in, it refuses', async () => {
    await turnOnPin(PC, '2468');
    restart();
    await expect(unlockHomePc(PC)).resolves.toBe(false);
  });
});

describe('changing it needs the current PIN', () => {
  it('turning off, a new PIN, other minutes', async () => {
    await turnOnPin(PC, '2468');
    expect(await changeLock(PC, '1111', {off: true})).toMatchObject({
      ok: false,
      reason: 'wrong',
    });
    expect(store.has(`pocketagent-homepc-lock-${PC}`)).toBe(true);

    expect(
      await changeLock(PC, '2468', {newPin: '97531', awayMinutes: 15}),
    ).toEqual({ok: true});
    expect(record().awayMinutes).toBe(15);
    restart();
    expect((await tryPin(PC, '2468')).ok).toBe(false);
    expect((await tryPin(PC, '97531')).ok).toBe(true);

    expect(await changeLock(PC, '97531', {off: true})).toEqual({ok: true});
    expect(store.has(`pocketagent-homepc-lock-${PC}`)).toBe(false);
    restart();
    expect(await homePcGate(PC)).toEqual({ok: true});
  });

  it('wrong tries while changing count too', async () => {
    await turnOnPin(PC, '2468');
    for (let i = 0; i < 5; i++) {
      await changeLock(PC, '0000', {off: true});
    }
    expect(await changeLock(PC, '2468', {off: true})).toMatchObject({
      reason: 'wait',
    });
  });

  it('removing the PC from this device or pairing again clears it', async () => {
    await turnOnPin(PC, '2468');
    await forgetHomePcLock(PC);
    expect(store.size).toBe(0);
    restart();
    expect(await homePcGate(PC)).toEqual({ok: true});
  });
});
