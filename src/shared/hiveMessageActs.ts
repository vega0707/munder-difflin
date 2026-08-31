/** Acts a hive message may carry. Shared so the builtin runner does not import hive.ts. */
export type MessageAct = 'request' | 'inform' | 'propose' | 'query' | 'agree' | 'refuse' | 'done';
