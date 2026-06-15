## Summary

- 

## Schema scope

- [ ] Request schema
- [ ] Response schema
- [ ] Error payload schema
- [ ] Normalized status/value mapping
- [ ] Example payloads

## Target tools

- [ ] update_datamart_definition
- [ ] run_datamart_job
- [ ] get_datamart_job_status
- [ ] Other:

## Review checklist

- [ ] Required and optional fields are explicit.
- [ ] Unknown or unconfirmed TROCCO API fields are marked as provisional.
- [ ] Write/run actions require an explicit confirmation field where appropriate.
- [ ] Error payloads preserve TROCCO status, endpoint, and raw detail when safe.
- [ ] Schema examples avoid secrets and irreversible production examples.

## Verification

- [ ] Schema examples are valid JSON.
- [ ] TypeScript/Zod changes compile when applicable.
- [ ] Related docs/client/action PRs or issues are linked below.

Related:
