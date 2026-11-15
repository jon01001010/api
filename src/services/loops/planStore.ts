/**
 * Saved plans (plan.ts) and their runs (planRunner.ts), kept apart from the
 * loops list so a loop stays small.
 *
 * Versioned: each edit saves a new version (the last 10 are kept); "go
 * back" saves a copy of an older version as the newest, so nothing is
 * lost by going back. A plan is only changed here, by the user's screens:
 * the runner reads it and never writes it (runaway stop).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addLog,
  cleanCustomPrompt,
  fingerprint,
  type Loop,
  type LoopInput,
  startLoop,
  updateLoop,
} from './loops';
import {
  cleanGuards,
  type Plan,
  planText,
  type PlanTools,
  validatePlan,
} from './plan';

const PLANS_KEY = '@pocketagent/loop-plans/v1';
export const MAX_VERSIONS = 10;

export interface PlanVersion {
  v: number;
  at: number;
  plan: Plan;
  /** What changed, in a few words ("Made from a draft", "Edited"). */
  note: string;
}

export interface PlanRecord {
  /** Oldest first; the last one is the plan in use. */
  versions: PlanVersion[];
  /**
   * Fingerprints of each step's result in the last finished run (for the
   * "changed since the last run" check); never the results themselves.
   */
  lastResults?: Record<string, string>;
}

type Plans = Record<string, PlanRecord>;

async function loadAll(): Promise<Plans> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(PLANS_KEY)) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

async function saveAll(plans: Plans): Promise<void> {
  await AsyncStorage.setItem(PLANS_KEY, JSON.stringify(plans));
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      // A screen's listener never stops a save.
    }
  }
}

const listeners = new Set<() => void>();
export function onPlansChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const isPlan = (p: any): p is Plan =>
  p && Array.isArray(p.steps) && p.guards && typeof p.guards === 'object';

/** The versions of a loop's plan, oldest first (none: []). */
export async function planVersions(loopId: string): Promise<PlanVersion[]> {
  const rec = (await loadAll())[loopId];
  return Array.isArray(rec?.versions)
    ? rec.versions.filter(v => v && Number.isFinite(v.v) && isPlan(v.plan))
    : [];
}

/** The plan in use (the newest version), if any. */
export async function currentPlan(
  loopId: string,
): Promise<PlanVersion | undefined> {
  const list = await planVersions(loopId);
  return list[list.length - 1];
}

/**
 * Saves a plan as a new version (the user pressed Save or Start). The plan
 * is checked again here with the same validator as a draft. While a run of
 * this plan isn't finished nothing is saved (a run's steps never change
 * under it; it also runs its own copy).
 */
export async function savePlanVersion(
  loopId: string,
  plan: Plan,
  note: string,
  tools: PlanTools,
  now = Date.now(),
): Promise<
  {ok: true; version: PlanVersion; notes: string[]} | {ok: false; error: string}
> {
  const {busyRun} = require('./planRunner');
  if (await busyRun(loopId)) {
    return {
      ok: false,
      error: "This plan has a run that isn't finished: stop it first",
    };
  }
  const checked = validatePlan(plan, tools);
  if (!checked.plan.steps.length) {
    return {ok: false, error: 'A plan needs at least one step'};
  }
  const all = await loadAll();
  const rec: PlanRecord = all[loopId] ?? {versions: []};
  const last = rec.versions[rec.versions.length - 1];
  const version: PlanVersion = {
    v: (last?.v ?? 0) + 1,
    at: now,
    plan: {...checked.plan, guards: cleanGuards(checked.plan.guards)},
    note: note.slice(0, 60),
  };
  all[loopId] = {
    ...rec,
    versions: [...rec.versions, version].slice(-MAX_VERSIONS),
  };
  await saveAll(all);
  return {ok: true, version, notes: checked.notes};
}

/** "Go back": saves version `v` again as the newest version. */
export async function restorePlanVersion(
  loopId: string,
  v: number,
  tools: PlanTools,
  now = Date.now(),
): Promise<
  {ok: true; version: PlanVersion; notes: string[]} | {ok: false; error: string}
> {
  const old = (await planVersions(loopId)).find(x => x.v === v);
  if (!old) {
    return {ok: false, error: 'That version is no longer kept'};
  }
  return savePlanEdit(loopId, old.plan, tools, `Back to version ${v}`, now);
}

/**
 * Start on a plan loop ("Looks right, start" after the plan's dry run):
 * the loop is saved like any custom loop (same hard limits), marked as a
 * plan, and its steps saved as version 1.
 */
export async function startPlanLoop(
  input: LoopInput,
  plan: Plan,
  tools: PlanTools,
): Promise<{ok: true; loop: Loop} | {ok: false; error: string}> {
  const checked = validatePlan(plan, tools);
  if (!checked.plan.steps.length) {
    return {ok: false, error: 'A plan needs at least one step'};
  }
  const started = await startLoop({
    ...input,
    kind: 'plan',
    custom: {
      title: input.custom?.title ?? '',
      prompt: planText(checked.plan) || (input.custom?.prompt ?? ''),
    },
  });
  if (!started.ok) {
    return started;
  }
  const saved = await savePlanVersion(
    started.loop.id,
    checked.plan,
    'Made',
    tools,
  );
  return saved.ok ? started : saved;
}

/**
 * The user saved the plan's steps (a new version): the loop's card text
 * follows, and its log says so.
 */
export async function savePlanEdit(
  loopId: string,
  plan: Plan,
  tools: PlanTools,
  note = 'Edited',
  now = Date.now(),
): Promise<
  {ok: true; version: PlanVersion; notes: string[]} | {ok: false; error: string}
> {
  const r = await savePlanVersion(loopId, plan, note, tools, now);
  if (r.ok) {
    await updateLoop(loopId, l =>
      addLog(
        {...l, prompt: cleanCustomPrompt(planText(r.version.plan))},
        `Plan: ${note.toLowerCase()} (version ${r.version.v})`,
        now,
      ),
    );
  }
  return r;
}

/** Last run's result fingerprints (for "changed since the last run"). */
export async function lastResultsOf(
  loopId: string,
): Promise<Record<string, string>> {
  return (await loadAll())[loopId]?.lastResults ?? {};
}

/** After a finished run: keeps each step's result fingerprint. */
export async function keepLastResults(
  loopId: string,
  results: Record<string, string>,
): Promise<void> {
  const all = await loadAll();
  const rec = all[loopId];
  if (!rec) {
    return;
  }
  all[loopId] = {
    ...rec,
    lastResults: Object.fromEntries(
      Object.entries(results).map(([k, r]) => [k, fingerprint(r)]),
    ),
  };
  await saveAll(all);
}
