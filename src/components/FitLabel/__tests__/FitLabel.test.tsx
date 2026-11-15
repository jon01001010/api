import React from 'react';
import DeviceInfo from 'react-native-device-info';
import {render, waitFor} from '../../../../jest/test-utils';

import {FitLabel} from '../FitLabel';

const GB = 1e9;
let mockPc: any = null;

jest.mock('../../../services/desktop/pcHardware', () => ({
  FIT_TEXT: {
    card: 'Fits on your graphics card (fast)',
    partly: 'Partly on your graphics card (medium)',
    memory: 'Runs in memory, no graphics card (slow)',
    'too-big': 'Too big for this PC',
  },
  usePcHardware: () => mockPc,
  fitOnThisPc: (bytes: number) => (bytes < 8 * GB ? 'card' : 'too-big'),
}));

describe('FitLabel', () => {
  afterEach(() => {
    mockPc = null;
  });

  it('on a PC: says where it runs, with the memory needed', () => {
    mockPc = {
      totalMemory: 16 * GB,
      availableMemory: 8 * GB,
      cpuCores: 8,
      gpus: [],
    };
    const {getByTestId} = render(
      <FitLabel fileBytes={4 * GB} name="Qwen3-8B-Q4_K_M.gguf" />,
    );
    expect(getByTestId('fit-label').props.children).toMatch(
      /^Needs about \d\.\d GB · Fits on your graphics card \(fast\)$/,
    );
  });

  it('on a PC: too big', () => {
    mockPc = {
      totalMemory: 16 * GB,
      availableMemory: 8 * GB,
      cpuCores: 8,
      gpus: [],
    };
    const {getByTestId} = render(
      <FitLabel fileBytes={40 * GB} name="Llama-3.3-70B-Q4_K_M.gguf" />,
    );
    expect(getByTestId('fit-label').props.children).toContain(
      'Too big for this PC',
    );
  });

  it('marks mixture-of-experts models', () => {
    mockPc = {
      totalMemory: 64 * GB,
      availableMemory: 8 * GB,
      cpuCores: 8,
      gpus: [],
    };
    const {getByTestId} = render(
      <FitLabel fileBytes={6 * GB} name="Qwen3-30B-A3B-Q2_K.gguf" />,
    );
    expect(getByTestId('fit-label').props.children).toContain(
      'Mixture of experts: good on PCs with lots of memory',
    );
  });

  it('on a phone: by memory only', async () => {
    (DeviceInfo.getTotalMemory as jest.Mock).mockResolvedValueOnce(8 * GB);
    const {findByTestId} = render(
      <FitLabel fileBytes={1 * GB} name="Llama-3.2-1B-Q4_K_M.gguf" />,
    );
    const label = await findByTestId('fit-label');
    await waitFor(() =>
      expect(label.props.children).toContain('Fits on this phone'),
    );
  });

  it('on a phone: too big', async () => {
    (DeviceInfo.getTotalMemory as jest.Mock).mockResolvedValueOnce(4 * GB);
    const {findByTestId} = render(
      <FitLabel fileBytes={8 * GB} name="Qwen3-14B-Q4_K_M.gguf" />,
    );
    const label = await findByTestId('fit-label');
    expect(label.props.children).toContain('Too big for this phone');
  });

  it('shows nothing without a size', () => {
    mockPc = {
      totalMemory: 16 * GB,
      availableMemory: 8 * GB,
      cpuCores: 8,
      gpus: [],
    };
    const {queryByTestId} = render(<FitLabel fileBytes={0} name="x" />);
    expect(queryByTestId('fit-label')).toBeNull();
  });
});
