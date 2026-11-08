import {buildCommit, buildLabel, buildsDiffer} from '../buildInfo';

describe('which build this is', () => {
  it('local builds say development and never warn', () => {
    expect(buildCommit()).toBe('dev');
    expect(buildLabel()).toBe('Build: development');
    expect(buildsDiffer('dev', '1a2b3c4d5e6f')).toBe(false);
    expect(buildsDiffer(null, '1a2b3c4d5e6f')).toBe(false);
  });

  it('two known builds match on their common length', () => {
    expect(buildsDiffer('1a2b3c4d5e6f', '1a2b3c4d5e6f')).toBe(false);
    expect(buildsDiffer('1a2b3c4', '1a2b3c4d5e6f')).toBe(false);
    expect(buildsDiffer('1a2b3c4d5e6f', '9f8e7d6c5b4a')).toBe(true);
  });
});
