import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type {AppSchema} from '@nozbe/watermelondb';
import type {SchemaMigrations} from '@nozbe/watermelondb/Schema/migrations';

/**
 * Windows: WatermelonDB's own JavaScript database (LokiJS), since its SQLite
 * code has no Windows version. It keeps chats in memory for now, so they are
 * lost when the app closes (TODO: save it with the Windows storage module).
 */
export function createAdapter(schema: AppSchema, migrations: SchemaMigrations) {
  return new LokiJSAdapter({
    schema,
    migrations,
    dbName: 'pocketpalai',
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    onSetUpError: error => {
      console.error('Database setup error:', error);
    },
  });
}
