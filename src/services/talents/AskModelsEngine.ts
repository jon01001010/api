/**
 * Several models, "and" and "or" (services/agent/manyModels.ts, SECURITY.md
 * rule 1). Both off until switched on in the Toolbox, like every tool.
 *
 * - `ask_models` ("and"): one question lists every target, with a box each
 *   the user can untick; the ticked ones get the same text at once; the
 *   answers come back side by side, each wrapped as untrusted, with where
 *   they plainly differ.
 * - `ask_model_chain` ("or"): the models in order; the first works on the
 *   task, and when one runs out (services/agent/runOut.ts) the next gets
 *   the task plus the work so far, with the line "<model> ran out (<why>):
 *   continuing with <next>". The question shows the whole chain and the
 *   cap. After a private read, moving on to a cloud company that has not
 *   had the text asks again. A rejected key, a refusal or any other error
 *   stops the chain and is reported.
 * - Both: one completion per model, no tools (handoffParams), the
 *   per-hand-off time limit and output cap; every model call counts toward
 *   the chat's caps (Continue / Stop past one); "Don't allow anything more
 *   in this chat" and the ask-rate limit hold; each model is logged in the
 *   hand-off log (model, outcome, sizes; never the text).
 */
import {stopQuietly} from '../../utils/stopQuietly';
import type {
  CompletionEngine,
  CompletionResult,
  CompletionStreamData,
} from '../../utils/completionTypes';
import {
  noteAsk,
  nothingMoreAllowed,
  privateReadIn,
  REFUSED_NOTHING_MORE,
  resetAsks,
  ASK_LIMIT,
  STOPPED_ASKING,
} from '../agent/chatGuard';
import {guardProposal} from '../agent/guardQuestions';
import {
  answerText,
  describeModels,
  estimateTokens,
  handoffParams,
  HANDOFF_TIME_LIMIT_MS,
  MAX_TASK_CHARS,
  noteHandoff,
  resetCaps,
  SUB_SYSTEM_PROMPT,
  totalsText,
  type SubModel,
} from '../agent/subAgent';
import {
  capFor,
  chainQuestion,
  continuationTask,
  differences,
  manyQuestion,
  MAX_MODELS_AT_ONCE,
  moveOnQuestion,
  pickModels,
  ranOutLine,
} from '../agent/manyModels';
import {
  isRefusal,
  resultRunOut,
  runOutOf,
  RUN_OUT_WHY,
  type RunOutKind,
} from '../agent/runOut';
import type {HandoffLogEntry} from '../agent/handoffLog';
import {
  appDeps as oneModelDeps,
  limited,
  REFUSED_HANDOFF,
  STOPPED_HANDOFFS,
  type AskOtherModelDeps,
} from './AskOtherModelEngine';
import {requestChoices, type FileProposal} from './fileApprovalGate';
import {wrapModelAnswer} from './untrustedContent';
import type {
  ModelAnswerItem,
  TalentEngine,
  TalentExecuteContext,
  TalentResult,
  ToolDefinition,
} from './types';

export const ASK_MODELS = 'ask_models';
export const ASK_MODEL_CHAIN = 'ask_model_chain';

export interface ManyModelsDeps extends AskOtherModelDeps {
  /** Asks with a box per target; the ticked ids, or null for no. */
  choose(
    proposal: FileProposal,
    signal?: AbortSignal,
  ): Promise<string[] | null>;
}

export function appManyDeps(): ManyModelsDeps {
  return {
    ...oneModelDeps(),
    choose: (proposal, signal) => requestChoices(proposal, signal),
  };
}

const plain = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const fail = (summary: string): TalentResult => ({
  type: 'error',
  summary,
  errorMessage: summary,
});

