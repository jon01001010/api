/**
 * Cloud chat APIs with one-tap setup in Add remote model. All take an API
 * key; several have free tiers (limits change, see each provider's page).
 */
import type {ServerType} from '../utils/serverTypes';

export interface CloudPreset {
  id: string;
  label: string;
  /** Server address the app stores (the app adds /v1/... where needed). */
  url: string;
  serverType: ServerType;
  /** Where to create an API key. */
  keyUrl: string;
  /** Has a free tier (with daily limits). */
  free?: boolean;
}

export const CLOUD_PRESETS: CloudPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    url: 'https://api.openai.com/v1',
    serverType: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'claude',
    label: 'Claude',
    url: 'https://api.anthropic.com',
    serverType: 'Claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    url: 'https://api.deepseek.com',
    serverType: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    // Google's OpenAI-compatible endpoint (not under /v1).
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    serverType: 'Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    free: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    url: 'https://api.groq.com/openai/v1',
    serverType: 'OpenAI',
    keyUrl: 'https://console.groq.com/keys',
    free: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1',
    serverType: 'OpenAI',
    keyUrl: 'https://openrouter.ai/keys',
    free: true,
  },
];

const sameUrl = (a: string, b: string) =>
  a.trim().replace(/\/+$/, '').toLowerCase() ===
  b.trim().replace(/\/+$/, '').toLowerCase();

/** The preset for this server address, if it is one. */
export const presetForUrl = (url: string): CloudPreset | undefined =>
  CLOUD_PRESETS.find(p => sameUrl(p.url, url));

const ANTHROPIC_URL = /^https:\/\/api\.anthropic\.com(\/|$)/i;

/**
 * The type a server is used as. Claude means the Anthropic engine, which only
 * talks to api.anthropic.com, so the address decides: a Claude-typed server
 * repointed at, say, Gemini uses that preset's type (else `unknown`), and an
 * Anthropic address is always Claude.
 */
export function effectiveServerType(
  serverType: ServerType,
  url: string | undefined,
): ServerType {
  const isAnthropic = !!url && ANTHROPIC_URL.test(url.trim());
  if (isAnthropic) {
    return 'Claude';
  }
  if (serverType === 'Claude') {
    return (url && presetForUrl(url)?.serverType) || 'unknown';
  }
  return serverType;
}
