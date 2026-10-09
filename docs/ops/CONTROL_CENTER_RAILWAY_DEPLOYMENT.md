# Control Center — Railway repo-backed deployment

**Service:** `control-center`  
**Project:** `MR עדולם`  
**Environment:** `production`  
**Status before migration:** Railway Bun Function

## Why this migration is required

The Control Center outgrew Railway Function's inline-code launch mechanism.

The failed deployment on 2026-10-09 reported:

`exec container process /app/./run.sh: Argument list too long`

The Function runtime encodes the entire TypeScript source into the start-command argument. As `services/control-center/index.ts` grew with W8 Production, Quality, Landed Cost and Traceability surfaces, the encoded argument exceeded the operating-system process argument limit.

This is a deployment packaging failure, not an application health or Catalog API failure.

## Desired Railway source

Use the existing Railway service; do not create a second Control Center.

Source:

- repository: `Samuelcastella/mr-platform`
- branch: `main`
- root directory: `services/control-center`
- builder: `RAILPACK`
- start command: `bun run index.ts`
- healthcheck: `/health`
- watch pattern: `services/control-center/**`
- replicas: 1 in the current production region

The service-local `package.json` declares:

- Bun 1.2.0;
- `start = bun run index.ts`.

## Variables

Preserve all existing Control Center variables.

At minimum, application behavior expects:

- `CATALOG_API_URL`
- optional `CONTROL_CENTER_SETUP_PATH`
- optional `BOOTSTRAP_API_TOKEN`

Never copy secret values into repository files or deployment documentation.

## Migration procedure

1. Confirm all GitHub CI for the repo-backed runtime is green.
2. Read the existing Railway service variables and domains.
3. Connect the existing `control-center` service to `Samuelcastella/mr-platform#main`.
4. Set root directory to `services/control-center`.
5. Set start command to `bun run index.ts`.
6. Keep `/health` as the Railway healthcheck.
7. Preserve the existing Railway service domain.
8. Deploy.
9. Wait for SUCCESS and one healthy replica.
10. Verify:
   - `GET /health`;
   - `GET /ready`;
   - StaffUser login;
   - Producción;
   - Calidad;
   - Costeo;
   - Trazabilidad;
   - CSRF protection on a state-changing form.
11. Record deployment ID and current `main` commit in issue #113.
12. Update `WEB_ROADMAP.md` only after production verification.

## Guardrails

Do not:

- create a replacement Railway project;
- create a duplicate Control Center service;
- change the public service domain unnecessarily;
- change Catalog API variables;
- commit Railway secrets to GitHub;
- commit unrelated staged Railway changes;
- use the Function inline-code runtime again.

## Rollback

If the repo-backed deployment fails:

- retain the same service/domain;
- inspect build/deploy logs;
- roll back only to the last known-good Control Center deployment if it is still runnable;
- do not restore the oversized inline Function payload as the long-term deployment mechanism.

## Evidence

Repository CI must prove:

- `services/control-center/package.json` starts the service;
- `/health` responds from the package-defined runtime;
- `services/control-center/index.ts` builds successfully with Bun.
