# VAT Codes and VAT defaults are Admin-editable settings, seeded and reviewed later

Which VAT applies to a plumbing invoice depends on the Customer, the building and the kind of work: 22% by default, 10% on residential maintenance and renovation (with a cap on _beni significativi_), reverse charge for installation work billed to businesses, and more. The business's commercialista hasn't confirmed the exact rules yet, and rules change. So VAT Codes (rate, or 0% with a FatturaPA Natura code, plus a legal note for the invoice) are a table the Admin manages, and the defaults that pick a code for a new invoice line will be a second table keyed by Customer type, Work Category and line kind (#26). Both are seeded with our best reading of the law and reviewed by the commercialista in the app, without a release (#17). Every line's code can still be changed by hand.

## Considered Options

- **VAT rules in code:** simpler and testable, but each correction from the commercialista would need a developer and an update, and invoicing would wait on answers the business doesn't have yet.
- **A fixed VAT rate per Item:** what Items had before. Wrong for this trade: the same boiler is 22% sold over the counter and 10% installed in a home, so the rate depends on the work, not the article.

## Consequences

- Invoice lines copy the code's rate and Natura when they're written, so editing or archiving a code never changes an issued invoice. Codes are archived, never deleted.
- The facts the defaults need are recorded where they belong: a residential flag on the Site, a Work Category on the Job, a significant-good flag on the Item, and an _Ente / associazione_ Customer type.
- Mechanisms not yet needed (withholding tax for condominiums, split payment for public bodies, the automatic _beni significativi_ split, stamp duty) are `proposal` issues (#56–#61). Until then Office handles those cases by hand with the right VAT Codes and notes.
