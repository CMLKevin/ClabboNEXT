export interface ReplayStore {
  markIfNew(key: string, ttlSeconds: number): Promise<boolean>;
  close(): Promise<void>;
}
