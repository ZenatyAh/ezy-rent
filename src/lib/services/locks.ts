import type { Prisma } from '@/generated/prisma/client'

// Every money-changing operation (recording with its cap, approve, reject, void, the webhook's
// allocation) starts by locking the lease row. That serializes them per lease: a second request waits,
// then re-reads the payment status and balances it needs. The lock is released when the transaction ends.
export async function lockLease(tx: Prisma.TransactionClient, leaseId: string): Promise<void> {
  await tx.$queryRaw`select id from leases where id = ${leaseId}::uuid for update`
}
