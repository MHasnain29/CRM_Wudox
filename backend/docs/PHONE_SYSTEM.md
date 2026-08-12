# Phone System (per-agency)

Agency phone numbers, outbound caller ID, Twilio credentials, and inbound IVR configuration are stored in the **database** per agency and managed in **Settings → Phone System**.

## Data model

| Table | Purpose |
|-------|---------|
| `phone_agency_configs` | Per-agency toggles, IVR settings, call-flow JSON, ring groups, extensions, etc. |
| `phone_numbers` | Inbound DIDs (`e164`, label, active flag) |
| `inbound_calls` | Inbound call history (populated when live inbound is active) |
| `inbound_call_participants` | Users who were rung on an inbound call |
| `agent_phone_presence` | Per-agent availability: `manualStatus`, `activeCallCount`, `lastCallEndedAt` (drives presence-aware/balanced dialing) |
| `phone_queue_entries` | Callers parked in a `connect_queue`: `queueName`, `callSid`, caller info, `status`, `connectedUserId` |
| `phone_conference_legs` | REST-created agent legs ringing into an inbound conference (`agentCallSid`, `inboundCallId`, `status`) |

`SubCompany.agencyPhone` is **synced read-only** from the primary active `PhoneNumber` when you save in Phone System. Do not edit it in the Agencies dialog.

## Env vs DB

| Setting | Where |
|---------|--------|
| Master Twilio account (optional, import/provisioning scripts only) | `.env` |
| Per-agency Account SID, Auth Token, API Key, TwiML App | **DB** — Settings → Phone System → Integrations |
| Inbound DID, outbound caller ID, enable toggles, call flow | **DB** — Settings → Phone System |
| `TWILIO_CALLER_ID` | **Deprecated** — one-time migration script only (`prisma:backfill-phone-system`) |
| R2 storage (`R2_*`) | `.env` org default for all agencies; object keys prefixed `agencies/{subCompanyId}/` |

## Secrets (at rest and API)

- **Auth Token** and **API Key Secret** are stored AES-256-GCM encrypted (`GOOGLE_TOKEN_ENCRYPTION_KEY`, format `enc:<iv>:<tag>:<ciphertext>`). Required in production; never written as plaintext.
- Public APIs (`GET/PUT /phone-system/bundle`) return SIDs plus `hasAuthToken` / `hasApiKeySecret` only — never Auth Token or API Key Secret.
- One-shot migration for legacy plaintext rows: `npm run scripts:encrypt-secrets`.
- See also [`SECRETS.md`](./SECRETS.md) for Google refresh tokens and agency DTO rules.

## API

