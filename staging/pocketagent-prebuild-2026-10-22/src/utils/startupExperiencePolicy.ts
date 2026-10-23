/** #36: Pure startup configuration; intentionally no microphone or tool side effects. */
export interface StartupPreferences {
  modelName?: string;
  wakeListeningEnabled?: boolean;
  toolsEnabled?: string[];
  simpleMode?: boolean;
  globalSystemPrompt?: string;
}
export interface StartupExperience {
  screen: 'model-picker' | 'chat';
  title: string;
  listening: false;
  enabledTools: string[];
  simpleMode: boolean;
  systemPrompt: string;
}
export function resolveStartupExperience(p: StartupPreferences, modelLoaded: boolean): StartupExperience {
  return {
    screen: modelLoaded ? 'chat' : 'model-picker',
    title: p.modelName?.trim() || 'PocketAgent',
    // Never automatically open the microphone on startup, regardless of stale preferences.
    listening: false,
    enabledTools: (p.toolsEnabled ?? []).filter(Boolean),
    simpleMode: p.simpleMode ?? true,
    systemPrompt: p.globalSystemPrompt ?? '',
  };
}
