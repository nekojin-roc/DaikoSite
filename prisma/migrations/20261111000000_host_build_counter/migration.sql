-- Existing installations are already running build 8; future releases increment
-- the single row on the production host, not during migrations or startup.
CREATE TABLE "BuildCounter" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "value" INTEGER NOT NULL
);
INSERT INTO "BuildCounter" ("id", "value") VALUES (1, 8);
