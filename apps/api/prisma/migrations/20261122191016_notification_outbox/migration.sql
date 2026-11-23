-- AlterTable
ALTER TABLE "communication_logs" ADD COLUMN     "nextAttemptAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "communication_logs_status_nextAttemptAt_idx" ON "communication_logs"("status", "nextAttemptAt");
