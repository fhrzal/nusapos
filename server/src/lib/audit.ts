import type { Request } from 'express';
import { run } from '../db';

/** Catat aktivitas penting ke audit trail (tidak dapat diubah dari aplikasi). */
export function audit(
  req: Request | null,
  action: string,
  entity?: string | null,
  entityId?: number | null,
  details?: unknown,
  storeId?: number | null,
) {
  run(
    `INSERT INTO audit_logs(user_id, store_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    req?.user?.id ?? null,
    storeId ?? req?.user?.store_id ?? null,
    action,
    entity ?? null,
    entityId ?? null,
    details === undefined ? null : JSON.stringify(details),
    req?.ip ?? null,
  );
}
