-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Request" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER,
    "message" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Request_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Request_id_key" ON "Request"("id");
CREATE INDEX "Event_startsAt_id_idx" ON "Event"("startsAt", "id");
CREATE INDEX "Request_eventId_createdAt_sequence_idx" ON "Request"("eventId", "createdAt", "sequence");
CREATE INDEX "Request_userId_createdAt_sequence_idx" ON "Request"("userId", "createdAt", "sequence");
