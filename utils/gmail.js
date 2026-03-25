/**
 * utils/gmail.js — Gmail API helpers.
 * Exposes a global `GmailAPI` object used by sidepanel.js.
 *
 * Uses chrome.identity.launchWebAuthFlow (works with a Google "Web Application"
 * OAuth client — no need for the "Chrome Extension" client type).
 *
 * Required OAuth scopes (set on your Google Cloud OAuth client):
 *   https://www.googleapis.com/auth/gmail.send
 *   https://www.googleapis.com/auth/gmail.compose
 *   https://www.googleapis.com/auth/gmail.modify
 *   https://www.googleapis.com/auth/userinfo.email
 */

/* global chrome */

const GmailAPI = (() => {
  'use strict';

  const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

  const SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ');

  /* ─── Auth ─────────────────────────────────────────────────────── */

  /**
   * Returns the OAuth redirect URI for this extension.
   * The user must add this exact URI to their Google Cloud OAuth client's
   * "Authorized redirect URIs" list.
   */
  function getRedirectURI() {
    return chrome.identity.getRedirectURL();
  }

  /**
   * Get a valid access token.
   * - If a non-expired token is cached in local storage, return it immediately.
   * - If interactive=true, launch the Google OAuth consent page to get a fresh token.
   * - If interactive=false and no valid cached token exists, throws an error.
   */
  async function getAuthToken(interactive = false) {
    // 1. Return cached token if still valid
    const stored = await chrome.storage.local.get(['gmailToken', 'gmailTokenExpiry']);
    if (stored.gmailToken && stored.gmailTokenExpiry > Date.now()) {
      return stored.gmailToken;
    }

    if (!interactive) {
      throw new Error('No valid cached token. Please connect Gmail.');
    }

    // 2. Launch the OAuth consent flow
    const clientId = chrome.runtime.getManifest().oauth2?.client_id;
    if (!clientId || clientId.startsWith('REPLACE_WITH')) {
      throw new Error(
        'OAuth client_id is not configured. Open manifest.json and set the client_id.'
      );
    }

    const redirectUrl = chrome.identity.getRedirectURL();
    const authUrl =
      `https://accounts.google.com/o/oauth2/auth` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&prompt=select_account`;

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive: true },
        async (responseUrl) => {
          if (chrome.runtime.lastError || !responseUrl) {
            reject(
              new Error(
                chrome.runtime.lastError?.message || 'Auth flow was cancelled.'
              )
            );
            return;
          }
          try {
            // Token is returned in the URL hash fragment
            const hash = new URL(responseUrl).hash.slice(1);
            const params = new URLSearchParams(hash);
            const token = params.get('access_token');
            const expiresIn = parseInt(params.get('expires_in') || '3600', 10);

            if (!token) {
              reject(new Error('No access_token found in the OAuth response.'));
              return;
            }

            // Cache the token with a 2-minute safety buffer before real expiry
            await chrome.storage.local.set({
              gmailToken:       token,
              gmailTokenExpiry: Date.now() + (expiresIn - 120) * 1000,
            });

            resolve(token);
          } catch (e) {
            reject(new Error('Failed to parse the OAuth response URL.'));
          }
        }
      );
    });
  }

  async function revokeToken(token) {
    // Clear the local cache first
    await chrome.storage.local.remove(['gmailToken', 'gmailTokenExpiry']);
    // Best-effort server-side revoke
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
      { method: 'POST' }
    ).catch(() => {});
  }

  async function getUserEmail(token) {
    const res = await apiFetch(`${BASE}/profile`, token);
    return res.emailAddress;
  }

  /* ─── Send / Schedule ─────────────────────────────────────────── */

  /**
   * Sends or schedules an email via Gmail API.
   *
   * @param {object} opts
   * @param {string} opts.token           OAuth bearer token
   * @param {string} opts.from            Sender email (e.g. "me@gmail.com")
   * @param {string} opts.to              Recipient email
   * @param {string} opts.subject         Email subject
   * @param {string} opts.body            Plain-text email body
   * @param {string|null} opts.attachmentName    PDF filename
   * @param {string|null} opts.attachmentBase64  Base64-encoded PDF (no data: prefix)
   * @param {string|null} opts.scheduledTime     ISO 8601 datetime string (RFC 3339), or null
   * @returns {Promise<{id, scheduled, draft, message?}>}
   */
  async function sendEmail(opts) {
    const { token, from, to, subject, body, attachmentName, attachmentBase64, scheduledTime } = opts;

    const mimeRaw   = buildMimeMessage({ from, to, subject, body, attachmentName, attachmentBase64 });
    const rawBase64 = encodeBase64Url(mimeRaw);

    const reqBody = { raw: rawBase64 };

    if (scheduledTime) {
      // Gmail API scheduled send — deliveryTime as RFC 3339 timestamp
      reqBody.deliveryTime = scheduledTime;
    }

    const res = await fetch(`${BASE}/messages/send`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      if (scheduledTime) {
        // Gmail API may not support deliveryTime in all account types.
        // Fallback: save as draft and open Gmail.
        return await createScheduledDraft(token, rawBase64, scheduledTime);
      }
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return { ...data, scheduled: !!scheduledTime, draft: false };
  }

  /**
   * Fallback: creates a Gmail draft when scheduled send via API is unavailable,
   * and opens Gmail so the user can manually schedule it.
   */
  async function createScheduledDraft(token, rawBase64, scheduledTime) {
    const res = await fetch(`${BASE}/drafts`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: { raw: rawBase64 } }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `Draft creation failed (HTTP ${res.status})`);
    }

    const draft = await res.json();

    // Open Gmail Drafts folder so the user can schedule manually
    chrome.tabs.create({ url: 'https://mail.google.com/mail/u/0/#drafts' });

    const humanTime = new Date(scheduledTime).toLocaleString();
    return {
      id:        draft.id,
      scheduled: false,
      draft:     true,
      message:   `Draft created. Please open Gmail → Drafts and use "Schedule Send" to send at ${humanTime}.`,
    };
  }

  /* ─── MIME builder ────────────────────────────────────────────── */

  function buildMimeMessage({ from, to, subject, body, attachmentName, attachmentBase64 }) {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;

    const lines = [
      'MIME-Version: 1.0',
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      chunkBase64(btoa(unescape(encodeURIComponent(body)))),
      '',
    ];

    if (attachmentName && attachmentBase64) {
      lines.push(
        `--${boundary}`,
        'Content-Type: application/pdf',
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${attachmentName}"`,
        '',
        chunkBase64(attachmentBase64),
        '',
      );
    }

    lines.push(`--${boundary}--`);

    return lines.join('\r\n');
  }

  /** Split base64 into 76-char lines (RFC 2045 requirement) */
  function chunkBase64(b64) {
    return b64.match(/.{1,76}/g)?.join('\r\n') || b64;
  }

  /** Encode a string to base64url (RFC 4648 §5) — required by Gmail API */
  function encodeBase64Url(str) {
    // We need UTF-8 aware base64 encoding
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => (binary += String.fromCharCode(b)));
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /* ─── Generic fetch wrapper ───────────────────────────────────── */

  async function apiFetch(url, token, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  return { getAuthToken, revokeToken, getUserEmail, sendEmail, getRedirectURI };
})();
