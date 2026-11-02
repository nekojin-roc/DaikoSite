CREATE TABLE "Group" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL
);
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");
CREATE UNIQUE INDEX "Group_name_nocase_key" ON "Group"("name" COLLATE NOCASE);
CREATE TABLE "Member" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  CONSTRAINT "Member_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Member_groupId_name_key" ON "Member"("groupId", "name");
CREATE UNIQUE INDEX "Member_groupId_name_nocase_key" ON "Member"("groupId", "name" COLLATE NOCASE);
CREATE TABLE "Offering" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Offering_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Offering_groupId_archived_idx" ON "Offering"("groupId", "archived");
CREATE UNIQUE INDEX "Offering_groupId_active_name_nocase_key" ON "Offering"("groupId", "name" COLLATE NOCASE) WHERE "archived" = false;
ALTER TABLE "Event" ADD COLUMN "groupId" TEXT REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Request" ADD COLUMN "memberName" TEXT;
ALTER TABLE "Request" ADD COLUMN "offeringName" TEXT;
ALTER TABLE "Request" ADD COLUMN "imageFile" TEXT;
-- Link pre-existing events while retaining their original groupName snapshots.
INSERT INTO "Group" ("id", "name")
SELECT lower(hex(randomblob(16))), MIN("groupName") FROM "Event"
WHERE length(trim("groupName")) > 0 GROUP BY "groupName" COLLATE NOCASE;
UPDATE "Event" SET "groupId" = (SELECT "id" FROM "Group" WHERE "Group"."name" = "Event"."groupName" COLLATE NOCASE LIMIT 1);
