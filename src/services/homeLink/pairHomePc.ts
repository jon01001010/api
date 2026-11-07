/**
 * Home link, phone side: pair from the PC's QR code, then add the PC's model
 * as the server "Home PC" (reached through the phone's local tunnel).
 */
import {serverStore} from '../../store/ServerStore';

import {openTunnel, pairWithPc, pcStatus, tunnelUrl} from './homeLink';

/** A local PC model reads long prompts slowly: wait up to 10 minutes. */
const HOME_PC_TIMEOUT_MS = 10 * 60 * 1000;

export async function pairHomePc(
  qr: string,
): Promise<{ok: boolean; message: string}> {
  const paired = await pairWithPc(qr);
  if (!paired.ok) {
    return {ok: false, message: paired.error};
  }
  const tunnel = await openTunnel(paired.pc);
  if (!tunnel.ok) {
    return {ok: false, message: tunnel.error};
  }
  const url = tunnelUrl(tunnel.port);
  const existing = serverStore.servers.find(s => s.homeLinkPc === paired.pc);
  const serverId = existing
    ? (serverStore.updateServer(existing.id, {url}), existing.id)
    : serverStore.addServer({
        name: 'Home PC',
        url,
        homeLinkPc: paired.pc,
        requestTimeoutMs: HOME_PC_TIMEOUT_MS,
      });
  const status = await pcStatus(paired.pc);
  if (status.ok && status.running && status.apiKey) {
    await serverStore.setApiKey(serverId, status.apiKey);
    await serverStore.fetchModelsForServer(serverId);
    return {
      ok: true,
      message: 'Your PC\'s model is now in Models as "Home PC".',
    };
  }
  return {
    ok: true,
    message:
      'Paired. Start a model on your PC (Run a model on this PC); it then shows up in Models as "Home PC".',
  };
}
