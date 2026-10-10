import type { DatabaseRuntime } from '@pipong/database';
import {
  processErasures,
  processRetention,
  reconcileDeliveryRecovery,
  writeTelemetry,
} from '@pipong/service';

export async function runRetention(database: DatabaseRuntime): Promise<void> {
  try {
    await processErasures(database);
  } catch {
    writeTelemetry({ event: 'erasure_scan_failed' });
  }
  try {
    await reconcileDeliveryRecovery(database);
  } catch {
    writeTelemetry({ event: 'recovery_scan_failed' });
  }
  try {
    await processRetention(database);
  } catch {
    writeTelemetry({ event: 'retention_scan_failed' });
  }
}
