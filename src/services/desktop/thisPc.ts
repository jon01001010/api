/**
 * "Run a model on this PC": Windows app only (src/services/desktop/thisPc.web.ts).
 * On the phone this does nothing; phones run models with llama.rn.
 */
export const THIS_PC = 'This PC';

export const isDesktopApp = (): boolean => false;

export async function runModelOnThisPc(): Promise<{
  ok: boolean;
  message: string;
}> {
  return {ok: false, message: 'Only in the Windows app.'};
}

export async function stopModelOnThisPc(): Promise<void> {}

/** Phone: models run with llama.rn; nothing to start. */
export async function prepareThisPcModel(
  _serverId: string,
  _modelPath: string,
): Promise<void> {}

/** Phone: models run with llama.rn (initContext); never called there. */
export async function startOnThisPc(
  _modelPath: string,
  _projectionPath?: string,
): Promise<string> {
  throw new Error('Only in the Windows app.');
}
