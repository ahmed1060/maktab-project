-- Records' files removed from storage (RecordService). No record may be
-- given one again: its object is gone. A removal notes its files here, under
-- a lock on each file that giving a record that file takes too, so a file
-- can't gain a record as it's removed (CLIENTS_PLAN.md §0.2).
--
-- Additive: main's code doesn't know this table and is unaffected by it.
CREATE TABLE "RemovedRecordFile" (
    "path" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemovedRecordFile_pkey" PRIMARY KEY ("path")
);
