-- CreateEnum
CREATE TYPE "ScenarioKind" AS ENUM ('DEGRADED', 'OUTAGE');

-- CreateEnum
CREATE TYPE "ScenarioStatus" AS ENUM ('RUNNING', 'FINISHED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "lastDemoResetAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "DemoScenario" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "kind" "ScenarioKind" NOT NULL,
    "status" "ScenarioStatus" NOT NULL DEFAULT 'RUNNING',
    "startedById" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DemoScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoScenario_organizationId_startedAt_idx" ON "DemoScenario"("organizationId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "DemoScenario_organizationId_status_idx" ON "DemoScenario"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "DemoScenario" ADD CONSTRAINT "DemoScenario_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoScenario" ADD CONSTRAINT "DemoScenario_serviceId_organizationId_fkey" FOREIGN KEY ("serviceId", "organizationId") REFERENCES "Service"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoScenario" ADD CONSTRAINT "DemoScenario_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
