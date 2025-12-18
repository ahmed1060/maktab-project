-- CreateTable
CREATE TABLE "ProfileUpdateRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldFirstName" TEXT NOT NULL,
    "oldLastName" TEXT NOT NULL,
    "newFirstName" TEXT NOT NULL,
    "newLastName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileUpdateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileUpdateRequest_userId_idx" ON "ProfileUpdateRequest"("userId");

-- CreateIndex
CREATE INDEX "ProfileUpdateRequest_status_idx" ON "ProfileUpdateRequest"("status");

-- AddForeignKey
ALTER TABLE "ProfileUpdateRequest" ADD CONSTRAINT "ProfileUpdateRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
