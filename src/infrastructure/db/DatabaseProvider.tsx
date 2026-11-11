import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import type { PropsWithChildren } from 'react';
import { migrateDatabase } from './migrations';
import { ensureJourney } from './repositories/journeyRepository';

async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
  await migrateDatabase(db);
  await ensureJourney(db);
}

export function DatabaseProvider({ children }: PropsWithChildren) {
  return (
    <SQLiteProvider databaseName="growai.db" onInit={initializeDatabase} useSuspense>
      {children}
    </SQLiteProvider>
  );
}
