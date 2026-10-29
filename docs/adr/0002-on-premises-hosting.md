# On-premises hosting behind a Cloudflare Tunnel

The app runs on a single server at the business's premises (Docker Compose: app, Postgres, Gotenberg, backup job, `cloudflared`), not on a cloud host. Technicians reach it remotely through a Cloudflare Tunnel guarded by Cloudflare Access, so no inbound ports are opened. We chose on-prem because the businesses that own this system are small and often already have hardware from their previous setup that they want to keep using. The system has to run on whatever machine they own, not depend on a hosting account.

## Consequences

- Availability depends on the office's power and connection; downtime during outages is accepted. A UPS is required.
- Nightly encrypted off-site backups (EU object storage) and a tested restore procedure are mandatory before go-live.
- The app is not the legal archive for electronic invoices; _conservazione a norma_ is delegated to the Agenzia delle Entrate service or the SDI intermediary (Openapi's paid option, ADR 0019).
- SDI outcomes are fetched by polling (see ADR 0019), so the app works without any public inbound route; webhooks through the tunnel are optional.
