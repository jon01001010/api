import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type {AppSchema} from '@nozbe/watermelondb';
import type {SchemaMigrations} from '@nozbe/watermelondb/Schema/migrations';

/**
 * Web (the Windows app via Tauri): WatermelonDB's own JavaScript database
 * (LokiJS), saved in the browser's storage (IndexedDB), so chats are kept
 * between launches.
 */
export function createAdapter(schema: AppSchema, migrations: SchemaMigrations) {
  return new LokiJSAdapter({
    schema,
    migrations,
    dbName: 'pocketpalai',
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    onSetUpError: error => {
      console.error('Database setup error:', error);
    },
  });
}
