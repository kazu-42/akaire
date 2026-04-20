// Workers 環境バインディング型定義

export type SyncEvent =
  | { kind: "annotation_created"; id: string }
  | { kind: "annotation_updated"; id: string }
  | { kind: "reply_created"; id: string; annotation_id: string };

export interface Env {
  DB: D1Database;
  SYNC_QUEUE: Queue<SyncEvent>;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_APP_AUD: string;
}
