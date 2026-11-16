/**
 * Several models, "and" and "or" (owner, 2026-11-16; SECURITY.md rule 1),
 * built on sub-agents (subAgent.ts). Plain data and functions; the tools
 * are services/talents/AskModelsEngine.ts.
 *
 * - And (`ask_models`): one task to several models at once. One question
 *   lists every target (where it runs, "sent to <provider> with your
 *   key"), the exact text, its size and the cost when known, with a box
 *   per target the user can untick; "the same text goes to N companies";
 *   a red line when the chat read private data and a target is cloud.
 *   The answers come back side by side, each wrapped as untrusted; where
 *   they plainly differ is said (a rough check: the main model compares).
 * - Or (`ask_model_chain`): the models in the user's order; the first
 *   works on the task; when it runs out (runOut.ts) the next gets the task
 *   and the work so far, and the chat says "<model> ran out (<why>):
 *   continuing with <next>". The question shows the whole chain and the
 *   cap up front. After a private read, moving on to a cloud company that
 *   has not had the text yet asks again. Anything else that fails (a
 *   rejected key, a refusal) stops and is reported.
 * - Both: no tools for any model (switching never adds any); every model
 *   call counts toward the chat's caps (subAgent.ts); each is logged.
 */
import {
  costText,
  HANDOFF_MAX_OUTPUT_TOKENS,
  HANDOFF_TIME_LIMIT_MS,
  MAX_CHAT_MS,
  MAX_CHAT_TOKENS,
  MAX_HANDOFFS,
  handoffsIn,
  sizeText,
  totalsText,
  type SubModel,
} from './subAgent';
import {RUN_OUT_WHY, type RunOutKind} from './runOut';

/** Most models in one call ("and") or one chain ("or"). */
export const MAX_MODELS_AT_ONCE = 4;
/** Most characters of the work so far handed to the next model. */
export const MAX_WORK_SO_FAR_CHARS = 4000;

/**
 * The models the main model named, in its order, or what is wrong. Only
 * listed ids count; the same model twice is one.
 */
export function pickModels(
  models: readonly SubModel[],
  ids: unknown,
): {ok: true; models: SubModel[]} | {ok: false; problem: string} {
  if (!Array.isArray(ids) || !ids.length) {
    return {ok: false, problem: 'give `models`: a list of model ids.'};
  }
  const out: SubModel[] = [];
  for (const id of ids) {
    const model =
      typeof id === 'string' ? models.find(m => m.id === id.trim()) : undefined;
    if (!model) {
      return {
        ok: false,
        problem: `${JSON.stringify(id)} is not a model you may name. Use ids from: ${models.map(m => m.id).join(', ') || '(none)'}.`,
      };
    }
    if (!out.includes(model)) {
      out.push(model);
    }
  }
  if (out.length < 2) {
    return {
      ok: false,
      problem:
        'name at least two different models (for one, use ask_other_model).',
    };
  }
  if (out.length > MAX_MODELS_AT_ONCE) {
    return {
      ok: false,
      problem: `at most ${MAX_MODELS_AT_ONCE} models at once.`,
    };
  }
  return {ok: true, models: out};
}

/** The cloud companies among these models, each once, in order. */
export function cloudCompanies(models: readonly SubModel[]): string[] {
  return [
    ...new Set(
      models.filter(m => m.place === 'cloud').map(m => m.provider || m.name),
    ),
  ];
}

/** "The same text goes to 2 companies: Claude, OpenAI." (or nothing). */
export function companiesLine(models: readonly SubModel[]): string | null {
  const companies = cloudCompanies(models);
  if (!companies.length) {
    return null;
  }
  return companies.length === 1
    ? `The text goes to 1 company: ${companies[0]}.`
    : `The same text goes to ${companies.length} companies: ${companies.join(', ')}.`;
}

/**
 * The chat's caps for n more model calls: what would be passed, or null.
 * Past one the app asks Continue / Stop first.
 */
export function capFor(chat: string | undefined, n: number): string | null {
  const s = handoffsIn(chat);
  if (s.count + n > MAX_HANDOFFS) {
    return `This would make ${s.count + n} hand-offs to other models in this chat (the limit is ${MAX_HANDOFFS}; each model counts).`;
  }
  if (s.tokens >= MAX_CHAT_TOKENS) {
    return `Hand-offs in this chat used about ${s.tokens.toLocaleString('en-US')} tokens (the limit is ${MAX_CHAT_TOKENS.toLocaleString('en-US')}).`;
  }
  if (s.ms >= MAX_CHAT_MS) {
    return `Hand-offs in this chat took ${Math.round(s.ms / 60000)} minutes (the limit is ${MAX_CHAT_MS / 60000}).`;
  }
  return null;
}

