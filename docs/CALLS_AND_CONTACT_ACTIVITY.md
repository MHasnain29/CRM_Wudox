# Calls and contact activity (sales CRM)

Requirements for **recording who contacted the client**, **agency isolation**, and **storing call audio + transcription for reports**. Aligns with `docs/SYSTEM_UNDERSTANDING.md` and `backend/docs/CLIENT_AGENCY_MODEL.md` / phone docs.

---

## What the system already says

### Agency isolation (one agency does not see another’s contact activity)

- Calls, follow-ups, and meetings are **per agency** (scoped by `subCompanyId`). Each agency has its own status, tags, notes, **calls**, follow-ups, meetings. Other agencies do not see these unless a director overrides (e.g. public note).
- **Implementation**: `calls` table has `sub_company_id`; client/lead detail APIs return calls filtered by the current user’s agency. So **agency isolation for call activity is already in the design**.

### Who made the call

- **Prisma**: `calls` has `owner_id` (FK to users). So the system already records **who made the call**.
- **Emails**: `emails` has `from_user_id`, so who sent the email is recorded.

### Call details in the plan

- **Call** model: `client_id`, `lead_id`, `owner_id`, `outcome`, `duration`, `notes`, `recording_url`, `timestamp`, and `sub_company_id`. So **call details** are covered except transcription and where the audio file lives (see below).

### Activity logs

- **activity_logs**: `type`, `user_id`, `user_name`, `sub_company_id`, `description`, `metadata`, `timestamp`. Supports “who did what” for **reports**.

### Voice (in-app calling)

- Voice routes: GET `/voice/token`, POST `/voice/call`, GET `/voice/config` (require `voice:use`).
- **Implementation**: Twilio Voice is used for in-browser calling; POST /voice/call creates an outbound call via Twilio and returns `callSid`. There is **no creation of a `Call` row** in the CRM when a call is placed via this endpoint, and no webhook yet to persist call result (duration, outcome, recording URL).

---

## Requirements (from product / user)

1. **CRM for sales people calling clients**  
   Sales associates (and others with permission) call clients; each **agency** has its own users and data.

2. **Agency isolation**  
   One agency must **not** see another agency’s contact activity (calls, emails, etc.).  
   → **Already designed**: calls (and related data) are scoped by `sub_company_id`.

3. **Record who made the call and full call details**  
   For every call: store **who** (user) made it and **all call details** (client, lead, outcome, duration, notes, recording, timestamp, agency).  
   → **Mostly in plan**: `owner_id` + existing Call fields. **Gap**: When a call is made via the in-app voice (POST /voice/call), no `Call` record is created yet; only Twilio is invoked.

4. **Same idea for emails**  
   When an email is sent to a client, record who sent it and relevant details.  
   → **In plan**: `emails.from_user_id` and related tables; email send flow and any activity logging should ensure every send is recorded for reports.

5. **Call recording + transcription on our side**  
   - **Audio**: Store the **recording** on **our DB or server** (or a controlled store like R2/S3) so reports and playback don’t depend on Twilio-only URLs.  
   - **Transcription**: Store **transcription** of the call so it can be searched and used in reports.  
   → **Gaps**:  
   - Plan has `recording_url` only (could be Twilio URL). No explicit “copy recording to our storage” or “audio file URL on our server.”  
   - No **transcription** field on `calls` in the current schema.

6. **Reports**  
   Use stored call (and email) data, including who made the contact, to generate reports later.  
   → **Supported** by current schema (owner, timestamps, sub_company, activity_logs) once every call/email is persisted and optionally mirrored in activity_logs.

---

## Summary: aligned vs gaps

| Requirement                         | In plan/notes? | In implementation? |
|-------------------------------------|----------------|----------------------|
| Agency isolation for calls          | Yes            | Yes (sub_company_id) |
| Who made the call (owner)           | Yes            | Yes (owner_id)       |
| Call details (outcome, duration, …) | Yes            | Yes                  |
| Recording URL                       | Yes            | Yes (recording_url)  |
| Recording stored on our server/DB   | Not explicit   | No                   |
| Call transcription                  | No             | No (no field)        |
| Create Call record when call is made| Not detailed  | No (voice route doesn’t create Call) |
| Email: who sent                     | Yes            | Yes (from_user_id)   |
| Activity log per call/email         | Schema only    | To be ensured        |

---

## Recommended next steps (for implementation)

1. **When a call is placed (in-app voice)**  
   - Create a **Call** row (client, lead if any, owner_id, sub_company_id, outcome initially “unknown” or pending).  
   - When Twilio sends **status callback** (completed/failed) and **recording webhook**, update the same Call with: outcome, duration, `recording_url` (and later, our own storage URL if we copy the file).

2. **Call recording on our server**  
- In Twilio recording webhook: download the recording and upload to **our storage** (e.g. R2/S3).
   - Store in `calls` either our **storage URL** or both (Twilio URL + our URL). Prefer our URL for reports and long-term availability.

3. **Transcription**  
   - Add a **transcription** field (e.g. `TEXT` or `transcription TEXT`) to `calls`.  
   - Populate via Twilio transcription API (or another provider) when the recording is ready, and save to DB so reports can use it.

4. **Activity log**  
   - When a Call is created or an email is sent, create an **activity_log** entry (type e.g. `call` / `email_sent`, user_id, sub_company_id, description, metadata with call_id/email_id) so “contact activity” reports are consistent.

5. **docs/SYSTEM_UNDERSTANDING.md**
   - If the team confirms “recordings on our server” and “transcription stored in DB,” add a short note there (and phone docs) so future work stays aligned.

---

## Reference: current Call model (Prisma)

- `id`, `clientId`, `leadId`, `subCompanyId`, `ownerId`, `outcome`, `duration`, `notes`, `recordingUrl`, `timestamp`, `createdAt`.  
- **Missing for above**: `transcription` (and optionally a dedicated “our recording URL” if you keep Twilio URL separately).
