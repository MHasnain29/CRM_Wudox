# Client Training — User Flow

> Product walkthrough for recruiters / managers.  
> Status: **Core flow (steps 1–4) + review hardening.** A few decisions still need your answer at the bottom.

---

## What this is for

Some Active Clients require **client training**. We store the client’s training document, show it when linking an employee to that client’s job, email it to the employee, and later upload the **signed** training document on the employee to mark the flow complete. Job placement does **not** wait for the signed upload.

**Does not change:** Ontario/WHMIS training, Master approval, Onboarding Agreement, Marketing Clients, or whether a job can start after Link.

---

## Step 1 — Capture training when adding or editing a client

**Where:** Recruitment → Active Clients → **Add Active Client** (or Edit)

1. Open Add / Edit Active Client.
2. Fill company + contact fields as today.
3. Checkbox: **Client training**.
4. Unchecked → no training; save as normal.
5. Checked → required: **Document** (training file from the client)
6. Save → training is stored on that Active Client.

| Control | When visible | Purpose |
|--------|----------------|---------|
| **Client training** | Always on Add/Edit | Turns requirement on/off |
| **Document** | If checked | Client’s required training file |

---

## Step 2 — Show training when linking an employee to a client job

**Where:** Recruitment → Employees → **Link to Client & Job**  
(Also from Job Matches when placing someone.)

1. Select **Active Client** + **Job**.
2. If that client has training → show training + **Preview** of the client’s document.
3. If not → hide that block; continue assignment fields as today.

---

## Step 3 — Email after link (does not block the job)

**When:** Link succeeds and the client has training.

1. Employee is emailed: this training is required by the client; they need to do it.
2. The training document is included.
3. Email is sent **as the person who linked them** (SendGrid).
4. **Job can start immediately** — no wait for signature.
5. If the employee has **no email** or send fails → placement still succeeds; you will see a warning. You can still upload the signed doc later, and **Resend** when email is available.

---

## Step 4 — Resend / Upload signed / Preview (complete the loop)

**Where:** Employee → **Training — Resend / Upload certificates**  
→ separate **Client training** card (not the same as Ontario / WHMIS Master courses).

| Action | Purpose |
|--------|---------|
| **Resend** | Send the client’s required training document to the employee again |
| **Upload** | Attach the **signed** training document (employee did the training) |
| **Preview / View** | Open the signed document |

Upload marks that client-training item **complete**. This closes paperwork; it does **not** unlock job start (that already happened at link).

If the employee later moves to another client/job that also requires training, that new placement gets its **own** client-training item.

---

## End-to-end summary

```text
1. Add/Edit Active Client → Client training + document
2. Link to Client & Job → see training + Preview
3. After link → email employee (best effort) → job can start
4. Training panel → Resend / Upload signed / Preview → complete
```

---

## Product decisions (locked)

1. Replace client template later → pending employees keep the **old** document they were already sent.
2. After placement ends → still allow **Upload** of signed training.
3. Email → **PDF attached** in the inbox.
4. Status → **Pending** / **Signed**.
5. Email copy → sensible **default for v1** (polish later).
