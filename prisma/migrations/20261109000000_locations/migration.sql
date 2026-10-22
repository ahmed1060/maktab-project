-- Locations (CLIENTS_PLAN.md §2, step 1): the places tasks happen at. A
-- client's HQ, its branches and sites, and shared places no client owns.
--
-- Additive: the release before doesn't know this table. It creates clients
-- without an HQ while this waits for review; this release lets a client's
-- first location be its HQ, and the next migration gives the rest one.

CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "isHq" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeters" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id"),
    -- A pin is a point: both coordinates, or neither ("Needs a pin").
    CONSTRAINT "Location_pin_whole" CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
    CONSTRAINT "Location_pin_on_earth" CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180),
    -- The check radius, as for check-in places; none is the default, 70 m.
    CONSTRAINT "Location_radius_range" CHECK ("radiusMeters" BETWEEN 20 AND 5000),
    -- An HQ is a client's, and in use.
    CONSTRAINT "Location_hq_of_client" CHECK (NOT "isHq" OR ("clientId" IS NOT NULL AND "archivedAt" IS NULL))
);

-- No page lists every company's locations at once, and the client's page
-- lists its own.
CREATE INDEX "Location_companyId_idx" ON "Location"("companyId");
CREATE INDEX "Location_clientId_idx" ON "Location"("clientId");

-- A client has one HQ at most (exactly one once the next migration gives an
-- HQ to clients made while this waited for review).
CREATE UNIQUE INDEX "Location_one_hq_per_client" ON "Location"("clientId") WHERE "isHq";

ALTER TABLE "Location" ADD CONSTRAINT "Location_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Location" ADD CONSTRAINT "Location_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Location" ADD CONSTRAINT "Location_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Like every table, reached only through the app (DATABASE_SETUP.md).
ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;

-- Each client's one location becomes its HQ (§2.8), its pin read from the
-- map link the place search gave it ("?q=lat,lng" or "query=lat,lng"). A
-- location typed by hand has none: it "Needs a pin".
INSERT INTO "Location" ("id", "companyId", "clientId", "name", "isHq", "latitude", "longitude", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."companyId", c."id", c."locationName", true,
       CASE WHEN p.lat BETWEEN -90 AND 90 AND p.lng BETWEEN -180 AND 180 THEN p.lat END,
       CASE WHEN p.lat BETWEEN -90 AND 90 AND p.lng BETWEEN -180 AND 180 THEN p.lng END,
       c."createdById", now(), now()
FROM "Client" c
LEFT JOIN LATERAL (
    SELECT m[1]::double precision AS lat, m[2]::double precision AS lng
    FROM regexp_match(coalesce(c."locationLink", ''), '[?&](?:q|query)=(-?[0-9]+(?:\.[0-9]+)?),\s*(-?[0-9]+(?:\.[0-9]+)?)') AS m
    WHERE m IS NOT NULL
) p ON true
WHERE NOT EXISTS (SELECT 1 FROM "Location" l WHERE l."clientId" = c."id" AND l."isHq");