/** One target as the question lists it. */
export interface TargetLine {
  id: string;
  /** "Claude Sonnet: sent to Claude with your key". */
  label: string;
  /** The cost line for this target. */
  detail: string;
  cloud: boolean;
}

export function targetLines(
  models: readonly SubModel[],
  task: string,
): TargetLine[] {
  return models.map(m => ({
    id: m.id,
    label: `${m.name}: ${m.where}`,
    detail: costText(m, task),
    cloud: m.place === 'cloud',
  }));
}

export interface ManyQuestionInput {
  models: SubModel[];
  task: string;
  reason?: string;
  privateRead?: string | null;
  chat?: string;
}

/** The red line after a private read, when any of these is cloud. */
function privateAlert(
  models: readonly SubModel[],
  privateRead: string | null | undefined,
): string | undefined {
  const companies = cloudCompanies(models);
  return privateRead && companies.length
    ? `Earlier in this chat the model read private data (${privateRead}). This text goes to cloud models (${companies.join(', ')}). Check it holds nothing private.`
    : undefined;
}

const reasonOf = (reason?: string) => {
  const r = (reason ?? '').trim();
  return r ? {modelSays: r.slice(0, 600)} : {};
};

/** "And": the facts, the exact text and the targets (each can be unticked). */
export function manyQuestion(q: ManyQuestionInput): {
  facts: string;
  text: string;
  targets: TargetLine[];
  modelSays?: string;
  alert?: string;
} {
  const facts = [
    `The model wants to hand the same task to ${q.models.length} models at once. Untick any you don't want.`,
    companiesLine(q.models),
    `Size: ${sizeText(q.task)} to each; each answer at most ${HANDOFF_MAX_OUTPUT_TOKENS} tokens, within ${HANDOFF_TIME_LIMIT_MS / 60000} minutes.`,
    'The other models get no tools, no chat history, memory or files: only the text below. Each model counts as one hand-off.',
    totalsText(q.chat),
  ].filter((l): l is string => !!l);
  const alert = privateAlert(q.models, q.privateRead);
  return {
    facts: facts.join('\n'),
    text: q.task,
    targets: targetLines(q.models, q.task),
    ...reasonOf(q.reason),
    ...(alert ? {alert} : {}),
  };
}

/** "Or": the whole chain in order, the cap, the exact first text. */
export function chainQuestion(q: ManyQuestionInput): {
  facts: string;
  text: string;
  targets: TargetLine[];
  modelSays?: string;
  alert?: string;
} {
  const n = q.models.length;
  const facts = [
    `The model wants ${q.models[0].name} to do this task; if it runs out (quota or credits, rate limit, text too long, no answer in time, server error or not reachable), the next in this order takes over, with the task and the work so far.`,
    companiesLine(q.models),
    `Cap: at most ${n} models are tried, one after the other; each answer at most ${HANDOFF_MAX_OUTPUT_TOKENS} tokens within ${HANDOFF_TIME_LIMIT_MS / 60000} minutes, so at most ${(n * HANDOFF_MAX_OUTPUT_TOKENS).toLocaleString('en-US')} tokens of answers in all. Each model tried counts as one hand-off.`,
    `Size: ${sizeText(q.task)} (the next model also gets the work so far, at most ${MAX_WORK_SO_FAR_CHARS.toLocaleString('en-US')} characters).`,
    q.privateRead && cloudCompanies(q.models).length > 1
      ? 'Before the text goes on to a different cloud company, you are asked again.'
      : null,
    'A rejected key, a refusal or any other error stops the chain and is reported; it never moves on for those.',
    'The models get no tools, no chat history, memory or files.',
    totalsText(q.chat),
  ].filter((l): l is string => !!l);
  const alert = privateAlert(q.models, q.privateRead);
  return {
    facts: facts.join('\n'),
    text: q.task,
    targets: targetLines(q.models, q.task),
    ...reasonOf(q.reason),
    ...(alert ? {alert} : {}),
  };
}