/** One model call's outcome. */
type Call =
  | {kind: 'answer'; answer: string; tokens: number; ms: number}
  | {kind: 'refusal'; answer: string; tokens: number; ms: number}
  | {kind: 'stopped'; tokens: number; ms: number}
  | {
      kind: 'failed';
      runOut: RunOutKind | null;
      message: string;
      /** What the model had written before it stopped (thinking out). */
      partial: string;
      tokens: number;
      ms: number;
    };

/**
 * One completion on one model: the helper system prompt and the text
 * only, no tools (handoffParams), within the time limit. Never throws.
 */
async function callModel(
  deps: AskOtherModelDeps,
  model: SubModel,
  text: string,
  signal: AbortSignal | undefined,
): Promise<Call> {
  const limitMs = deps.timeLimitMs ?? HANDOFF_TIME_LIMIT_MS;
  const started = deps.now();
  let engine: CompletionEngine | null = null;
  let streamed = '';
  const onData = (d: CompletionStreamData) => {
    if (typeof d?.content === 'string') {
      streamed = d.content;
    } else if (typeof d?.token === 'string') {
      streamed += d.token;
    }
  };
  const run = await limited<CompletionResult>(
    async () => {
      engine = await deps.engineFor(
        model,
        signal ?? new AbortController().signal,
      );
      return engine.completion(handoffParams(text) as any, onData);
    },
    limitMs,
    signal,
    () => {
      const e = engine as CompletionEngine | null;
      if (e) {
        stopQuietly(() => e.stopCompletion());
      }
    },
  );
  const ms = Math.max(0, deps.now() - started);
  const sentTokens = estimateTokens(SUB_SYSTEM_PROMPT + text);
  const partial = answerText({content: streamed});
  if (!run.ok) {
    if (run.why === 'stopped') {
      return {kind: 'stopped', tokens: sentTokens, ms};
    }
    if (run.why === 'timed_out') {
      return {
        kind: 'failed',
        runOut: 'timeout',
        message: `did not answer within ${Math.round(limitMs / 1000)} seconds`,
        partial,
        tokens: sentTokens + estimateTokens(partial),
        ms,
      };
    }
    return {
      kind: 'failed',
      runOut: runOutOf(run.why),
      message: run.why.message.slice(0, 300),
      partial,
      tokens: sentTokens + estimateTokens(partial),
      ms,
    };
  }
  const answer = answerText(run.value);
  const told =
    Number(run.value.tokens_evaluated ?? 0) +
    Number(run.value.tokens_predicted ?? 0);
  const tokens =
    Number.isFinite(told) && told > 0
      ? told
      : sentTokens + estimateTokens(answer);
  if (isRefusal(run.value)) {
    return {kind: 'refusal', answer, tokens, ms};
  }
  const full = resultRunOut(run.value);
  if (full) {
    return {
      kind: 'failed',
      runOut: full,
      message: 'its context is full',
      partial: answer,
      tokens,
      ms,
    };
  }
  return {kind: 'answer', answer, tokens, ms};
}

/** The log entry for one model (never the text). */
const entryFor =
  (deps: AskOtherModelDeps) =>
  (
    model: SubModel,
    outcome: HandoffLogEntry['outcome'],
    more: Partial<HandoffLogEntry> = {},
  ): HandoffLogEntry => ({
    at: deps.now(),
    model: model.name,
    where: model.where,
    outcome,
    sentChars: 0,
    resultChars: 0,
    ...more,
  });

