## Summary

- 

## Action scope

- [ ] New MCP tool
- [ ] Existing MCP tool behavior change
- [ ] Write/update action
- [ ] Run/execute action
- [ ] Read/status action

## Target tools

- [ ] update_datamart_definition
- [ ] run_datamart_job
- [ ] get_datamart_job_status
- [ ] Other:

## Operational risk

- Risk level: low / medium / high
- Production resource impact:
- Required confirmation field:
- Rollback or stop condition:

## Review checklist

- [ ] Tool input uses Zod validation and rejects ambiguous identifiers.
- [ ] Write/run actions require explicit confirmation, for example `confirm: true`.
- [ ] The response includes `ok`, normalized identifiers, and raw TROCCO detail when safe.
- [ ] The tool returns structured errors instead of throwing unhandled exceptions.
- [ ] Docs and schema changes are included or linked.
- [ ] Smoke-test instructions cover both success and guarded-failure behavior.

## Verification

- [ ] `npm run build`
- [ ] Tool listed by MCP client
- [ ] Guarded write/run call fails without confirmation
- [ ] Confirmed call tested in a safe environment, or explicitly deferred

Related:
