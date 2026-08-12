# SendGrid Inbound Parse — CRM Replies & Threading

This CRM supports **proper reply threading** (like a real inbox) using **SendGrid Inbound Parse**.

## What you get

- Replies from clients land in the **correct user inbox**.
- Replies are linked to the **original sent email** via `inReplyTo`.
- Replies attach to the **correct client/lead**.
- Multi-agency safe: if Agency 1 and Agency 2 send emails, replies route to the correct agency/user based on the email that was replied to.

## How threading works (important)

When the CRM sends an email, it sets:

- **From**: `EMAIL_FROM` / `EMAIL_FROM_NAME` (agency sender)
- **Reply-To**: a special address that encodes the sent email id + sender user id:

`<localpart>+crmreply-<emailId>.<userId>@<inbound-domain>`

Example:

`reply+crmreply-2c2a0a74-0f1d-4b68-9bde-7f1a2f9f4c3a.9a6a3b0f-1c2d-4e5f-8a9b-0c1d2e3f4a5b@inbound.getvision.ca`

When the client clicks **Reply**, SendGrid routes that reply to your backend endpoint:

- `POST https://<YOUR_API_HOST>/api/v1/emails/inbound`

The backend decodes the `to` address and:

- Finds the correct `userId`
- Verifies the original email belongs to the same agency and sender
- Creates an Inbox email with:
  - `toUserId = <userId>`
  - `inReplyTo = <emailId>`
  - `clientId/leadId` copied from the sent email

## Backend endpoint

Your backend route is:

- `POST /api/v1/emails/inbound`

It expects SendGrid’s **Inbound Parse** payload (**multipart/form-data**).

## Recommended `.env` settings

Add these to your backend environment:

```env
# Outbound sender
EMAIL_FROM=subscriptions@getvision.ca
EMAIL_FROM_NAME=NA Staffing

# Inbound Parse routing (recommended to use a dedicated subdomain)
EMAIL_INBOUND_DOMAIN=inbound.getvision.ca
EMAIL_INBOUND_LOCALPART=reply
```

Notes:

- If `EMAIL_INBOUND_DOMAIN` is not set, the system falls back to the domain from `EMAIL_FROM`.
- The inbound domain must be configured in SendGrid Inbound Parse (see below).

## SendGrid setup (step-by-step)

### 1) Create an inbound subdomain

Pick a subdomain (recommended):

- `inbound.getvision.ca`

### 2) Add DNS MX record

In your DNS provider (Cloudflare, GoDaddy, etc), add:

- **Type**: `MX`
- **Name/Host**: `inbound`
- **Value**: `mx.sendgrid.net`
- **Priority**: `10` (any valid number works)

This makes mail to `*@inbound.getvision.ca` route to SendGrid’s inbound system.

### 3) Configure Inbound Parse in SendGrid

In SendGrid Dashboard:

- Go to **Settings → Inbound Parse**
- Click **Add Host & URL**
- **Hostname**: `inbound.getvision.ca`
- **Destination URL**: `https://<YOUR_API_HOST>/api/v1/emails/inbound`

### 4) Confirm wildcard / plus-addressing support

This CRM uses plus-addressing (`reply+crmreply-...@inbound.getvision.ca`).

Most inbound parse setups will accept this automatically as long as:

- The inbound hostname is configured, and
- MX record exists and is propagated.

### 5) Test

1. Send an email from CRM to a client contact.
2. In the received email, click **Reply**.
3. Verify the reply shows in CRM under **Emails → Inbox** for the correct user.
4. Verify it is linked via `inReplyTo` (thread relationship).

## Common troubleshooting

- **Replies do not arrive**:
  - Check MX record is correct and propagated.
  - Check SendGrid Inbound Parse “Hostname” matches your `EMAIL_INBOUND_DOMAIN`.
  - Ensure your public API URL is reachable by SendGrid.

- **Replies arrive but are not threaded**:
  - Ensure `Reply-To` is the encoded CRM address (not the user’s personal email).
  - Ensure the inbound address matches the configured domain in `.env`.

- **Replies go to the wrong agency**:
  - Thread matching only succeeds when the original email belongs to that user’s agency and sender.
  - If it can’t match, it falls back to the old behavior (user email address matching) and then to contact->client matching.

