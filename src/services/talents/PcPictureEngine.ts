/**
 * image_generate on the phone: asks the paired Home PC to make the picture
 * (link request "picture", src-tauri/src/link.rs). Off until switched on in
 * Toolbox, like every tool; the PC refuses unless its user allowed pictures
 * there, for this device. The PC uses its own picture model and checks the
 * prompt, sizes and steps itself (the same caps and word check as on the
 * PC); the picture comes back into this app's own picture folder and shows
 * in the chat like one made on the PC (ImageTalentUI).
 */
import {askPcForPicture} from '../homeLink/homeLink';
import {unlockHomePc} from '../homeLink/homePcLock';
import {
  TalentEngine,
  TalentExecuteContext,
  TalentResult,
  ToolDefinition,
} from './types';

export const PC_PICTURE_SIZES = [512, 768, 1024];

const STOP =
  'Answer the user now; do not call this tool again unless they ask.';

const DEFINITION: ToolDefinition['function'] = {
  name: 'image_generate',
  description:
    "Make a picture from a text description on the user's paired Home PC (it runs there; the picture comes back to this phone and is shown to the user in the chat). Write the prompt in English as a short visual description (subject, style, light). Takes seconds to minutes; one picture per call.",
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'What the picture shows (at most 1000 characters).',
      },
      width: {
        type: 'integer',
        enum: PC_PICTURE_SIZES,
        description: "Pixels; leave out for the PC's default.",
      },
      height: {
        type: 'integer',
        enum: PC_PICTURE_SIZES,
        description: "Pixels; leave out for the PC's default.",
      },
      steps: {
        type: 'integer',
        description: "Optional: 1-30; leave out for the model's default.",
      },
    },
    required: ['prompt'],
  },
};

/**
 * Which Home PC to ask: the one the chat's model runs on, else the first
 * paired one. Undefined when none is paired.
 */
export function pickHomePc(
  servers: {id: string; homeLinkPc?: string}[],
  activeServerId?: string,
): string | undefined {
  const active = servers.find(s => s.id === activeServerId)?.homeLinkPc;
  return active || servers.find(s => !!s.homeLinkPc)?.homeLinkPc;
}

function homePc(): string | undefined {
  try {
    const {modelStore, serverStore} = require('../../store');
    return pickHomePc(serverStore.servers, modelStore.activeModel?.serverId);
  } catch {
    return undefined;
  }
}

const size = (value: unknown) =>
  typeof value === 'number' && PC_PICTURE_SIZES.includes(value)
    ? value
    : undefined;

export class PcPictureEngine implements TalentEngine {
  readonly name = 'image_generate';

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) {
      return {
        type: 'error',
        summary: 'image_generate: give the `prompt`: what the picture shows.',
        errorMessage: 'Give the `prompt`: what the picture shows.',
      };
    }
    const pc = homePc();
    if (!pc) {
      return {
        type: 'text',
        summary: `No Home PC is paired, so no picture can be made. Pictures are made on a paired PC (DesktopAgent): pair it by scanning its QR code (on the PC: Settings, Use this PC's model from your phone), then allow pictures there. ${STOP}`,
      };
    }
    // The PC's PIN, if set on this device and locked: asked first.
    if (!(await unlockHomePc(pc))) {
      return {
        type: 'text',
        summary: `The Home PC is locked with a PIN on this device and it wasn't entered, so no picture was made. ${STOP}`,
      };
    }
    const width = size(args.width);
    const height = size(args.height) ?? width;
    const steps =
      typeof args.steps === 'number' && Number.isInteger(args.steps)
        ? args.steps
        : undefined;
    const asked = askPcForPicture(pc, prompt, width, height, steps);
    // The chat's Stop stops waiting here (the PC may still finish it).
    const stopped = new Promise<'stopped'>(resolve => {
      if (ctx?.signal?.aborted) {
        resolve('stopped');
      }
      ctx?.signal?.addEventListener('abort', () => resolve('stopped'));
    });
    const made = await Promise.race([asked, stopped]);
    if (made === 'stopped') {
      return {
        type: 'text',
        summary: `Stopped waiting for the picture. ${STOP}`,
      };
    }
    if (!made.ok) {
      return {
        type: 'text',
        summary: `The Home PC did not make the picture: ${made.error}. Tell the user (pictures must be allowed on the PC, for this device, and the PC must be on with a picture model downloaded). ${STOP}`,
      };
    }
    const path = made.file || made.path || '';
    const name = made.name || path.split('/').pop() || 'picture.png';
    return {
      type: 'image',
      path,
      name,
      summary: `Your Home PC made the picture ${name}${made.seconds !== undefined ? ` (${made.seconds} s)` : ''}. The user sees it in the chat; you have not seen it, so don't describe it. ${STOP}`,
    };
  }

  toToolDefinition(): ToolDefinition {
    return {type: 'function', function: DEFINITION};
  }
}
