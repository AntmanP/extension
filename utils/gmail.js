/**
 * utils/gmail.js — Gmail API helpers.
 * Exposes a global `GmailAPI` object used by sidepanel.js.
 *
 * Requires the 'identity' permission and the 'oauth2' block in manifest.json.
 * Scopes needed:
 *   https://www.googleapis.com/auth/gmail.send
 *   https://www.googleapis.com/auth/gmail.compose
 *   https://www.googleapis.com/auth/gmail.modify
 *   https://www.googleapis.com/auth/userinfo.email
 */

/* global chrome */

const GmailAPI = (() => {
  'use strict';

  const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

  /* ─── Auth ─────────────────────────────────────────────────────── */

  function getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!token) {
          reject(new Error('No token returned.'));
        } else {
          resolve(token);
        }
      });
    });
  }

  function revokeToken(token) {
    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => {
        // Also revoke on Google's servers
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
          .catch(() => {})
          .finally(resolve);
      });
    });
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

  return { getAuthToken, revokeToken, getUserEmail, sendEmail };
})();