Prefix: `/api/v1/phone-system` (auth required).

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/bundle?subCompanyId=` | `phone_system:read` or `settings:read` | Full agency bundle |
| PUT | `/bundle` | `phone_system:write` or `settings:write` | Save bundle |

| GET | `/inbound-calls` | `inbound_calls:read` or `calls:read` | Agency-scoped inbound call history |
| GET | `/queue/live` | `inbound_calls:read` or `calls:read` | Callers currently waiting (scoped to the agent's ring groups) |
| POST | `/queue/:entryId/pickup` | `inbound_calls:read` or `calls:read` | Manually connect a waiting caller to the current agent |

Voice endpoints (see `TWILIO_VOICE_SETUP.md`):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/voice/config` | `{ voiceEnabled, outboundEnabled, inboundEnabled, outboundCallerId, inboundDid }` |
| POST | `/voice/webhook/twiml` | Uses DB caller ID via `callRecordId` → agency |
| GET | `/voice/presence/me` | Current agent `{ manualStatus, effective, activeCallCount, ringingLegs, joinedLegs, canAcceptRing, canPickupFromQueue }` |
| PUT | `/voice/presence/me` | Set manual status (`available`/`busy`/`away`/`offline`/`null` = auto) |
| POST | `/voice/presence/call-started` | Softphone signal: increment active call count |
| POST | `/voice/presence/call-ended` | Softphone signal: decrement; auto-dequeue next caller if now available |
| GET | `/voice/inbound/incoming-context?agentCallSid=` | Metadata for conference inbound Answer/Decline popup |
| POST | `/voice/inbound/:inboundCallId/hold` | Hold/un-hold PSTN caller in conference (`{ hold: boolean }`) |
| POST | `/voice/call/:callRecordId/hold` | Hold/un-hold outbound PSTN callee in conference (`{ hold: boolean }`) |
| POST | `/voice/webhook/outbound/conference` | Outbound conference statusCallback (agent join → dial callee) |
| POST | `/voice/webhook/outbound/pstn-status` | Outbound PSTN leg status (capture CallSid for hold) |
| POST | `/voice/webhook/inbound/conference` | Twilio conference statusCallback (participant join, conference SID) |
| POST | `/voice/webhook/inbound/agent-status` | Per-agent-leg statusCallback (no-answer, sequential retry) |
| POST | `/voice/webhook/inbound/after-conference` | No-answer fallback when conference bridge ends unanswered |
| POST | `/voice/webhook/queue/wait` | Twilio `<Enqueue waitUrl>`: hold music + position, `<Leave/>` past max wait |
| POST | `/voice/webhook/queue/action` | Twilio `<Enqueue action>`: bridged / hung up / timed out |
| POST | `/voice/webhook/queue/connect` | REST-triggered: park caller in conference + ring agent |
| POST | `/voice/webhook/queue/connected` | Legacy dial action (superseded by conference bridge for queue pickup) |

## Caller ID resolution

Outbound caller ID is resolved **from DB only** (no `TWILIO_CALLER_ID` fallback):

1. `PhoneAgencyConfig.outboundCallerId`
2. Else earliest active `PhoneNumber.e164`

If missing → `503` on outbound / TwiML with message to configure Phone System.

## Migration

1. `npx prisma migrate deploy` — creates tables and seeds from existing `agency_phone`.
2. Optional one-time env seed: `npm run prisma:backfill-phone-system` (uses `TWILIO_CALLER_ID` for agencies still without a number).

## Phase 3 — live inbound (implemented)

- `POST /voice/webhook/inbound` — map `To` → `PhoneNumber.e164` → agency, TwiML from `publishedFlow`.
- `PhoneCallSession` — IVR state across `<Gather>` callbacks.
- Agent softphone — `InboundCallRoot` + Answer/Decline on real Client legs.
- `POST /phone-system/call-flow/publish` — validate and publish draft flow.
- `npm run prisma:backfill-phone-defaults` — seed reference IVR for empty agencies.

## Local dev — inbound call checklist

Inbound PSTN requires Twilio to reach your backend over HTTPS. If the call rings ~10s with no greeting, Twilio never got valid TwiML from the first webhook.

1. **Start backend** (default port 3001) and **ngrok** pointing at **`127.0.0.1:3001`** (not `localhost` — on Windows, `localhost` can resolve to IPv6 `[::1]` while Node listens on IPv4 only, causing Twilio “application error”). From repo root: `npm run tunnel:ngrok`.
2. Set `DEV_TUNNEL_URL` in repo-root `dev-tunnel.env`; backend loads it as `PUBLIC_API_URL` via `loadEnv.ts`.
3. After every ngrok URL change, from repo root: **`npm run tunnel:sync`** — updates Twilio DID voice URL and **clears `voiceApplicationSid`** on the number (if the DID is linked to the outbound TwiML App, Twilio sends PSTN inbound to `/webhook/twiml` instead of `/webhook/inbound` and the call rings with no IVR).
4. Before testing: **`cd backend && npx tsx scripts/check-phone-inbound.ts`** — DB config, Twilio URL match, and HTTP self-test (must return Say + Gather in under ~8s).
5. Place a test call; backend must log **`[webhook/inbound] OK <ms>ms`** on the first POST (no `Digits`). If there is no log line, the tunnel or Twilio webhook URL is wrong.
6. In the CRM, confirm **“Agent phone ready”** (browser Voice SDK registered) — required only after the caller presses a menu key to ring agents.

