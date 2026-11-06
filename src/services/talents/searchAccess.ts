import type {SearchProvider, PageContent} from '../search/types';

/**
 * Injected at `registerDefaultTalents()` so the search engines never import
 * `SearchProviderStore` — keeps `execute()` free of MobX/store coupling.
 */
export interface SearchAccess {
  getActiveProvider(): SearchProvider;
  /**
   * True only when the user has consented AND the active provider has a key.
   * Consent is enforced here, not just in the Settings UI.
   */
  canSearch(): boolean;
  /**
   * True when the user has consented to web access, key or not. Reading a
   * page the phone fetches itself needs no provider key.
   */
  canRead?(): boolean;
  getResultCount(): number;
  readWithDefaultReader(
    url: string,
    signal?: AbortSignal,
  ): Promise<PageContent>;
}
