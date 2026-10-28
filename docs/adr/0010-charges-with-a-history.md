# Charges: what was done and what is billed, in one record with a history

What a Job can be billed for is recorded as **Charges**: hours worked, Items used, a call-out, any other cost, on a Visit or on the Job itself. Technicians record them in the field. Office reviews them and corrects them, decides what is billed and at what price, or marks them not billable. An Invoice line bills one or more Charges, each whole, never split across Invoices; the line records the amount billed, which may be less than the Charge's billing value. Credit Notes credit Charges. Office can set a billed Charge back to "to bill", which makes its billing side editable again, and bill it again (that is how a partial or repeated bill is done, by hand). Each of these is an event in the Charge's history, and each billing records the amount billed. A Charge's state is derived from that history (to bill, billed, credited, not billable), never stored as a flag. A Visit is billed when none of its Charges are outstanding; a Job is fully invoiced when nothing on it is.

Recorded hours are a suggestion, not a price to charge. Not everyone who works is in the app (a contractor hired for the day), and what the Customer pays is Office's decision. So a Charge keeps two sides: what was recorded (quantity, who, the Item), which feeds stock and history, and what is billed (billable or not, quantity, price, description), which feeds Invoices. Prices are set when a Charge is recorded, from the Labour Rate or the Item. What was recorded can be corrected at any time, and a correction moves stock by the difference with a new Stock Movement (the ledger is never rewritten). What is billed can be edited until it is billed; after that it changes only through billing events (set back to "to bill", credited, billed again).

Quoted and Time & Materials Jobs both invoice from their Charges (refined by ADR 0012: Quote lines are imported as ordinary Charges, and the Job kind is dropped). A Quoted Job keeps its link to its accepted Quote, and Office adds Charges from the Quote's lines by hand (all of them, or a selection); they can then be changed or left out like any other Charge.

## Considered Options

- **Recorded work and Charges as separate records:** Technicians' facts underneath, Office's Charges derived from them. It keeps facts pristine, but adds a layer that has to be kept in step for little gain at this business's size; the history already keeps the facts' corrections.
- **Bill straight from recorded work, linked to the Invoice that took it** (#75): simplest, but it treats recorded hours as the amount owed and leaves "not billable", credits, re-billing and corrections without a clear record.
- **Split a Charge's amount across Invoices:** more precise partial billing, but more to track and explain; re-billing a whole Charge by hand covers the rare cases.
- **Turn an accepted Quote's lines into Charges automatically:** less clicking, but what is finally billed often differs from the Quote; adding them by hand keeps Office in control.
- **Invoice lines as the only billable record:** Invoice lines exist only inside an Invoice and drafts are rewritten on save, so nothing would represent what is billable before an Invoice exists or after one is credited.

## Consequences

- Invoice lines need an identity that survives saving a draft, so a line can record which Charges it bills (#110).
- Credit Notes (#24) credit Charges: they become outstanding again, to be billed again, or Office marks them not billable.
- Defaults by kind can come later (a Labour Rate whose hours are not billable by default, such as training or warranty).
- Technicians record Charges without seeing prices; prices are set from the Labour Rate or the Item when recorded and edited only by Office.
