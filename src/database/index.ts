import {Database} from '@nozbe/watermelondb';
import {createAdapter} from './adapter';
import schema from './schema';
import migrations from './migrations';
import {
  ChatSession,
  Message,
  CompletionSetting,
  GlobalSetting,
  CachedPal,
  UserLibrary,
  SyncStatus,
  LocalPal,
} from './models';

// SQLite on the phone; a JavaScript database on Windows (adapter.windows.ts).
const adapter = createAdapter(schema, migrations);

export const database = new Database({
  adapter,
  modelClasses: [
    ChatSession,
    Message,
    CompletionSetting,
    GlobalSetting,
    CachedPal,
    UserLibrary,
    SyncStatus,
    LocalPal,
  ],
});

export {
  ChatSession,
  Message,
  CompletionSetting,
  GlobalSetting,
  CachedPal,
  UserLibrary,
  SyncStatus,
  LocalPal,
};
