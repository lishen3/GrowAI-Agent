export interface DatabaseLike {
  execAsync(source: string): Promise<unknown>;
  runAsync(source: string, ...params: unknown[]): Promise<unknown>;
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>;
  withExclusiveTransactionAsync?(task: (tx: Pick<DatabaseLike, 'execAsync'|'runAsync'|'getFirstAsync'|'getAllAsync'>) => Promise<void>): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