/** The checks both tools share: the models, the task, nothing more. */
function checkCall(
  tool: string,
  deps: AskOtherModelDeps,
  args: Record<string, any>,
  chat: string | undefined,
):
  | {ok: true; models: SubModel[]; task: string}
  | {ok: false; result: TalentResult} {
  const listed = deps.models();
  const picked = pickModels(listed, args?.models);
  if (!picked.ok) {
    return {
      ok: false,
      result: fail(`${tool}: ${picked.problem} Nothing was sent.`),
    };
  }
  const task = plain(args?.task);
  if (!task) {
    return {
      ok: false,
      result: fail(
        `${tool}: give the \`task\`: the whole text the other models need. Nothing was sent.`,
      ),
    };
  }
  if (Array.from(task).length > MAX_TASK_CHARS) {
    return {
      ok: false,
      result: fail(
        `${tool}: the task is longer than ${MAX_TASK_CHARS} characters. Shorten it. Nothing was sent.`,
      ),
    };
  }
  if (chat && nothingMoreAllowed(chat)) {
    const entry = entryFor(deps);
    for (const m of picked.models) {
      deps.log(
        entry(m, 'refused', {note: 'nothing more allowed in this chat'}),
      );
    }
    return {ok: false, result: {type: 'text', summary: REFUSED_NOTHING_MORE}};
  }
  return {ok: true, models: picked.models, task};
}

/** Past the chat's caps for n more calls: Continue / Stop. True to go on. */
async function capsAllow(
  deps: AskOtherModelDeps,
  chat: string | undefined,
  n: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const cap = capFor(chat, n);
  if (!cap) {
    return true;
  }
  const go = await deps.ask(
    {
      action: 'handoff_cap',
      filename: `${cap} Continue, or stop handing tasks to other models?`,
      content: '',
      ...(chat ? {chat} : {}),
    },
    signal,
  );
  if (go) {
    resetCaps(chat);
  }
  return go;
}

const toolSchema = (
  name: string,
  description: string,
  models: SubModel[],
  modelsWords: string,
): ToolDefinition => ({
  type: 'function',
  function: {
    name,
    description: `${description} Models you may name (by id):\n${describeModels(models)}`,
    parameters: {
      type: 'object',
      properties: {
        models: {
          type: 'array',
          items: {
            type: 'string',
            ...(models.length ? {enum: models.map(m => m.id)} : {}),
          },
          minItems: 2,
          maxItems: MAX_MODELS_AT_ONCE,
          description: modelsWords,
        },
        task: {
          type: 'string',
          description: `The whole task, as the other models will read it (at most ${MAX_TASK_CHARS} characters).`,
        },
        reason: {
          type: 'string',
          description: 'Optional: one line for the user on why these models.',
        },
      },
      required: ['models', 'task'],
    },
  },
});

// ===================================================================== and

export class AskModelsEngine implements TalentEngine {
  readonly name = ASK_MODELS;

  constructor(private deps: ManyModelsDeps = appManyDeps()) {}

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const {deps} = this;
    const chat = ctx?.chat;
    const signal = ctx?.signal;
    const checked = checkCall(ASK_MODELS, deps, args, chat);
    if (!checked.ok) {
      return checked.result;
    }
    const {models, task} = checked;
    const entry = entryFor(deps);

    if (!(await capsAllow(deps, chat, models.length, signal))) {
      for (const m of models) {
        deps.log(entry(m, 'stopped', {note: 'limit reached'}));
      }
      return {type: 'text', summary: STOPPED_HANDOFFS};
    }

    // One question: every target with a box, the exact text, the facts.
    const q = manyQuestion({
      models,
      task,
      reason: plain(args?.reason),
      privateRead: chat ? privateReadIn(chat) : null,
      chat,
    });
    const chosen = await deps.choose(
      {
        action: 'ask_models',
        filename: q.facts,
        content: q.text,
        targets: q.targets,
        ...(q.alert ? {alert: q.alert} : {}),
        ...(q.modelSays ? {modelSays: q.modelSays} : {}),
        from: {thinking: ctx?.thinking, chat},
      },
      signal,
    );
    // Only models from the question, never more.
    const go = chosen ? models.filter(m => chosen.includes(m.id)) : [];
    if (!go.length) {
      for (const m of models) {
        deps.log(entry(m, 'refused'));
      }
      return {type: 'text', summary: REFUSED_HANDOFF};
    }
    const unticked = models.filter(m => !go.includes(m));
    for (const m of unticked) {
      deps.log(entry(m, 'unticked'));
    }

