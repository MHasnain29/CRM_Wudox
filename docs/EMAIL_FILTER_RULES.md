# Emails filter rules

These rules apply to the **Emails page only**, as agreed in the scenario review.
Shared filters on other pages, linked-account workflows, composing, sending,
signatures, templates, and existing permissions keep their current behavior.

## Default and agency selection

- Multiple agencies: **All Agencies is selected by default**.
- One agency: hide the agency picker. Its automatic home context is not a selected chip.
- No chips selected: only the logged-in user's records, across their accessible agencies.
- An explicitly selected agency: all accessible records in that agency.
- All Agencies selected without a people filter: all accessible records in all accessible agencies.

## People selection

| Selection | Records shown |
| --- | --- |
| One authority, manager, or team member | That person's own records only |
| All Authorities | Authorities' own records only |
| All Managers | Managers' own records only |
| All Team, without an authority or manager selection | All team members, including members without a manager |
| Sarah + All Team | Sarah's team members; exclude Sarah's own records |
| Ahmed + All Managers | Ahmed's managers; each manager's own records only |
| Ahmed + All Team | Members of every manager's team under Ahmed; exclude Ahmed and the managers themselves |
| All Managers + All Team | Those managers' team members; exclude managers and unassigned members |
| All Agencies + All Managers + All Team | Managers' team members across all accessible agencies |
| One agency + All Managers + All Team | Managers' team members in that agency |

The lowest explicitly selected people row determines whose records appear.
Higher selections restrict that row. A member who reports to multiple managers
appears once. Empty groups stay empty; they never become an unrestricted query.

## Changing and clearing filters

- Changing or deselecting an agency clears authority, manager, and team selections.
  This includes switching between All Agencies and a specific agency.
- Changing or deselecting an authority clears manager and team selections.
- Changing or deselecting a manager clears the team selection, including All Team.
- Clearing the last chip returns to the logged-in user's records.
- Changing the selected user/scope clears the email search and open email detail.
- Inbox, Sent, and Drafts retain the selected chips.
- Refresh restores selections from the URL, including explicit All chips.
- An unavailable selected user clears all filters, shows the logged-in user's
  records, and displays an explanation.
- No matching records: keep the selection and show the empty state.
- The Emails page's Inbox count belongs to the selected scope. The global sidebar
  count continues to belong to the logged-in user's mailbox.
- Slow results from an earlier selection cannot replace the current list or detail.
- Incoming email refreshes the selected mailbox and its unread count for recipients
  and connected viewers with existing agency/team access. Filters, search, and the
  open email stay selected. Reconnecting also refreshes emails missed while offline.

## Regression checks

From the repository root:

```sh
cd frontend
../backend/node_modules/.bin/tsx --test src/lib/emailFilterScope.test.ts
```

From `backend`:

```sh
npm test -- --runInBand src/services/emailChipScope.test.ts src/services/incomingEmailRefresh.test.ts
```

The API's opt-in `filterMode=chips` uses exact people IDs, validates them against
existing access, and applies the same scope to Inbox, Sent, Drafts, unread counts,
and legacy proposal entries in Sent. Callers without this flag retain their
existing scope behavior.
