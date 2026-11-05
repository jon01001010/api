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
      remoteModels: [] as any[],
      lastVisionModelId: undefined as string | undefined,
      pickVisionTarget: jest.fn(),
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
  (modelStore.pickVisionTarget as jest.Mock).mockReturnValue(visionModel);
  // A successful load makes the model active; only the vision one can see.
  (modelStore.selectModel as jest.Mock).mockImplementation(async (m: any) => {
    mockState.active = m;
    mockState.canSee = m.id !== textModel.id;
    (modelStore as any).activeModelId = m.id;
  });
});

describe('ensureVisionForPictures', () => {
  it('does nothing when the loaded model can already see', async () => {
    mockState.canSee = true;
    expect(await ensureVisionForPictures()).toBe('ready');
    expect(modelStore.selectModel).not.toHaveBeenCalled();
  });

  it('switches a text model to the vision model and offers Undo', async () => {
    expect(await ensureVisionForPictures()).toBe('switched');
    expect(modelStore.selectModel).toHaveBeenCalledWith(visionModel);
    expect(uiStore.visionSwitchNotice).toEqual({
      previousModelId: 'qwen',
      modelId: 'smolvlm',
      modelName: 'SmolVLM2',
    });
  });

  it('reports when no local or cloud model can see', async () => {
    (modelStore.pickVisionTarget as jest.Mock).mockReturnValue(undefined);
    expect(await ensureVisionForPictures()).toBe('none');
    expect(modelStore.selectModel).not.toHaveBeenCalled();
  });

  it('reports cancelled when the load was declined (e.g. memory warning)', async () => {
    (modelStore.selectModel as jest.Mock).mockResolvedValue(undefined);
    expect(await ensureVisionForPictures()).toBe('cancelled');
    expect(uiStore.visionSwitchNotice).toBeNull();
  });

  it('reports cancelled when loading fails', async () => {
    (modelStore.selectModel as jest.Mock).mockRejectedValue(new Error('oom'));
    expect(await ensureVisionForPictures()).toBe('cancelled');
  });

  it('a text-only cloud model switches too, and comes back after', async () => {
    const cloudText = {...textModel, id: 'cloud', origin: ModelOrigin.REMOTE};
    mockState.active = cloudText;
    (modelStore as any).activeModelId = cloudText.id;
    (modelStore as any).remoteModels = [cloudText];
    expect(await ensureVisionForPictures()).toBe('switched');
    await returnFromVision();
    expect(modelStore.selectModel).toHaveBeenLastCalledWith(cloudText);
  });

  it('goes to a cloud vision model when the picker offers one', async () => {
    const cloudVision = {
      id: 'gemini',
      name: 'Gemini',
      origin: ModelOrigin.REMOTE,
    };
    (modelStore.pickVisionTarget as jest.Mock).mockReturnValue(cloudVision);
    expect(await ensureVisionForPictures()).toBe('switched');
    expect(modelStore.selectModel).toHaveBeenCalledWith(cloudVision);
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
    // One switch there, one back.
    expect(modelStore.selectModel).toHaveBeenCalledTimes(2);
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
    (modelStore.selectModel as jest.Mock).mockClear();
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
