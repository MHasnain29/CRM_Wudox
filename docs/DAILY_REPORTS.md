# Daily work reports

Daily reports send one combined report for all users in the selected company or agency to one explicitly entered email address. Software roles use Hubstaff tasks and time; marketing, recruitment and other system users combine CRM outcomes with Hubstaff time. Hubstaff remains the owner of software tasks and completion; imported tasks are read-only in CRM.

**Hubstaff is optional for delivery.** Without a connection, the daily email still sends available CRM results for marketing and other non-software users. It shows one **Hubstaff not connected** notice; software users remain included with task/time values unavailable. Connecting Hubstaff and completing synchronization adds its details to future reports automatically. Pending, failed, paused or incomplete imports do not block CRM reporting and are identified in the report instead of being counted as zero work.

## Administrator setup

1. Apply the database migrations and deploy the backend and frontend together. The migrations add reporting policies and snapshots, email/completion evidence, and Hubstaff task history. They do not invent historical sending outcomes or completion events.
2. Optional: open **Settings → Hubstaff**. Connect an organization, review member-to-CRM-user mappings, and map each project to its agency and work category. You can skip Hubstaff setup and enable CRM reports immediately. One Hubstaff organization has one connection; project mappings allow that connection to serve several agencies. Managing a shared connection requires access to every mapped agency.
3. Set the Hubstaff organization's actual reporting timezone. It must match the report timezone for daily time totals. If using the separate Hubstaff Tasks product, configure its organization and integration identifiers to enrich tasks with available estimates and dates. Missing permissions or enrichment remain visible as coverage warnings.
4. Run a sync. The scheduled importer runs every 30 minutes, imports approximately 90 days initially, reconciles the latest 31 dates, and revisits older imported history weekly. The manual date range supports older history within the provider's retention window. A task's lifetime total stays unavailable until its complete date range has been imported.
5. Open **Settings → Daily reports**. Company scope is selected by default for company administrators and includes every agency and department. Enter one recipient email (a CRM account is not required), timezone, report day and sending time. There is no role-based recipient selection or automatic manager delivery. Agency scope includes all users in that agency. New policies are disabled by default and use the previous day at 08:00.
6. Review role reporting profiles and individual overrides. These choose report content and do not change permissions. Overrides are effective-dated; resetting an individual override resumes the role default.
7. Save settings and generate a preview. A preview creates a saved snapshot without sending email. Enable the policy when its content and recipient email are ready.

The email-destination upgrade preserves existing schedules but pauses old policies until an authorized administrator saves an explicit recipient email. Legacy recipient lists remain stored for migration history and do not trigger delivery. The compatibility schedule API cannot enable delivery without a valid saved email and report authorization.

Deployment commands from `backend` for databases with a complete Prisma migration history:

```sh
npm run prisma:migrate:deploy
npm run build
```

For an imported database with missing migration history, first verify the existing schema; apply only the reviewed pending SQL files with `prisma db execute`, then record those executed migrations with `prisma migrate resolve --applied`. Do not replay the old initialization migrations on an existing database.

Build and deploy the frontend through the project's normal release process. Daily reports use the existing SendGrid credentials and the hardcoded sender **Wudox Daily Reports <reports@wudox.ca>** for both company and agency scopes. The sender address and display name are fixed in `backend/src/services/dailyReportEmail.ts`. The SendGrid API key needs `mail.send` permission, and the sender must be authorized through domain authentication or a verified sender identity. Report links use `FRONTEND_URL` (`APP_URL` is a fallback). No email is sent by migration or preview.

## What the recipient sees

The email is a compact summary, grouped by work category. Every employee is included. Users with no counted activity or outstanding work occupy a short row; others have a small two-column card. The company header shows people, personal emails sent/received and calls made. Hubstaff coverage is stated once, with partial/stale time marked where shown. Clicking an employee name opens that employee's section in the saved CRM report; **View full report** opens the complete snapshot. These are standard links that work in email clients, with no JavaScript or collapsible widgets required.

| Work category | Recorded results |
| --- | --- |
| Software / IT | Hubstaff tasks completed, currently open/overdue, tasks worked on and tracked time |
| Marketing / sales | Tasks done/open/overdue; follow-ups done/due/overdue; personal emails sent, received, replies and unread; calls made/answered, call outcomes and inbound calls attended |
| Recruitment / general | The same compact CRM summary and available Hubstaff time |

