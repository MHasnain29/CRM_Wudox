# Internal chat calling (WebRTC)

Staff-to-staff **audio and video** calls from the **Messages** module. This is **not** the CRM Twilio softphone (client PSTN / inbound DID).

## What it is

- 1:1 calls between conversation participants (same agency chat rules)
- Browser **WebRTC** peer-to-peer media; **Socket.IO** (`internal-call:*`) for signaling
- Mute (mic) and camera off on video calls
- If the callee is already on an **internal** call, the caller gets **busy**
- CRM / Twilio phone presence is ignored — internal calling stays available independently
- No hold, transfer, recording, or group calls

## What it is not

- Not Twilio Voice / Video
- Not Zoom / Meet / third-party meeting apps
- Does not use the CRM `calls` table
- Does not use CRM agent phone presence for busy

## API / realtime

| Piece | Detail |
|-------|--------|
| `GET /api/v1/internal-calls/ice-config` | Auth required. Returns `{ iceServers }` from env |
| Socket events | `internal-call:invite`, `incoming`, `accept`, `accepted`, `reject`, `rejected`, `busy`, `cancel`, `cancelled`, `ended`, `signal`, `error` |

Invite is validated: both users must be participants of `conversationId`.

## ICE / TURN

Set `INTERNAL_CALL_ICE_SERVERS` to a JSON array of RTCIceServer objects.

- **Default** (unset): public Google STUN — fine for LAN / many home networks
- **Production** behind strict NAT/firewalls: add a **self-hosted coturn** TURN entry

Example:

```bash
INTERNAL_CALL_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"user","credential":"secret"}]
```

## Frontend

- Messages header: audio / video buttons
- `InternalCallOverlay` (app shell): incoming ring + in-call controls
- `internalCallStore` — separate from Twilio `callStore`
- Call outcomes are saved as chat messages (`type: call`) in the conversation (completed / declined / cancelled / missed)
