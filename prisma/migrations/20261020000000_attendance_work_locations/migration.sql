-- Where people check in with the app (ATTENDANCE_PLAN.md §8.5, §9.4).
CREATE TABLE "WorkLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "officeIpRanges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "everyone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "WorkLocation_pkey" PRIMARY KEY ("id"),
    -- A real place, and a circle a phone's fix can mean something in.
    CONSTRAINT "WorkLocation_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
    CONSTRAINT "WorkLocation_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180),
    CONSTRAINT "WorkLocation_radius_check" CHECK ("radiusMeters" BETWEEN 20 AND 5000)
);

CREATE TABLE "UserWorkLocation" (
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWorkLocation_pkey" PRIMARY KEY ("userId","locationId")
);

CREATE INDEX "WorkLocation_companyId_idx" ON "WorkLocation"("companyId");
CREATE INDEX "UserWorkLocation_locationId_idx" ON "UserWorkLocation"("locationId");

ALTER TABLE "WorkLocation" ADD CONSTRAINT "WorkLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserWorkLocation" ADD CONSTRAINT "UserWorkLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserWorkLocation" ADD CONSTRAINT "UserWorkLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WorkLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