See also `TWILIO_VOICE_SETUP.md` for Twilio Console credentials and TwiML App setup.

## Call flow edge labels

The inbound TwiML interpreter follows **edges** in the published graph (`backend/src/services/callFlowRouter.ts`). Outgoing edge labels must match what the runtime expects:

| Source node | Label | When followed |
|-------------|-------|---------------|
| `gather_dtmf` | `1`–`9`, `0`, `*` | Menu digit pressed |
| `gather_dtmf` | `ext` | Multi-digit extension + `#` |
| `gather_dtmf` | `timeout` | No input before timeout |
| `gather_dtmf` | `invalid` | Unknown digit (optional catch-all) |
| `business_hours` | `open` | Currently within agency business hours |
| `business_hours` | `closed` | Currently outside agency business hours |
| `connect_group` | `no answer` | Dial completed, not answered |
| `connect_group` | `busy` | Dialed leg returned busy (optional; falls back to `no answer`) |
| `connect_extension` | `not found` | Extension unknown |
| `connect_extension` | `no answer` | Known extension, dial failed |
| `connect_extension` | `busy` | Dialed leg returned busy (optional; falls back to `no answer`) |
| `connect_queue` | `timeout` | Caller waited past the queue's max wait |
| `connect_queue` | `answered` | Caller connected to an agent (optional) |
| `invalid_message_loop` | _(unlabeled)_ | After invalid clip plays |
| `play_message`, `play_office_hours` | _(unlabeled)_ | After clip plays |

`repairFlowEdges` runs on publish and at runtime load to add missing edges from legacy `loopTo` / ext-dial data. Legacy fallbacks log a warning when an expected edge is absent.

### Business hours node

