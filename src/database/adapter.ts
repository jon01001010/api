import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import type {AppSchema} from '@nozbe/watermelondb';
import type {SchemaMigrations} from '@nozbe/watermelondb/Schema/migrations';

/** The phone's database: SQLite (unchanged from before the Windows work). */
export function createAdapter(schema: AppSchema, migrations: SchemaMigrations) {
  return new SQLiteAdapter({
    schema,
    migrations,
    dbName: 'pocketpalai',
    jsi: true, // enable JSI for better performance if available
    onSetUpError: error => {
      console.error('Database setup error:', error);
    },
  });
}
