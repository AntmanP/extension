# LinkedIn Email Assistant — Setup Guide

A Chrome extension that opens a side panel on LinkedIn profiles, scrapes the
person's details, generates a personalised outreach email using AI, attaches
your resume (PDF), and sends or schedules it directly from your Gmail account.

---

## Project structure

```
extension/
├── manifest.json
├── background.js
├── content.js
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js
├── utils/
│   ├── gmail.js        ← Gmail API helper (auth, send, schedule)
│   └── ai.js           ← AI email generation (OpenAI / Gemini)
└── options/
    ├── options.html
    └── options.js
```

---

## Step 1 — Load the extension in Chrome (get your Extension ID first)

You need the Extension ID before you can create the Google OAuth credential,
so load the extension first.

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle in the upper-right corner)
3. Click **Load unpacked** and select this `extension/` folder
4. The extension card appears. Copy the **Extension ID** shown below the
   extension name — it is a 32-character string like `abcdefghijklmnopabcdefghijklmnop`.

> **Keep this page open** — you will need the ID in the next step.

---

## Step 2 — Create a Google OAuth Client ID (for Gmail)

This lets the extension send email through your Gmail account.

1. Go to **https://console.cloud.google.com/** and create (or select) a project.

2. Navigate to **APIs & Services → Library** and enable:
   - **Gmail API**

3. Go to **APIs & Services → OAuth consent screen**:
   - User Type: **External**
   - Fill in App name (e.g. "LinkedIn Email Assistant"), your email, etc.
   - Add scopes:
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.compose`
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/userinfo.email`
   - Add yourself as a **Test user**.

4. Go to **APIs & Services → Credentials → Create Credentials → OAuth Client ID**:
   - Application type: **Web application**
   - Name: anything (e.g. "LinkedIn Email Assistant")
   - Under **Authorized redirect URIs** click **+ Add URI** and paste the URI
     shown in the extension's Settings tab → Gmail Connection section.
     It looks like: `https://EXTENSION_ID.chromiumapp.org/`
     *(open the side panel → Settings tab → copy the "Authorized Redirect URI" field)*

5. Click **Create**. Copy the generated **Client ID**
   (it looks like `123456789-abc.apps.googleusercontent.com`).

6. Open `manifest.json` and replace the placeholder with your Client ID:
   ```json
   "oauth2": {
     "client_id": "123456789-abc.apps.googleusercontent.com",
   ```

7. Go back to `chrome://extensions/` and click the **refresh icon** on the
   extension card so Chrome picks up the updated `manifest.json`.

---

## Step 3 — (Optional but recommended) Set up Server Scheduler

By default, scheduled emails only fire when Chrome is open. The Server Scheduler
runs on Google's servers 24/7, so emails send even when your laptop is off.

### 3a — Create the Apps Script

1. Go to **https://script.google.com** → click **New Project**.
2. Delete the default code and paste the entire contents of `scripts/Code.gs`
   from this repo.
3. Click **Project Settings** (gear icon, left sidebar) → **Script Properties**
   → **Add property**:
   - Key: `AUTH_TOKEN`
   - Value: any strong secret string you make up (e.g. 32+ random characters).
   Click **Save**.

### 3b — Deploy as a web app

4. Click **Deploy → New Deployment**.
5. Set:
   - Type: **Web app**
   - Execute as: **Me** (your Google account)
   - Who has access: **Anyone**
6. Click **Deploy**. Copy the **Web App URL**
   (looks like `https://script.google.com/macros/s/…/exec`).

### 3c — Connect to the extension

7. Open the extension's **Settings** tab → **Server Scheduler** section.
8. Paste the **Web App URL** and the **AUTH_TOKEN** you chose.
9. Click **Save Settings**, then click **Test Connection** — you should see
   "✓ Connected!".

> **Note:** When you redeploy the script (e.g. after edits), choose
> "Manage Deployments → Edit → Use latest code" to keep the same URL.

---

## Step 4 — Get an AI API key

### Option A — OpenAI (GPT-4o)
1. Visit **https://platform.openai.com/api-keys**
2. Create a new secret key
3. Make sure your account has credits / a paid plan

### Option B — Google Gemini
1. Visit **https://aistudio.google.com/app/apikey**
2. Create an API key (free tier available)

---

## Step 5 — Configure the extension

1. Click the extension icon in the Chrome toolbar (or navigate to any page and
   click the icon — the side panel will open).
2. Go to the **Settings** tab inside the side panel (or right-click the extension
   icon → Options).
3. **AI Configuration**: select your provider and paste the API key.
4. **Gmail Connection**: click “Connect Gmail Account” and go through Google’s
   OAuth consent flow.
5. **Server Scheduler** (optional): paste your Apps Script URL and token,
   then click Test Connection.
6. **Default Resume**: upload your PDF resume (max 5 MB). It will be attached
   automatically to every email.
7. Click **Save Settings**.

---

## Using the extension

1. Navigate to any LinkedIn profile page (`linkedin.com/in/…`).
2. Click the extension icon — the side panel opens on the right.
3. The profile (name, headline, location) is scraped automatically.
4. Fill in:
   - **Recipient Email** — the person's email (from Apollo.io or elsewhere)
   - **What's this email about?** — e.g. "Pitch our HR analytics SaaS product"
5. Click **Generate Email with AI** — the email appears in the review section.
6. Edit the subject and body as needed.
7. Choose **Send Now** or **Schedule** (pick a future date/time).
8. Click **Send via Gmail** (or **Schedule via Gmail**).

---

## Notes

### Scheduled email delivery
If the **Server Scheduler** (Apps Script) is configured, scheduled emails are
queued on Google’s servers and fire at exactly the right time regardless of
whether your laptop or Chrome is on. The email appears in your Gmail **Sent**
folder once delivered.

If the Server Scheduler is **not** configured, the extension falls back to
`chrome.alarms` — Chrome must be running at the scheduled time.

### LinkedIn DOM changes
LinkedIn regularly updates its page structure. If profile data stops being
scraped correctly, the CSS selectors in `content.js` will need to be updated.
Open DevTools on a LinkedIn profile and inspect the elements to find the new
class names.

### Security
- Your AI API key is stored in `chrome.storage.sync` (synced across your
  Chrome profile, encrypted by Chrome).
- Your resume is stored in `chrome.storage.local` (local only, never synced).
- No data is sent to any server other than the AI provider you choose and
  Google's Gmail API.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Please navigate to a LinkedIn profile page first" | Make sure the URL is `linkedin.com/in/…` (not a company page or search) |
| Profile not scraped | Scroll down on the profile page to trigger LinkedIn's lazy loading, then click the refresh icon |
| Gmail OAuth error | Check that your Client ID is correct in manifest.json and that you're listed as a test user in Google Cloud Console |
| “Invalid API key” | Double-check you pasted the key correctly in Settings; OpenAI keys start with `sk-` |
| Extension not visible | Make sure you enabled the Side Panel via the extension icon click |
| Scheduled email not sending | Make sure Server Scheduler is configured (Settings → Server Scheduler), or that Chrome is open if using the fallback |
| “Unauthorized” in Test Connection | The AUTH_TOKEN in Script Properties doesn’t match what you pasted in extension Settings |
