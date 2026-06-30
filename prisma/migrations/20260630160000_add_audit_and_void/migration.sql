-- Fraud controls: append-only audit log + sale void fields

CREATE TABLE "audit_events" (
  "id"              TEXT         NOT NULL,
  "organization_id" TEXT         NOT NULL,
  "branch_id"       TEXT,
  "actor_id"        TEXT         NOT NULL,
  "actor_name"      TEXT         NOT NULL,
  "approved_by_id"  TEXT,
  "action"          TEXT         NOT NULL,
  "target_type"     TEXT,
  "target_id"       TEXT,
  "metadata"        JSONB,
  "device_id"       TEXT,
  "was_offline"     BOOLEAN      NOT NULL DEFAULT false,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");
CREATE INDEX "audit_events_branch_id_created_at_idx" ON "audit_events"("branch_id", "created_at");
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

ALTER TABLE "sales"
  ADD COLUMN "voided_at"     TIMESTAMP(3),
  ADD COLUMN "voided_by_id"  TEXT,
  ADD COLUMN "void_reason"   TEXT;
