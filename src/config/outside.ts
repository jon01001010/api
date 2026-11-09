/**
 * PocketAgent contacts no outside service on its own (no Google, no
 * PocketPal servers). These switches keep PocketPal's original code in
 * place but unused (2026-11-09 audit):
 *
 * - Reports and shared benchmarks went to PocketPal's Firebase service
 *   (Google App Check, after a google.com connectivity probe). Off: they are
 *   refused before any connection; the model error report is copied instead.
 * - Device rules (recommended models per phone) were downloaded from
 *   cdn.jsdelivr.net at every start. Off: the rules built into the app are
 *   used (the desktop app never downloaded them).
 */
export const OUTSIDE_REPORTS = false;
export const ONLINE_DEVICE_RULES = false;

export const REPORTS_OFF_MESSAGE =
  'Sending reports is off in PocketAgent: it contacts no outside service on its own.';
