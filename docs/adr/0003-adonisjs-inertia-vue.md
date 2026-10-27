# AdonisJS + Inertia + Vue as the full-stack framework

The app is a single AdonisJS (TypeScript) application rendering Vue pages through Inertia, rather than a Vue SPA with a separate API or a Nuxt app. The workload is CRUD, permissions, background jobs and PDFs for one business; a batteries-included framework (ORM, migrations, auth, validation, scheduler) removes most glue code, Inertia avoids maintaining a separate API, and TypeScript is kept end to end.

## Considered Options

- **Nuxt**: same language, but Nitro is thin; ORM, auth, jobs and scheduling would be assembled by hand.
- **Vue SPA + separate TS API (Fastify/Hono/NestJS)**: most flexible, most glue; no second client justifies a public API.
- **Laravel + Inertia + Vue**: most mature ecosystem and easier to hand over in Italy; rejected to stay in TypeScript.
