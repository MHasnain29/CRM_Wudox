-- Backfill role approval capabilities for global database workflows added after initial RBAC seed.

INSERT INTO "role_approval_capabilities" ("role_id", "workflow", "mode")
SELECT r.id, wf.workflow::"ApprovalWorkflowType", wf.mode::"ApprovalActorMode"
FROM "rbac_roles" r
CROSS JOIN (
  VALUES
    ('database_client_add', 'forward_final'),
    ('database_client_import', 'forward_final')
) AS wf(workflow, mode)
WHERE r.key IN ('super_admin', 'director', 'company_director')
ON CONFLICT ("role_id", "workflow") DO UPDATE SET "mode" = EXCLUDED."mode";

INSERT INTO "role_approval_capabilities" ("role_id", "workflow", "mode")
SELECT r.id, wf.workflow::"ApprovalWorkflowType", wf.mode::"ApprovalActorMode"
FROM "rbac_roles" r
CROSS JOIN (
  VALUES
    ('database_client_add', 'forward_only'),
    ('database_client_import', 'forward_only')
) AS wf(workflow, mode)
WHERE r.key = 'operations_manager'
ON CONFLICT ("role_id", "workflow") DO UPDATE SET "mode" = EXCLUDED."mode";