    // At once; each is one completion with no tools.
    const sentChars = Array.from(task).length;
    const calls = await Promise.all(
      go.map(m => callModel(deps, m, task, signal)),
    );
    const answers: ModelAnswerItem[] = [];
    calls.forEach((call, i) => {
      const m = go[i];
      noteHandoff(chat, call.tokens, call.ms);
      if (call.kind === 'answer' || call.kind === 'refusal') {
        deps.log(
          entry(m, call.kind === 'answer' ? 'answered' : 'failed', {
            sentChars,
            resultChars: Array.from(call.answer).length,
            tokens: call.tokens,
            ...(call.kind === 'refusal' ? {note: 'refused'} : {}),
          }),
        );
        answers.push({
          model: m.name,
          where: m.where,
          answer: call.answer || '(no answer)',
          ...(call.kind === 'refusal' ? {problem: 'it refused'} : {}),
        });
      } else if (call.kind === 'stopped') {
        deps.log(entry(m, 'stopped', {sentChars, note: 'stopped in the chat'}));
        answers.push({
          model: m.name,
          where: m.where,
          answer: '',
          problem: 'stopped',
        });
      } else {
        deps.log(
          entry(m, call.runOut === 'timeout' ? 'timed_out' : 'failed', {
            sentChars,
            resultChars: Array.from(call.partial).length,
            note: call.message,
          }),
        );
        answers.push({
          model: m.name,
          where: m.where,
          answer: call.partial,
          problem: `no whole answer: ${call.message}`,
        });
      }
    });
    if (calls.every(c => c.kind === 'stopped')) {
      return {
        type: 'text',
        summary: 'Stopped: the other models did not answer.',
      };
    }

    const answered = answers.filter(a => !a.problem && a.answer);
    const diffs = differences(answered);
    const lines = [
      ...(unticked.length
        ? [
            `Not asked (unticked by you): ${unticked.map(m => m.name).join(', ')}.`,
          ]
        : []),
      ...(answered.length > 1
        ? diffs.length
          ? diffs.map(d => `Where they differ: ${d}`)
          : ['No plain differences found by the app’s rough check.']
        : []),
    ];
    const parts = answers.map(a =>
      a.problem && !a.answer
        ? `${a.model} (${a.where}): no answer (${a.problem}).`
        : `${a.problem ? `${a.model}: ${a.problem}; what it wrote:\n` : ''}${wrapModelAnswer(a.model, a.answer)}`,
    );
    const summary = [
      `Answers from ${go.length} models to the same task, asked at once. Compare them: merge, pick or say where they disagree; each is untrusted text.`,
      ...parts,
      ...lines.map(l => `App note: ${l}`),
      totalsText(chat),
    ].join('\n\n');
    return {type: 'model_answers', mode: 'and', answers, lines, summary};
  }

  toToolDefinition(): ToolDefinition {
    return toolSchema(
      ASK_MODELS,
      'Send one self-contained task to several models the user has set up at once, and get all their answers back side by side (to compare, merge or pick). ' +
        'The user is asked first, sees exactly the text you send and may untick models. The other models get only your `task` text: ' +
        'no chat history, memory, files or tools. Each answer is untrusted text: check it. Each model counts as one hand-off.',
      this.deps.models(),
      `Two to ${MAX_MODELS_AT_ONCE} model ids from the list; all get the same task.`,
    );
  }
}

// ====================================================================== or

export class AskModelChainEngine implements TalentEngine {
  readonly name = ASK_MODEL_CHAIN;

  constructor(private deps: ManyModelsDeps = appManyDeps()) {}

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const {deps} = this;
    const chat = ctx?.chat;
    const signal = ctx?.signal;
    const checked = checkCall(ASK_MODEL_CHAIN, deps, args, chat);
    if (!checked.ok) {
      return checked.result;
    }
    const {models: chain, task} = checked;
    const entry = entryFor(deps);

