-- Configurable RBAC: role permission toggles per organization

CREATE TABLE "role_permissions" (
  "id"              TEXT        NOT NULL,
  "organization_id" TEXT        NOT NULL,
  "role"            "Role"      NOT NULL,
  "permission"      TEXT        NOT NULL,
  "granted"         BOOLEAN     NOT NULL DEFAULT false,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_permissions_organization_id_role_permission_key"
  ON "role_permissions"("organization_id", "role", "permission");

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
