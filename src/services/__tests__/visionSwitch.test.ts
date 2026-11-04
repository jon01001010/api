import {ModelOrigin} from '../../utils/types';

const textModel = {id: 'qwen', name: 'Qwen 2B', origin: ModelOrigin.LOCAL};
const visionModel = {
  id: 'smolvlm',
  name: 'SmolVLM2',
  origin: ModelOrigin.LOCAL,
};

// Plain stand-ins: just the store members the switch uses.
const mockState: {active: any; canSee: boolean} = {active: null, canSee: false};
jest.mock('../../store', () => {
  const ui: any = {visionSwitchNotice: null};
  ui.setVisionSwitchNotice = jest.fn((n: any) => {
    ui.visionSwitchNotice = n;
  });
  return {
    uiStore: ui,
    modelStore: {
      get activeModel() {
        return mockState.active;
      },
      get activeModelCaps() {
        return {visionActive: mockState.canSee};
      },
      activeModelId: undefined as string | undefined,
      models: [] as any[],
      pickVisionModel: jest.fn(),
      initContext: jest.fn(),
      selectModel: jest.fn(),
    },
  };
});

import {modelStore, uiStore} from '../../store';
import {
  ensureVisionForPictures,
  returnFromVision,
  undoVisionSwitch,
} from '../visionSwitch';

beforeEach(() => {
  jest.clearAllMocks();
  mockState.active = textModel;
  mockState.canSee = false;
  uiStore.setVisionSwitchNotice(null);
  (modelStore as any).activeModelId = textModel.id;
  (modelStore as any).models = [textModel, visionModel];
  (modelStore.pickVisionModel as jest.Mock).mockReturnValue(visionModel);
  // A successful load makes the vision model active with vision working.
  (modelStore.initContext as jest.Mock).mockImplementation(async (m: any) => {
    mockState.active = m;
    mockState.canSee = true;
    (modelStore as any).activeModelId = m.id;
  });
});

describe('ensureVisionForPictures', () => {
  it('does nothing when the loaded model can already see', async () => {
    mockState.canSee = true;
    expect(await ensureVisionForPictures()).toBe('ready');
    expect(modelStore.initContext).not.toHaveBeenCalled();
  });

  it('switches a text model to the vision model and offers Undo', async () => {
    expect(await ensureVisionForPictures()).toBe('switched');
    expect(modelStore.initContext).toHaveBeenCalledWith(visionModel);
    expect(uiStore.visionSwitchNotice).toEqual({
      previousModelId: 'qwen',
      modelId: 'smolvlm',
      modelName: 'SmolVLM2',
    });
  });

  it('reports when no downloaded model can see', async () => {
    (modelStore.pickVisionModel as jest.Mock).mockReturnValue(undefined);
    expect(await ensureVisionForPictures()).toBe('none');
    expect(modelStore.initContext).not.toHaveBeenCalled();
  });

  it('reports cancelled when the load was declined (e.g. memory warning)', async () => {
    (modelStore.initContext as jest.Mock).mockResolvedValue(undefined);
    expect(await ensureVisionForPictures()).toBe('cancelled');
    expect(uiStore.visionSwitchNotice).toBeNull();
  });

  it('reports cancelled when loading fails', async () => {
    (modelStore.initContext as jest.Mock).mockRejectedValue(new Error('oom'));
    expect(await ensureVisionForPictures()).toBe('cancelled');
  });

  it('leaves server (remote) models alone', async () => {
    mockState.active = {...textModel, origin: ModelOrigin.REMOTE};
    expect(await ensureVisionForPictures()).toBe('remote');
    expect(modelStore.initContext).not.toHaveBeenCalled();
  });

  it('Undo loads the previous model again', async () => {
    await ensureVisionForPictures();
    await undoVisionSwitch();
    expect(modelStore.selectModel).toHaveBeenCalledWith(textModel);
    expect(uiStore.visionSwitchNotice).toBeNull();
  });
});

describe('returnFromVision (after the picture is answered)', () => {
  it('loads the previous model again', async () => {
    await ensureVisionForPictures();
    await returnFromVision();
    expect(modelStore.selectModel).toHaveBeenCalledWith(textModel);
    expect(uiStore.visionSwitchNotice).toBeNull();
  });

  it('runs only once per switch', async () => {
    await ensureVisionForPictures();
    await returnFromVision();
    await returnFromVision();
    expect(modelStore.selectModel).toHaveBeenCalledTimes(1);
  });

  it('does nothing after Undo', async () => {
    await ensureVisionForPictures();
    await undoVisionSwitch();
    (modelStore.selectModel as jest.Mock).mockClear();
    await returnFromVision();
    expect(modelStore.selectModel).not.toHaveBeenCalled();
  });

  it('leaves a model the user picked meanwhile', async () => {
    await ensureVisionForPictures();
    (modelStore as any).activeModelId = 'other-model';
    await returnFromVision();
    expect(modelStore.selectModel).not.toHaveBeenCalled();
  });

  it('does nothing when no switch happened', async () => {
    mockState.canSee = true;
    await ensureVisionForPictures();
    await returnFromVision();
    expect(modelStore.selectModel).not.toHaveBeenCalled();
  });
});
