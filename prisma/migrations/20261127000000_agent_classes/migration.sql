-- Agent roles become three classes on a ladder: working, manager, merger.
--   observer, contributor, triager, reviewer -> working
--   dispatcher, merger                        -> manager
--   admin_merger                              -> merger
-- Today's `merger` becomes `manager` while `admin_merger` takes the name
-- `merger`, so each column is converted in a single statement.

-- Record every agent's old role first, so the change can be audited or reversed.
INSERT INTO "AgentAuditEvent" ("id", "tenantId", "agentId", "action", "payload", "createdAt")
SELECT gen_random_uuid()::text, "tenantId", "id", 'level.migrated',
       jsonb_build_object('from', "level"::text, 'to',
         CASE "level"::text
           WHEN 'admin_merger' THEN 'merger'
           WHEN 'merger' THEN 'manager'
           WHEN 'dispatcher' THEN 'manager'
           ELSE 'working'
         END),
       now()
FROM "Agent";

ALTER TYPE "AgentLevel" RENAME TO "AgentLevel_old";
CREATE TYPE "AgentLevel" AS ENUM ('working', 'manager', 'merger');

ALTER TABLE "Agent" ALTER COLUMN "level" DROP DEFAULT;
ALTER TABLE "Agent" ALTER COLUMN "level" TYPE "AgentLevel" USING (
  CASE "level"::text
    WHEN 'admin_merger' THEN 'merger'
    WHEN 'merger' THEN 'manager'
    WHEN 'dispatcher' THEN 'manager'
    ELSE 'working'
  END
)::"AgentLevel";
ALTER TABLE "Agent" ALTER COLUMN "level" SET DEFAULT 'working';

-- Searched CASE so a NULL proposed level stays NULL.
ALTER TABLE "AgentPairing" ALTER COLUMN "proposedLevel" TYPE "AgentLevel" USING (
  CASE
    WHEN "proposedLevel" IS NULL THEN NULL
    WHEN "proposedLevel"::text = 'admin_merger' THEN 'merger'
    WHEN "proposedLevel"::text IN ('merger', 'dispatcher') THEN 'manager'
    ELSE 'working'
  END
)::"AgentLevel";

DROP TYPE "AgentLevel_old";

-- Reviewer is no longer earned, so the eligibility notice has nothing to track.
ALTER TABLE "Agent" DROP COLUMN "reviewerEligibilityNotifiedAt";
