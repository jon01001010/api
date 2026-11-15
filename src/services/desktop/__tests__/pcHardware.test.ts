import {npuText} from '../pcHardware';

describe('npuText', () => {
  it('says when there is none', () => {
    expect(npuText(undefined)).toBe('No NPU found');
    expect(npuText([])).toBe('No NPU found');
  });

  it('names the NPU and whether its driver works', () => {
    expect(
      npuText([
        {
          vendor: 'AMD',
          name: 'AMD Ryzen AI (XDNA 2)',
          driverOk: true,
          how: 'sysfs',
        },
      ]),
    ).toBe('NPU: AMD Ryzen AI (XDNA 2) (driver ready)');
    expect(
      npuText([
        {
          vendor: 'Intel',
          name: 'AI Boost',
          driverOk: false,
          how: 'pci-id',
        },
      ]),
    ).toBe('NPU: Intel AI Boost (no working driver)');
    expect(
      npuText([
        {
          vendor: 'unknown',
          name: 'Neural processor',
          driverOk: true,
          how: 'device-class',
        },
      ]),
    ).toBe('NPU: Neural processor (driver ready)');
  });
});
