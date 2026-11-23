-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "previousTokenHash" TEXT;

-- CreateIndex
CREATE INDEX "sessions_previousTokenHash_idx" ON "sessions"("previousTokenHash");
