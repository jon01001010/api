/**
 * The desktop app's network: what goes through the native side. The 40 s
 * Windows start was the native bridge's own address (http://ipc.localhost)
 * being sent through the native side, so every native call called itself.
 */
jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
  Channel: jest.fn(),
}));
import {isOutside} from '../tauriNet';

const WINDOWS_APP = 'http://tauri.localhost';
const LINUX_APP = 'tauri://localhost';

it("never sends the app's own addresses through the native side", () => {
  for (const url of [
    'http://ipc.localhost/http_request',
    'http://ipc.localhost/fs_read',
    'http://IPC.LOCALHOST./secret_get',
    'http://tauri.localhost/bundle.js',
    'http://pa-preview.localhost/abc',
    'ipc://localhost/fs_read',
  ]) {
    expect(isOutside(url, WINDOWS_APP)).toBe(false);
    expect(isOutside(url, LINUX_APP)).toBe(false);
  }
});

it('sends real outside addresses and your own servers through it', () => {
  for (const url of [
    'https://huggingface.co/api/models',
    'http://127.0.0.1:5000/v1/models',
    'http://localhost:1234/v1/models',
    'http://192.168.1.20:8080/v1',
  ]) {
    expect(isOutside(url, WINDOWS_APP)).toBe(true);
  }
});