The full CRM report retains task titles/history, effort/estimates/dates, campaign activity, meetings, leads, placements, manual/idle time, input activity, project totals and detailed coverage notes. These are omitted from the email to keep it scannable. Non-software profiles also retain CRM event context in the full report. CRM events do not establish time spent working. A dash means unavailable, including newly added metrics absent from older snapshots; it never means zero.

Permission checks apply when building reports, immediately before submission, and whenever opening saved snapshots. Saving the destination requires administrator access to all users and the CRM/Hubstaff work in the selected scope. The saved administrator authorizes subsequent reports; an email address itself grants no CRM permissions. Revoking that administrator's access or changing the destination cancels incompatible pending deliveries. Company coverage is resolved on every run, including newly added agencies accessible to that administrator. Snapshot links still require a signed-in authorized CRM account; external recipients can read every user's compact summary in the email.

## Accounting rules and limitations

- Time is summed from canonical imported activity records. Manual, idle and keyboard/mouse measurements are not added again to tracked hours. Input activity uses total overall activity divided by total input-tracked time.
- Shared tasks and aliases for the same global Hubstaff task are counted once in the company completion total. Per-person task rows can repeat a shared task; do not sum those rows to calculate company hours.
- Total task effort includes all imported contributors through the reporting date only when history is complete and the viewer can access those contributors. Personal contribution is separate. Wrong or missing source timezone makes date-bounded time unavailable.
- Missing data is unavailable, never assumed to mean zero work. Freshness, failed syncs, unlinked members, missing task metadata, and incomplete task history remain visible. An observed transition records when CRM noticed a change; an exact completion time is shown only when supplied by Hubstaff. Stale enrichment is excluded from estimate comparisons.
- Reply counts use received, threaded CRM replies with a known outbound parent, deduplicated by inbound message identity. Automatic replies may be included because the current inbox data does not classify them. Personal email success means provider acceptance, not inbox delivery. Queued, failed and unverified legacy messages are excluded. Campaign automation is reported separately from personal sending.
- Received emails count all arrivals still in the CRM inbox within the reporting period, not just replies. Message identity deduplicates webhook retries per effective receiving user; forwarding attributes the message to its current receiver. Unread counts use current read status for those received messages. Replies are a subset of received mail and are not added again.
- Outgoing/logged calls retain their recorded outcomes (answered, no answer, busy, voicemail, pending). Inbound attendance counts answered inbound calls started in the period and attributed to `answeredByUserId`; it does not assign group-routed missed calls or conference participants to an individual.
- CRM completion/reopen events preserve owner, actor, original time and deadline. Reopening and completing the same item again does not inflate the distinct daily completion count. Evidence begins when this feature is deployed; existing records are not backfilled as successful work.
- Report windows use local calendar boundaries, including daylight-saving changes. Historical completion evidence retains its date; current task status and overdue counts describe the state at snapshot generation.
- Saved reports are immutable. Late uploads and subsequent edits affect later previews/reports, not emails already submitted. Daily Hubstaff records measure recorded effort; they do not establish exact wall-clock elapsed time between task creation and completion.

## Delivery and troubleshooting

The scheduler checks every five minutes and uses a unique policy/date key. Each policy sends once per reporting date, even if the email is changed later that day. Old per-user delivery records also prevent a duplicate during upgrade. Workers claim delivery atomically. Confirmed failures retry with backoff up to five attempts; administrators may retry a confirmed failure from history.

`accepted` means SendGrid accepted the request. `unknown` means a timeout or interrupted worker left submission uncertain; automatic retry is blocked to avoid duplicates. Check provider history using the stored message identifier or the `daily_report_snapshot_id` custom argument. This implementation does not reconcile unknown submissions or confirm inbox delivery through a report webhook. History's attempt count is since the latest manual retry.

Before upgrading a database with existing Hubstaff connections, check that the same Hubstaff organization was not connected twice. The new unique constraint prevents duplicate ingestion; conflicting connections must be reviewed and consolidated before migration. Validate migration SQL against a disposable PostgreSQL database before deployment. Local migration receipts and backups are kept under the ignored `local-tools/db-backups` directory.
