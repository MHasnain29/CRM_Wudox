# Twilio Voice setup (in-app calling)

Sales associates can call clients from the marketing module using Twilio Voice. The backend provides:

- **GET /api/v1/voice/token** (auth) – Returns a Twilio Access Token for the [Voice JS SDK](https://www.twilio.com/docs/voice/sdks/javascript) (browser-based calling).
- **POST /api/v1/voice/call** (auth) – Body `{ "to": "+1234567890" }` – Initiates an outbound call from your Twilio number to the client.
- **GET /api/v1/voice/config** (auth) – Returns agency voice config: `voiceEnabled`, `outboundEnabled`, `inboundEnabled`, `outboundCallerId`, `inboundDid`.

Per-agency phone numbers and caller IDs are configured in **Settings → Phone System** (database), not in `.env`. See **PHONE_SYSTEM.md**.

---

## 1. Twilio account

1. Sign up at [twilio.com](https://www.twilio.com) and get your **Account SID** and **Auth Token** from the [Console](https://console.twilio.com).

2. **Buy a phone number** (Voice-capable) in [Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming). Enter it in **Settings → Phone System → Number** for each agency (not in `.env`).

---

## 2. API Key (for Voice tokens)

Voice tokens must be signed with an **API Key**, not the main Auth Token.

1. In Console go to **Account → API keys & tokens** (or [API Keys](https://console.twilio.com/us1/account/keys-credentials/api-keys)).
2. Create API Key, name it e.g. `Wudox Voice`.
3. Copy the **SID** (starts with `SK...`) and **Secret**. The secret is shown only once; store it in `.env` as `TWILIO_API_KEY_SECRET`.

---

## 3. TwiML App (for in-browser Voice SDK)

When the browser places a call, Twilio uses a **TwiML App** to know what to do (e.g. dial the client).

1. In Console go to **Develop → TwiML Apps** (or [TwiML Apps](https://console.twilio.com/us1/develop/voice/api/twiml-apps)).
2. Create a new TwiML App:
   - **Friendly Name:** e.g. `Wudox CRM Voice`
   - **Voice Request URL:** Your backend URL that returns TwiML, e.g.  
     `https://your-api.com/api/v1/voice/twiml`  
     For development you can use a Twilio-hosted TwiML bin or a tunnel (ngrok) to your app.  
     Example TwiML to dial a number passed as `To`:  
     `<Response><Dial><Number>{{To}}</Number></Dial></Response>`  
     (You’ll implement this endpoint to read `To` from the request and return the TwiML.)
3. Copy the **SID** (starts with `AP...`) → `TWILIO_TWIML_APP_SID`.

---

## 4. .env

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SECRET=your-api-key-secret
TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Deprecated — one-time migration only; agency numbers live in Phone System (DB)
# TWILIO_CALLER_ID=+15551234567
```

Restart the backend. Configure each agency's DID in **Settings → Phone System → Number**.

- **GET /api/v1/voice/token** (with JWT) returns a token for the Voice JS SDK.
- **POST /api/v1/voice/call** creates a call record; the browser connects via Voice SDK using the agency's DB-configured caller ID.

---

## 5. Frontend (Voice JS SDK)

1. Install: `npm install @twilio/voice-sdk`
2. Fetch token: `GET /api/v1/voice/token` with `Authorization: Bearer <jwt>`.
3. Create device: `const device = new Device(token);` then `device.connect({ params: { To: clientPhoneNumber } });`

The TwiML App’s Voice URL will receive the request when the browser initiates the call; your backend should return TwiML that dials the number (e.g. from the `To` param).

---

## Optional: TwiML webhook for Voice SDK outbound calls

If the frontend uses `device.connect({ params: { To: '+15559876543' } })`, Twilio will HTTP request your TwiML App’s Voice URL. Add a route that returns TwiML, e.g.:

- **POST /api/v1/voice/twiml** – Read `To` from query or body and return:

  `<Response><Dial><Number>+15559876543</Number></Dial></Response>`

Set that URL as the TwiML App’s **Voice Request URL** (with your real domain).
