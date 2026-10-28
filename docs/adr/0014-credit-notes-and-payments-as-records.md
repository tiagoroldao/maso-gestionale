# Credit Notes, and Payments as records of what happened

A Credit Note is an invoice-type document (FatturaPA TD04) that credits one issued Invoice, partly or fully: it goes through the same lifecycle (draft, finalised, Submission, outcome) and builds its lines, VAT rows and totals the same way, with a link to the Invoice it credits. It can credit an Invoice SDI delivered or could not deliver (_impossibile recapitare_), both being issued documents; a rejected Invoice is corrected, never credited. The Credit Notes on one Invoice can never add up to more than its total, since legally each is a partial or total reversal (_storno_) of it: a document the business issues, so the limit is a hard rule.

What is owed on an Invoice is its total, less its Credit Notes, less its Payments, and it may go below zero. Payments and refunds are records of what happened, entered after the fact, so the app warns about anything unusual but never refuses it: a Payment above what is owed is recorded (with a warning), and so is a refund, a negative Payment, even beyond what was overpaid. Only what isn't a payment at all is refused (an amount of zero, a Payment on a draft). An Invoice whose amount owed is below zero is overpaid: a recording mistake (a Payment entered twice) or a Customer or business error, and either way it needs someone to act, so it is flagged and never counts as settled.

A Credit Note line credits an Invoice line by amount. A line credited in full credits the Charges it billed: each gets a "credited" event and stops being outstanding, like a Charge not billable but keeping its own meaning. It stays credited unless Office sets it back to "to bill" to bill the work again (ADR 0010). A line credited in part leaves its Charges billed. Crediting an Advance Invoice reduces what is left of it to take back (ADR 0011), and can't credit more than is still left.

Credit Notes take their numbers from the Invoice sequence or from a series of their own, as an Admin setting. Any change is warned about, since numbering must run unbroken through a year: it applies at once while no Credit Note has been numbered in the current year, and otherwise from the next 1 January. Decided by the business on 2026-10-28 (#24).

## Considered Options

- **A Credit Note as a separate amount on the Customer's balance:** fits Customers who pay several Invoices at once, but the app has no Customer account, and Payments already belong to one Invoice.
- **Hard limits on Payments** (until now: nothing above what is owed; corrections never below what is paid, #102): keeps the numbers tidy, but a record that can't be entered as it happened is worse than one flagged as odd.
- **Credited Charges back to "to bill" automatically:** a credit is often a write-off, and work back on the list invites billing it twice.
- **Fixed numbering:** simplest, but whether Credit Notes need their own series (_sezionale_) is the commercialista's call (#17).

## Consequences

- Payment status gains "overpaid", alongside paid, partly paid, unpaid and overdue, all derived.
- The refusals for a Payment above what is owed, and for correcting a rejected Invoice below what is paid (#102), become warnings.
- A Job is Closed only when its Invoices owe nothing after Credit Notes (an overpaid Invoice keeps it open); Invoiced follows credited Charges and advances (ADR 0010, 0011). (Refined by ADR 0015: this now defines the paid indicator; Office closes the Job.)
- How crediting works (#146):
  - **By line, before the global discount.** A Credit Note line credits its Invoice line's amount before the Invoice-wide discount, and a Credit Note always carries its Invoice's global discount, so the two compare on the same footing. The amounts recorded on Charges when billed stay before the discount too: an Invoice-wide discount is a price decision on the whole Invoice, not on any one Charge.
  - **Per-line limit.** A line's Credit Notes together never credit more than it, and Credit Note lines are never negative. Like the Invoice-wide limit, both are checked when a Credit Note is saved and finalised, with its Invoice locked.
  - **In full.** A line is credited in full once its Credit Notes past draft together reach its amount, whether one Credit Note does it or several. Its Charges get their "credited" event when the Credit Note that reaches it is finalised. A rejected Credit Note corrected so the line is no longer credited in full gives those Charges back their billing with an "uncredited" event, as correcting a rejected Invoice "unbills" (#128). A Charge set back to bill or billed elsewhere since is left alone.
  - **Deductions.** Crediting a final Invoice copies its deduction lines too, as negative lines that give the advance back, so a Credit Note for the whole Invoice credits its whole total and its work lines are credited in full. Office removes them to leave the advance taken back; they are given back whole (every VAT row of one advance, or none) and only once, at the amount taken. A deduction given back no longer counts as taken back, so the advance can be deducted again or credited. Crediting only the work lines net of the deductions was rejected: the work would never be credited in full, and the advance, still taken back, could never be credited.
  - **Advances.** A Credit Note on an Advance Invoice credits at most what is left of it after the deductions of issued Invoices and its other Credit Notes; what it credits counts toward fully deducted. An advance with nothing left to take back can't be credited.
- The Job page lists each Invoice's Credit Notes, drafts included; a draft Credit Note is one of the drafts closing warns about, and "invoiced so far" is lowered by the Credit Notes past draft.
