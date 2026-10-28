# Several Quotes per Job, a Job's status follows its work, and survey Visits

A Job can have several Quotes, written at any time: before any work, or later for extra work. Each Quote has its own life: a draft is edited freely; once it is sent to the Customer it no longer changes, and it is then accepted or declined (a draft can also be accepted on the spot, which sends it). A change after sending means a new Quote. Quotes are numbered from their Job: "2026/0007-1", "2026/0007-2". Declining a Quote declines only that Quote; Office cancels the Job separately when nothing else goes ahead. Lines can be imported from any accepted Quote (ADR 0012), and the Job page compares what has been invoiced with the sum of its accepted Quotes, for information only.

A Job's status follows its work, not its Quotes: open while nothing has been done but surveys, in progress once a work Visit is planned, then work complete, invoiced and closed as derived today. "Quoted" and "accepted" are no longer Job statuses; they are each Quote's own, shown on the Job.

A Visit planned as a survey (_sopralluogo_) never moves its Job to in progress, so a Job with only surveys stays open and can still be quoted. Otherwise it is a Visit like any other: Technicians, notes, photos and Charges (a survey can be billed). Office marks it when planning and can change it until the Visit is closed. This replaces telling surveys from work by the Quote's decision date. Decided by the business on 2026-10-28 (#134).

## Considered Options

- **One Quote per Job, its status driving the Job's** (until now): simple, but no Quote for extra work once work has started, and planning any Visit before quoting moved the Job past the point where a Quote could be written.
- **A Quote can be edited until accepted or declined:** convenient, but what the Customer received could then differ from what the app keeps.
- **Surveys told apart by date** (Visits ended before the Quote was decided): no extra input, but wrong once Quotes can come at any time, and silent about what a Visit was for.

## Consequences

- Job statuses lose "quoted" and "accepted"; lists and filters that used them show Quote statuses instead.
- A Quote's status gains "sent", after which it is frozen.
- Quotes get a number of their own, shown on the PDF and the Job page.
