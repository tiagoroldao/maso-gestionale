# Custom build, with SDI transmission delegated to an intermediary

We are building a custom management app for a single plumbing business rather than adopting an off-the-shelf Italian gestionale or extending Odoo Community with OCA `l10n-italy`. The business needs Jobs, Visits, Sites and Installed Equipment modelled tightly together with invoicing and compliance documents, which off-the-shelf tools either lack (Odoo Field Service is Enterprise-only) or force into a generic shape. The one area we deliberately do not build ourselves is transmission to the Sistema di Interscambio (SDI): that is delegated to an accredited intermediary API, or done manually by exporting the FatturaPA XML, because it carries the highest legal/compliance risk for the least product value.

## Considered Options

- **Off-the-shelf (Danea Easyfatt, Fatture in Cloud, TeamSystem) + a field-service app**: rejected; data split across tools, no link between Installed Equipment, Visits and invoices.
- **Odoo Community + OCA `l10n-italy`**: strongest alternative (FatturaPA, stock, QWeb reports out of the box); rejected because field service and the Site/Equipment model would be custom anyway, and the platform's upgrade burden outweighs the reuse for a ~10 person business.
- **Direct SDI accreditation**: rejected; heavy compliance burden for one business.
