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
   - Application type: **Chrome Extension**
   - Item ID: paste the **Extension ID** you copied in Step 1

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

## Step 3 — Get an AI API key

### Option A — OpenAI (GPT-4o)
1. Visit **https://platform.openai.com/api-keys**
2. Create a new secret key
3. Make sure your account has credits / a paid plan

### Option B — Google Gemini
1. Visit **https://aistudio.google.com/app/apikey**
2. Create an API key (free tier available)

---

## Step 4 — Configure the extension

1. Click the extension icon in the Chrome toolbar (or navigate to any page and
   click the icon — the side panel will open).
2. Go to the **Settings** tab inside the side panel (or right-click the extension
   icon → Options).
3. **AI Configuration**: select your provider and paste the API key.
4. **Gmail Connection**: click "Connect Gmail Account" and go through Google's
   OAuth consent flow.
5. **Default Resume**: upload your PDF resume (max 5 MB). It will be attached
   automatically to every email.
6. Click **Save Settings**.

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

### Gmail scheduled send
The extension attempts to schedule emails using the `deliveryTime` field in the
Gmail API. If your Google Workspace plan doesn't support this, the extension
automatically creates a **Gmail Draft** and opens your Gmail Drafts folder so
you can use Gmail's built-in "Schedule Send" button.

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
| "Invalid API key" | Double-check you pasted the key correctly in Settings; OpenAI keys start with `sk-` |
| Extension not visible | Make sure you enabled the Side Panel via the extension icon click |
