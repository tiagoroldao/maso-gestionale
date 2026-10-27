# One business per Instance, many Instances, no multi-tenancy

Each business runs its own Instance on its own hardware (see ADR 0002), holding only its own data. The system is deliberately not multi-tenant: no tenant IDs, no shared database, nothing shared between Instances. Everything company-specific (company details, logo, tax regime, invoice numbering, SDI credentials) is a setting, never hard-coded, so the same release serves every business.

## Consequences

- Settings are split between **Instance settings** (Superuser: SDI mode and credentials, polling and webhook, backups, public URL, Admin account recovery, updates) and **company settings** (Admin: company details, invoice numbering, rates, Categories, Payment Terms, VAT defaults, Document Templates, users).
- The Admin sets the starting invoice number per sequence and year; it locks once the first invoice in that sequence and year is finalised, so later edits can't create duplicate numbers or gaps.
- The Superuser has no access to business data by default; support access requires the Admin to grant a business role, which keeps GDPR roles clear.
- Releases ship as versioned Docker images. The Superuser applies updates by hand; each update takes an automatic backup and then runs database migrations.
