jest.unmock('../../store');
import {runInAction} from 'mobx';

import {modelStore} from '..';
import {createModel} from '../../../jest/fixtures/models';
import {ModelOrigin, ModelType} from '../../utils/types';

const projector = (id: string, isDownloaded = true) =>
  createModel({id, name: id, modelType: ModelType.PROJECTION, isDownloaded});

const vision = (id: string, size: number, extra = {}) =>
  createModel({
    id,
    name: id,
    size,
    isDownloaded: true,
    origin: ModelOrigin.LOCAL,
    supportsMultimodal: true,
    defaultProjectionModel: `${id}-proj`,
    ...extra,
  });

const setModels = (models: any[]) =>
  runInAction(() => {
    modelStore.models = models;
  });

describe('ModelStore vision models', () => {
  afterEach(() =>
    runInAction(() => {
      modelStore.models = [];
      modelStore.lastVisionModelId = undefined;
    }),
  );

  it('lists only downloaded local models that can see right now', () => {
    setModels([
      vision('big', 3e9),
      projector('big-proj'),
      vision('no-proj', 1e9), // projector missing
      vision('proj-pending', 1e9),
      projector('proj-pending-proj', false), // projector not downloaded
      vision('vision-off', 1e9, {visionEnabled: false}),
      projector('vision-off-proj'),
      vision('not-downloaded', 1e9, {isDownloaded: false}),
      projector('not-downloaded-proj'),
      createModel({id: 'text', name: 'text', isDownloaded: true}),
    ]);
    expect(modelStore.visionModels.map(m => m.id)).toEqual(['big']);
  });

  it('picks the last vision model used, otherwise the smallest', () => {
    setModels([
      vision('big', 3e9),
      projector('big-proj'),
      vision('small', 6e8),
      projector('small-proj'),
    ]);
    expect(modelStore.pickVisionModel()?.id).toBe('small');
    runInAction(() => {
      modelStore.lastVisionModelId = 'big';
    });
    expect(modelStore.pickVisionModel()?.id).toBe('big');
  });

  it('returns nothing when no downloaded model can see', () => {
    setModels([createModel({id: 'text', name: 'text', isDownloaded: true})]);
    expect(modelStore.pickVisionModel()).toBeUndefined();
  });
});
