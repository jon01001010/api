/** Closed request schema: no tools, paths, remote URLs, extra generation options or history. */
export function parseCompletion(body: string) {
  const value = JSON.parse(body);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  const allowed = new Set([
    'model',
    'messages',
    'max_tokens',
    'temperature',
    'stream',
  ]);
  if (
    Object.keys(value).some(key => !allowed.has(key)) ||
    value.model !== 'local' ||
    (value.stream !== undefined && value.stream !== false)
  ) {
    throw new Error(
      'Only model=local and non-streaming text requests are supported',
    );
  }
  if (
    !Array.isArray(value.messages) ||
    !value.messages.length ||
    value.messages.length > 32
  ) {
    throw new Error('Supply between 1 and 32 messages');
  }
  let chars = 0;
  const messages: {role: string; content: string}[] = value.messages.map(
    (m: unknown) => {
      if (!m || typeof m !== 'object' || Array.isArray(m)) {
        throw new Error('Invalid message');
      }
      const message = m as Record<string, unknown>;
      if (
        Object.keys(message).some(k => k !== 'role' && k !== 'content') ||
        !['system', 'user', 'assistant'].includes(message.role as string) ||
        typeof message.content !== 'string'
      ) {
        throw new Error('Text messages only');
      }
      chars += message.content.length;
      return {role: message.role as string, content: message.content};
    },
  );
  if (chars > 16000) {
    throw new Error('Prompt too large');
  }
  const maxTokens = value.max_tokens ?? 256;
  const temperature = value.temperature ?? 0.7;
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > 512 ||
    typeof temperature !== 'number' ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2
  ) {
    throw new Error('Invalid generation limits');
  }
  return {
    messages,
    maxTokens: maxTokens as number,
    temperature: temperature as number,
  };
}
