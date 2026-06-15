## Summary

- 

## Client scope

- [ ] TROCCO endpoint path or method
- [ ] Request serialization
- [ ] Response parsing
- [ ] Error classification
- [ ] Retry/rate-limit behavior
- [ ] Tests or smoke coverage

## Target tools

- [ ] update_datamart_definition
- [ ] run_datamart_job
- [ ] get_datamart_job_status
- [ ] Other:

## Review checklist

- [ ] HTTP method and endpoint are based on confirmed TROCCO API behavior.
- [ ] The client keeps authentication server-side and never returns secrets.
- [ ] Non-2xx responses are converted to structured MCP-safe errors.
- [ ] Update/run methods are separate from read-only methods.
- [ ] Logging avoids SQL, tokens, and sensitive request bodies unless intentionally redacted.

## Verification

- [ ] `npm run build`
- [ ] Local or HTTP smoke test, if credentials are available
- [ ] Related docs/schema/action PRs or issues are linked below.

Related:
