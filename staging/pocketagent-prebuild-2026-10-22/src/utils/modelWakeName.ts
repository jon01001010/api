/** Name matching only. Does not activate the microphone or start recognition. */
export function cleanModelName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (!cleaned || cleaned.length > 32 || !/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u.test(cleaned)) {
    throw new Error('Choose a name of 1–32 letters/numbers (spaces allowed).');
  }
  return cleaned;
}
export function matchesWakeName(transcript: string, name: string): boolean {
  if (!name.trim()) return false;
  const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const heard = normalized(transcript);
  const wake = normalized(name);
  return heard === wake || heard.startsWith(`hey ${wake} `) || heard === `hey ${wake}` || heard.startsWith(`${wake} `);
}
