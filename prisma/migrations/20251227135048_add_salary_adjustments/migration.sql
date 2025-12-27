-- CreateTable
CREATE TABLE "SalaryAdjustment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryAdjustment_userId_idx" ON "SalaryAdjustment"("userId");

-- CreateIndex
CREATE INDEX "SalaryAdjustment_type_idx" ON "SalaryAdjustment"("type");

-- CreateIndex
CREATE INDEX "SalaryAdjustment_status_idx" ON "SalaryAdjustment"("status");

-- AddForeignKey
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
