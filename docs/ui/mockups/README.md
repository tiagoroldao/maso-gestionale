# Carbonio mockups

The screens the business approved for the UX pass (ADR 0020), copied from the design canvas "Maso Gestionale UI directions", page Carbonio. `docs/ui.md` holds the rules; these show one Office screen (the Job, "Commessa") and one Technician screen (the Visit, "Intervento") on desktop and phone, the phone menu, and the preview of a referenced Item.

They are the canvas's source, not standalone pages: they need the canvas runtime (`support.js`) to render. Read them for the markup and the colour values, which are the `.r` (light) and `.r.dark` CSS variables at the top of each file. The data in them is sample data; `[INDIRIZZO]` and the like are placeholders.

| File                         | Screen                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| `commessa-desktop.dc.html`   | Job, desktop: sidebar, white header, actions, key-facts band, sections |
| `commessa-phone.dc.html`     | Job, phone: black header, "☰", actions row with "⋯", bottom bar       |
| `menu-phone.dc.html`         | The menu drawer on the phone                                           |
| `intervento-desktop.dc.html` | Visit, desktop (Technician)                                            |
| `intervento-phone.dc.html`   | Visit, phone (Technician)                                              |
| `anteprima-phone.dc.html`    | Preview of an Item, phone bottom sheet                                 |

Where a mockup and `docs/ui.md` disagree, `docs/ui.md` wins (the mockups' logo is a rough trace, and a few details predate the final rules).