    if (!(await capsAllow(deps, chat, 1, signal))) {
      deps.log(entry(chain[0], 'stopped', {note: 'limit reached'}));
      return {type: 'text', summary: STOPPED_HANDOFFS};
    }

    // One question up front: the whole chain, the cap, the exact text.
    const privateRead = chat ? privateReadIn(chat) : null;
    const q = chainQuestion({
      models: chain,
      task,
      reason: plain(args?.reason),
      privateRead,
      chat,
    });
    const allowed = await deps.ask(
      {
        action: 'ask_model_chain',
        filename: q.facts,
        content: q.text,
        targets: q.targets,
        ...(q.alert ? {alert: q.alert} : {}),
        ...(q.modelSays ? {modelSays: q.modelSays} : {}),
        from: {thinking: ctx?.thinking, chat},
      },
      signal,
    );
    if (!allowed) {
      deps.log(entry(chain[0], 'refused', {note: 'fallback chain'}));
      return {type: 'text', summary: REFUSED_HANDOFF};
    }

    const lines: string[] = [];
    const answers: ModelAnswerItem[] = [];
    /** Cloud companies that have had text from this chain. */
    const sentTo = new Set<string>();
    let text = task;
    let workSoFar = '';
    /** Why the last model ran out (for the move-on question). */
    let lastRunOut: RunOutKind = 'server';
    const done = (summaryHead: string): TalentResult => ({
      type: 'model_answers',
      mode: 'or',
      answers,
      lines,
      summary: [
        summaryHead,
        ...lines.map(l => `App note: ${l}`),
        ...answers.map(a =>
          a.answer
            ? `${a.problem ? `${a.model}: ${a.problem}; what it wrote:\n` : ''}${wrapModelAnswer(a.model, a.answer)}`
            : `${a.model} (${a.where}): no answer (${a.problem}).`,
        ),
        totalsText(chat),
      ].join('\n\n'),
    });

    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      if (i > 0) {
        const prev = chain[i - 1];
        // "Don't allow anything more" may have been answered meanwhile.
        if (chat && nothingMoreAllowed(chat)) {
          deps.log(
            entry(model, 'refused', {
              note: 'nothing more allowed in this chat',
            }),
          );
          return done(
            `${REFUSED_NOTHING_MORE} The chain stopped before ${model.name}.`,
          );
        }
        if (!(await capsAllow(deps, chat, 1, signal))) {
          deps.log(entry(model, 'stopped', {note: 'limit reached'}));
          return done(
            `${STOPPED_HANDOFFS} The chain stopped before ${model.name}.`,
          );
        }
        // After a private read, a cloud company new to this text asks again.
        const provider = model.provider || model.name;
        if (privateRead && model.place === 'cloud' && !sentTo.has(provider)) {
          if (chat && noteAsk(chat, deps.now())) {
            const go = await deps.ask(
              guardProposal({kind: 'too_many', count: ASK_LIMIT, chat}),
              signal,
            );
            if (!go) {
              deps.log(entry(model, 'stopped', {note: 'asked too often'}));
              return done(STOPPED_ASKING);
            }
            resetAsks(chat);
            noteAsk(chat, deps.now());
          }
          const mq = moveOnQuestion({
            from: prev,
            kind: lastRunOut,
            next: model,
            text,
            privateRead,
          });
          const ok = await deps.ask(
            {
              action: 'ask_other_model',
              filename: mq.facts,
              content: mq.text,
              alert: mq.alert,
              from: {thinking: ctx?.thinking, chat},
            },
            signal,
          );
          if (!ok) {
            deps.log(
              entry(model, 'refused', {note: 'moving on to another company'}),
            );
            lines.push(
              `You said no to moving on to ${model.name}: the chain stopped.`,
            );
            return done(
              `The user said no to sending this to ${model.name}: nothing was sent to it. Do not try to send it another way; answer with what you have.`,
            );
          }
        }
      }
      if (model.place === 'cloud') {
        sentTo.add(model.provider || model.name);
      }
      const sentChars = Array.from(text).length;
      const call = await callModel(deps, model, text, signal);
      noteHandoff(chat, call.tokens, call.ms);

