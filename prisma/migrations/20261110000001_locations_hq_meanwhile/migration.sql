-- An HQ for each client the release before locations added while they
-- waited for review (CLIENTS_PLAN.md §2.8), as locations' own migration made
-- one for every client there then: its location, with the pin from its map
-- link when it has one. A client given an HQ since, from the Locations page
-- or its own, keeps it; one given an HQ while this runs too.
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
WHERE NOT EXISTS (SELECT 1 FROM "Location" l WHERE l."clientId" = c."id" AND l."isHq")
ON CONFLICT ("clientId") WHERE "isHq" DO NOTHING;