`business_hours` is a **conditional router**, not an announcement (that's `play_office_hours`). At call time it evaluates the agency **Business hours** settings (`PhoneAgencyConfig.businessHours`) in the agency's configured **timezone** (`PhoneAgencyConfig.timezone`, default `America/Toronto`) via `isWithinBusinessHours()` and follows the `open` or `closed` edge. Publish validation requires both edges. The default flow places it right after the trigger: `open` → welcome/main menu, `closed` → an "After-hours forward" fallback node (`fallbackAction: 'forward'`, set the number in the inspector; an empty number falls through to voicemail).

### Busy handling

When a dialed leg finishes with `DialCallStatus === 'busy'`, the interpreter prefers a `busy` edge on the `connect_group` / `connect_extension` node and falls back to the `no answer` edge when none exists, so existing flows are unaffected.

## Agent presence, workload balancing & call queue

### Presence (`agent_phone_presence`)

Each agent has a presence row (`backend/src/services/agentPresence.ts`). The **effective** status is:

1. `manualStatus` (Available / Busy / Away / Offline) when the agent set one, else
2. `busy` while `activeCallCount > 0` (auto-detected), else
3. `available`.

Only **available** agents are dialed for the first call. Agents on exactly **one** active call remain **ringable for call-waiting** (second inbound rings their browser) unless they already have a **ringing** conference leg. Agents with two **joined** conference legs (active + held swap) or one joined plus one ringing are skipped. Capacity is enforced server-side via `getAgentInboundCapacity()` (`joinedLegs` + `ringingLegs` on `phone_conference_legs`) and mirrored on `GET /voice/presence/me` for the softphone UI.

### Three-tier waiting model

| Tier | Limit | Behavior |
|------|-------|----------|
| **Answered (live)** | Max **2** | One active + one held inbound call with swap (`activeInboundCall` / `heldInboundCall`). Unchanged. |
| **Call-waiting ring** | Max **1** | While on one answered call, a second caller rings the agent's browser (Answer/Decline in the active-call widget). A third simultaneous ring is rejected client-side and routed to queue server-side. |
| **Queued (parked)** | Unlimited | Callers in Twilio `<Enqueue>` + `phone_queue_entries`. Shown stacked in the softphone waiting panel (3+ visible). Manual pickup is blocked with `409` when the agent is at capacity. |

Staff extensions and ring groups follow the node's **`busy`** edge to `connect_queue` when no agent can accept another ring (preferred over `no answer` / unavailable message).

### Presence-aware / balanced ring groups

`dialRingGroup` filters a ring group's members to those effectively available, ordered **longest-idle first** (`lastCallEndedAt` ascending). Ring strategy:

- `simultaneous` (default) — ring all available members.
- `balanced` — ring only the single longest-idle available member.
- `sequential` — ring available members one at a time.

If members exist but **none** are available, the dial returns "all busy" and the interpreter routes to the node's `busy` edge (typically a `connect_queue`).

### Call queue (`connect_queue` node + `phone_queue_entries`)

Callers reaching a `connect_queue` node are parked in a Twilio `<Enqueue>` queue with hold music and position announcements (`waitUrl` → `POST /voice/webhook/queue/wait`, returns `<Leave/>` once `maxWaitSec` is exceeded → the node's `timeout` edge via `/queue/action`).

Connecting a caller to an agent is done by REST-updating the waiting call to `POST /voice/webhook/queue/connect`, which parks the caller in a **conference** and rings the agent's Voice SDK client into the same room:

- **Auto-dequeue** — when an agent frees up (`/voice/presence/call-ended`), `connectNextForAgent` pulls the longest-waiting caller in one of that agent's ring groups.
- **Manual pickup** — agents see the live queue (`GET /phone-system/queue/live`) and pick up a specific caller (`POST /phone-system/queue/:entryId/pickup`). Returns `409` when the agent already has active + held or a pending call-waiting ring. Live updates are pushed via the `queue:refresh` socket event.

If the connected agent does not answer, the caller is returned to the queue (`/queue/connected` re-enqueues).

### Inbound conference bridge

Answered inbound calls (ring groups, extensions, queue pickup) use **one Twilio conference per caller** (`conf-{inboundCallId}`):

- The PSTN caller joins with hold music until an agent answers.
- Agents are rung via REST `calls.create` to `client:{identity}`; the browser shows Answer/Decline using `GET /voice/inbound/incoming-context`.
- **Hold** — `POST /voice/inbound/:id/hold` sets Twilio participant hold + hold music (not agent mic mute).
- **Mute** — agent mic mute via Voice SDK (`call.mute()`), independent of hold.
- **Call waiting** — agents on one call remain ringable; answering a second call auto-holds the first via REST hold.
- **Swap** — REST hold/un-hold toggles which caller is live; agent mutes the inactive browser leg.

Implementation: `backend/src/services/conferenceBridge.ts`, `phone_conference_legs` table, `inbound_calls.conferenceSid` / `conferenceRoom`.

### Outbound conference bridge

Outbound browser calls use conference room `outbound-{callRecordId}`:

- Agent browser leg joins the conference via TwiML App (`POST /voice/webhook/twiml`).
- PSTN callee is REST-dialed into the same room on agent join (`POST /voice/webhook/outbound/conference`).
- **Hold** — `POST /voice/call/:callRecordId/hold` sets Twilio participant hold + hold music on the PSTN leg.
- **Mute** — agent mic mute via Voice SDK (`call.mute()`), independent of hold.

Hold music URL is resolved from the agency's published call-flow `connect_queue` nodes when configured, else Twilio demo clip.

### Call swapping (softphone)

The agent softphone supports one **active** and one **held** inbound call. A second incoming call is answered with `answerSecondCall` (REST-holds the current caller with music); `swapCalls` toggles which caller is live via conference participant hold/un-hold. Mute is independent (agent mic only).
