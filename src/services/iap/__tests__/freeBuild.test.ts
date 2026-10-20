import {NativeStore} from '../NativeStore';
import {requestPurchase, initConnection} from 'react-native-iap';
jest.mock('react-native-iap', () => ({
  requestPurchase: jest.fn(),
  initConnection: jest.fn(),
}));
it('cannot initiate a payment in the free fork', async () => {
  const store = new NativeStore();
  await expect(store.purchase('test.product', null)).rejects.toThrow(
    'disabled',
  );
  expect(requestPurchase).not.toHaveBeenCalled();
  expect(initConnection).not.toHaveBeenCalled();
});