/** "<model> ran out (<why>): continuing with <next>". */
export function ranOutLine(
  model: SubModel,
  kind: RunOutKind,
  next: SubModel,
): string {
  return `${model.name} ran out (${RUN_OUT_WHY[kind]}): continuing with ${next.name}`;
}

/**
 * The text the next model in the chain gets: the task, then the work so
 * far (the end of it, capped) if there is any.
 */
export function continuationTask(
  task: string,
  workSoFar: string,
  from: SubModel,
): string {
  const work = workSoFar.trim();
  if (!work) {
    return task;
  }
  const chars = Array.from(work);
  const kept =
    chars.length > MAX_WORK_SO_FAR_CHARS
      ? `[… ${chars.length - MAX_WORK_SO_FAR_CHARS} characters before]${chars.slice(-MAX_WORK_SO_FAR_CHARS).join('')}`
      : work;
  return (
    `${task}\n\n` +
    `Another model (${from.name}) started on this task and stopped before it finished. Its work so far is below; check it, then continue and give the whole answer.\n` +
    `--- work so far ---\n${kept}\n--- end of work so far ---`
  );
}

/** The re-ask when the chain moves to a cloud company after a private read. */
export function moveOnQuestion(q: {
  from: SubModel;
  kind: RunOutKind;
  next: SubModel;
  text: string;
  privateRead: string;
}): {facts: string; text: string; alert: string} {
  return {
    facts: [
      `${q.from.name} ran out (${RUN_OUT_WHY[q.kind]}). Continue with ${q.next.name}?`,
      `Where: ${q.next.where}.`,
      `This text leaves this device: it goes to ${q.next.provider} with your key.`,
      `Size: ${sizeText(q.text)}.`,
      costText(q.next, q.text),
    ].join('\n'),
    text: q.text,
    alert: `Earlier in this chat the model read private data (${q.privateRead}). This text has not been sent to ${q.next.provider} yet. Check it holds nothing private.`,
  };
}

// ----------------------------------------------------------- disagreement

const NUMBER = /-?\d+(?:[.,]\d+)?/g;
const numbersIn = (text: string): string[] =>
  [...new Set((text.match(NUMBER) ?? []).map(n => n.replace(',', '.')))].sort();
const wordsIn = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
const yesNo = (text: string): 'yes' | 'no' | null => {
  const first = wordsIn(text)[0];
  return first === 'yes' ? 'yes' : first === 'no' ? 'no' : null;
};
/** Words in common / words in either (0..1), for longer answers. */
function overlap(a: string, b: string): number {
  const wa = new Set(wordsIn(a).filter(w => w.length > 3));
  const wb = new Set(wordsIn(b).filter(w => w.length > 3));
  if (!wa.size || !wb.size) {
    return 1;
  }
  let both = 0;
  for (const w of wa) {
    if (wb.has(w)) {
      both++;
    }
  }
  return both / (wa.size + wb.size - both);
}

/**
 * Where two answers plainly differ, in plain words. A rough check, said
 * as one: a "yes" against a "no", short answers that are not the same,
 * different numbers, or long answers with few words in common. Empty when
 * nothing plainly differs (they may still disagree: the main model reads
 * them all).
 */
export function differences(
  answers: readonly {model: string; answer: string}[],
): string[] {
  const out: string[] = [];
  for (let i = 0; i < answers.length; i++) {
    for (let j = i + 1; j < answers.length; j++) {
      const a = answers[i];
      const b = answers[j];
      const pair = `${a.model} and ${b.model}`;
      const ya = yesNo(a.answer);
      const yb = yesNo(b.answer);
      if (ya && yb && ya !== yb) {
        out.push(`${pair}: one says yes, the other no.`);
        continue;
      }
      const wa = wordsIn(a.answer);
      const wb = wordsIn(b.answer);
      if (wa.length <= 12 && wb.length <= 12) {
        if (wa.join(' ') !== wb.join(' ')) {
          out.push(`${pair}: different short answers.`);
        }
        continue;
      }
      const na = numbersIn(a.answer);
      const nb = numbersIn(b.answer);
      if (na.length && nb.length && na.join(' ') !== nb.join(' ')) {
        out.push(`${pair}: different numbers.`);
        continue;
      }
      if (overlap(a.answer, b.answer) < 0.2) {
        out.push(`${pair}: few words in common.`);
      }
    }
  }
  return out;
}
