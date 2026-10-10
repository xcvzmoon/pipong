import type { DatabaseRuntime } from '@pipong/database';
import { processErasures, processRetention, reconcileDeliveryRecovery } from '@pipong/service';

export async function runRetention(database: DatabaseRuntime): Promise<void> {
  try {
    await processErasures(database);
  } catch {
    console.error('ERASURE_SCAN_FAILED: cleanup will retry on the next scan');
  }
  try {
    await reconcileDeliveryRecovery(database);
  } catch {
    console.error('DELIVERY_RECOVERY_SCAN_FAILED: recovery will retry on the next scan');
  }
  try {
    await processRetention(database);
  } catch {
    console.error('RETENTION_SCAN_FAILED: cleanup will retry on the next scan');
  }
}