      if (call.kind === 'answer') {
        deps.log(
          entry(model, 'answered', {
            sentChars,
            resultChars: Array.from(call.answer).length,
            tokens: call.tokens,
          }),
        );
        answers.push({
          model: model.name,
          where: model.where,
          answer: call.answer || '(no answer)',
        });
        return done(
          i === 0
            ? `${model.name} did the task.`
            : `${model.name} finished the task after ${i} model${i === 1 ? '' : 's'} before it ran out.`,
        );
      }
      if (call.kind === 'stopped') {
        deps.log(
          entry(model, 'stopped', {sentChars, note: 'stopped in the chat'}),
        );
        return {
          type: 'text',
          summary: 'Stopped: the other model did not answer.',
        };
      }
      if (call.kind === 'refusal') {
        // Never hop to another model for a refusal.
        deps.log(
          entry(model, 'failed', {
            sentChars,
            resultChars: Array.from(call.answer).length,
            note: 'refused',
          }),
        );
        answers.push({
          model: model.name,
          where: model.where,
          answer: call.answer,
          problem: 'it refused',
        });
        lines.push(
          `${model.name} refused: the chain stops here (it only moves on when a model runs out).`,
        );
        return done(`${model.name} refused the task; the chain stopped.`);
      }
      // Failed: move on only when it ran out.
      if (!call.runOut) {
        deps.log(entry(model, 'failed', {sentChars, note: call.message}));
        answers.push({
          model: model.name,
          where: model.where,
          answer: call.partial,
          problem: call.message,
        });
        lines.push(
          `${model.name} failed (${call.message}): the chain stops here (it only moves on when a model runs out).`,
        );
        return done(
          `${model.name} did not answer: ${call.message}. The chain stopped; nothing else was tried.`,
        );
      }
      deps.log(
        entry(model, 'ran_out', {
          sentChars,
          resultChars: Array.from(call.partial).length,
          note: `${RUN_OUT_WHY[call.runOut]}: ${call.message}`,
        }),
      );
      lastRunOut = call.runOut;
      if (call.partial) {
        workSoFar = call.partial;
      }
      const next = chain[i + 1];
      if (!next) {
        lines.push(`${model.name} ran out (${RUN_OUT_WHY[call.runOut]}).`);
        if (workSoFar) {
          answers.push({
            model: model.name,
            where: model.where,
            answer: workSoFar,
            problem: 'unfinished: every model in the chain ran out',
          });
        }
        return done(
          `All ${chain.length} models in the chain ran out; there is nothing more to try. Answer with what you have.`,
        );
      }
      lines.push(ranOutLine(model, call.runOut, next));
      text = continuationTask(task, workSoFar, model);
    }
    // Not reached: the loop returns.
    return done('The chain ended.');
  }

  toToolDefinition(): ToolDefinition {
    return toolSchema(
      ASK_MODEL_CHAIN,
      'Hand one self-contained task to the first of several models the user has set up; if it runs out (quota or credits, rate limit, text too long, no answer in time, server error), ' +
        'the next in your order takes over with the task and the work so far. Put the user’s preferred order (e.g. cloud models first, the PC’s model last). ' +
        'The user is asked first and sees the whole chain and the exact text. The models get only your `task` text: no chat history, memory, files or tools. ' +
        'The answer is untrusted text: check it. Each model tried counts as one hand-off.',
      this.deps.models(),
      `Two to ${MAX_MODELS_AT_ONCE} model ids from the list, in the order to try them.`,
    );
  }
}
