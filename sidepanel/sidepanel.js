/**
 * sidepanel.js — main controller for the LinkedIn Email Assistant side panel.
 * Depends on globals exported by utils/gmail.js and utils/ai.js via <script> tags.
 */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */
const state = {
  profile: null,          // scraped LinkedIn profile
  resumeData: null,       // { name, base64 } for the current session
  savedResumeData: null,  // { name, base64 } from chrome.storage (default)
  gmailToken: null,
  gmailEmail: null,
};

/* ═══════════════════════════════════════════════════════════
   DOM references
   ═══════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const el = {
  // Tabs
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Profile card
  profileCard:      $('profile-card'),
  notLinkedin:      $('not-linkedin'),
  profileImg:       $('profile-img'),
  profileName:      $('profile-name'),
  profileHeadline:  $('profile-headline'),
  profileLocation:  $('profile-location'),
  profileLink:      $('profile-link'),
  refreshProfileBtn: $('refresh-profile-btn'),

  // Step 1
  recipientEmail:   $('recipient-email'),
  generateBtn:      $('generate-btn'),

  // Step 2 - review
  reviewSection:    $('review-section'),
  emailSubject:     $('email-subject'),
  emailBody:        $('email-body'),
  wordCount:        $('word-count'),
  insertLinkBtn:    $('insert-link-btn'),
  linkPanel:        $('link-panel'),
  linkText:         $('link-text'),
  linkUrl:          $('link-url'),
  linkInsertBtn:    $('link-insert-btn'),
  linkCancelBtn:    $('link-cancel-btn'),

  // Step 3 - send
  sendSection:      $('send-section'),
  noResumeMsg:      $('no-resume-msg'),
  resumeAttachedMsg: $('resume-attached-msg'),
  resumeFilename:   $('resume-filename'),
  detachResume:     $('detach-resume'),
  resumeUpload:     $('resume-upload'),
  useSavedResumeBtn: $('use-saved-resume-btn'),
  sendModeInputs:   document.querySelectorAll('input[name="send-mode"]'),
  schedulePicker:   $('schedule-picker'),
  scheduleDatetime: $('schedule-datetime'),
  sendBtn:          $('send-btn'),
  sendBtnIcon:      $('send-btn-icon'),
  sendBtnText:      $('send-btn-text'),

  // Status
  statusMsg:        $('status-msg'),

  // Scheduled tab
  scheduledList:    $('scheduled-list'),
  scheduledModeDesc: $('scheduled-mode-desc'),

  // Settings
  redirectUriDisplay: $('redirect-uri-display'),
  copyRedirectUri:    $('copy-redirect-uri'),
  gmailConnectBtn:    $('gmail-connect-btn'),
  gmailDisconnectBtn: $('gmail-disconnect-btn'),
  gmailStatusDot:   $('gmail-status-dot'),
  gmailStatusText:  $('gmail-status-text'),
  settingsNoResume: $('settings-no-resume'),
  settingsSavedResume: $('settings-saved-resume'),
  settingsResumeName: $('settings-resume-name'),
  settingsRemoveResume: $('settings-remove-resume'),
  settingsResumeUpload: $('settings-resume-upload'),
  saveSettingsBtn:      $('save-settings-btn'),
  subjectTemplate:      $('subject-template'),
  emailTemplate:        $('email-template'),
  scriptUrl:            $('script-url'),
  scriptSecret:         $('script-secret'),
  testScriptBtn:        $('test-script-btn'),
  testScriptResult:     $('test-script-result'),
};

/* ═══════════════════════════════════════════════════════════
   Initialisation
   ═══════════════════════════════════════════════════════════ */
async function init() {
  await loadSettings();
  await loadSavedResume();
  await checkGmailConnection();
  await refreshProfile();
  setDefaultScheduleTime();
  populateRedirectUri();
  bindEvents();
}

function populateRedirectUri() {
  if (el.redirectUriDisplay) {
    el.redirectUriDisplay.value = GmailAPI.getRedirectURI();
  }
}

/* ═══════════════════════════════════════════════════════════
   Settings persistence
   ═══════════════════════════════════════════════════════════ */
async function loadSettings() {
  const data = await chrome.storage.sync.get(['subjectTemplate', 'emailTemplate', 'scriptUrl', 'scriptSecret']);
  if (data.subjectTemplate !== undefined) el.subjectTemplate.value = data.subjectTemplate;
  if (data.emailTemplate   !== undefined) el.emailTemplate.value   = data.emailTemplate;
  if (data.scriptUrl)    el.scriptUrl.value    = data.scriptUrl;
  if (data.scriptSecret) el.scriptSecret.value = data.scriptSecret;
}

async function saveSettings() {
  await chrome.storage.sync.set({
    subjectTemplate: el.subjectTemplate.value,
    emailTemplate:   el.emailTemplate.value,
    scriptUrl:       el.scriptUrl.value.trim(),
    scriptSecret:    el.scriptSecret.value.trim(),
  });
  showStatus('Settings saved.', 'success', 2500);
}

/* ═══════════════════════════════════════════════════════════
   Resume management
   ═══════════════════════════════════════════════════════════ */
async function loadSavedResume() {
  const data = await chrome.storage.local.get(['resumeName', 'resumeBase64']);
  if (data.resumeName && data.resumeBase64) {
    state.savedResumeData = { name: data.resumeName, base64: data.resumeBase64 };
    renderSettingsResume(data.resumeName);
    el.useSavedResumeBtn.classList.remove('hidden');
  }
}

async function saveResumeToStorage(name, base64) {
  await chrome.storage.local.set({ resumeName: name, resumeBase64: base64 });
  state.savedResumeData = { name, base64 };
  renderSettingsResume(name);
  el.useSavedResumeBtn.classList.remove('hidden');
}

async function removeSavedResume() {
  await chrome.storage.local.remove(['resumeName', 'resumeBase64']);
  state.savedResumeData = null;
  renderSettingsResume(null);
  el.useSavedResumeBtn.classList.add('hidden');
}

function renderSettingsResume(name) {
  if (name) {
    el.settingsNoResume.classList.add('hidden');
    el.settingsSavedResume.classList.remove('hidden');
    el.settingsResumeName.textContent = name;
  } else {
    el.settingsSavedResume.classList.add('hidden');
    el.settingsNoResume.classList.remove('hidden');
  }
}

function renderSessionResume(name) {
  if (name) {
    el.noResumeMsg.classList.add('hidden');
    el.resumeAttachedMsg.classList.remove('hidden');
    el.resumeFilename.textContent = name;
  } else {
    el.resumeAttachedMsg.classList.add('hidden');
    el.noResumeMsg.classList.remove('hidden');
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      // Strip the "data:application/pdf;base64," prefix
      const base64 = e.target.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
/* ═══════════════════════════════════════════════════════════
   Gmail connection
   ═══════════════════════════════════════════════════════════ */
async function checkGmailConnection() {
  try {
    const token = await GmailAPI.getAuthToken(false);
    if (token) {
      const email = await GmailAPI.getUserEmail(token);
      setGmailConnected(token, email);
      return;
    }
  } catch (_) {}
  setGmailDisconnected();
}

function setGmailConnected(token, email) {
  state.gmailToken = token;
  state.gmailEmail = email;
  el.gmailStatusDot.className = 'status-dot dot-green';
  el.gmailStatusText.textContent = `Connected as ${email}`;
  el.gmailConnectBtn.classList.add('hidden');
  el.gmailDisconnectBtn.classList.remove('hidden');
}

function setGmailDisconnected() {
  state.gmailToken = null;
  state.gmailEmail = null;
  el.gmailStatusDot.className = 'status-dot dot-grey';
  el.gmailStatusText.textContent = 'Not connected';
  el.gmailConnectBtn.classList.remove('hidden');
  el.gmailDisconnectBtn.classList.add('hidden');
}

async function connectGmail() {
  setBtnLoading(el.gmailConnectBtn, true, 'Connecting…');
  try {
    const token = await GmailAPI.getAuthToken(true);
    const email = await GmailAPI.getUserEmail(token);
    setGmailConnected(token, email);
    showStatus(`Gmail connected: ${email}`, 'success', 3000);
  } catch (err) {
    showStatus(`Gmail connection failed: ${err.message}`, 'error');
  } finally {
    setBtnLoading(el.gmailConnectBtn, false, 'Connect Gmail Account');
  }
}

async function disconnectGmail() {
  if (state.gmailToken) {
    await GmailAPI.revokeToken(state.gmailToken).catch(() => {});
  }
  setGmailDisconnected();
  showStatus('Gmail disconnected.', 'info', 2500);
}

/* ═══════════════════════════════════════════════════════════
   LinkedIn profile
   ═══════════════════════════════════════════════════════════ */
async function refreshProfile() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getProfileData' });
    if (response?.error) {
      showNotLinkedIn(response.error);
    } else {
      state.profile = response;
      renderProfile(response);
    }
  } catch (_) {
    showNotLinkedIn('Navigate to a LinkedIn profile to get started.');
  }
}

function renderProfile(profile) {
  el.notLinkedin.classList.add('hidden');
  el.profileCard.classList.remove('hidden');

  el.profileName.textContent     = profile.name     || '—';
  el.profileHeadline.textContent = profile.headline || '—';
  el.profileLocation.textContent = profile.location || '';
  el.profileLink.href            = profile.profileUrl || '#';

  if (profile.profileImage) {
    el.profileImg.src = profile.profileImage;
    el.profileImg.style.display = '';
  } else {
    el.profileImg.style.display = 'none';
  }
}

function showNotLinkedIn(msg) {
  state.profile = null;
  el.profileCard.classList.add('hidden');
  el.notLinkedin.classList.remove('hidden');
  el.notLinkedin.querySelector('span:last-child').textContent = msg || 'Go to a LinkedIn profile to begin';
}

/* ═══════════════════════════════════════════════════════════
   Template fill
   ═══════════════════════════════════════════════════════════ */
function fillTemplate() {
  const bodyTemplate    = el.emailTemplate.value.trim();
  const subjectTemplate = el.subjectTemplate ? el.subjectTemplate.value.trim() : '';

  // If the body is already typed, substitute in place.
  // Only load from saved template when the body is blank.
  const hasExistingBody = el.emailBody.value.trim().length > 0;

  if (!hasExistingBody && !bodyTemplate) {
    showStatus('Type your email in the body above, or save a template in Settings \u2192 Email Template.', 'error');
    return;
  }

  if (!hasExistingBody) {
    // Load from saved template
    el.emailBody.value    = bodyTemplate;
    el.emailSubject.value = subjectTemplate;
  }

  const profile   = state.profile || {};
  const firstName = (profile.name || '').split(' ')[0];
  const company   = profile.currentCompany ||
                    (profile.experience || '').split('\n')[0].split('\u2022')[0].trim();
  const title     = profile.headline || '';
  const field     = title.split(' at ')[0].split(',')[0].trim();

  function sub(text) {
    return text
      .replace(/\[Name\]/g,        firstName    || '[Name]')
      .replace(/\[Full Name\]/g,   profile.name || '[Full Name]')
      .replace(/\[Company\]/g,     company      || '[Company]')
      .replace(/\[Their Title\]/g, title        || '[Their Title]')
      .replace(/\[Their Field\]/g, field        || '[Their Field]');
  }

  // Always substitute in whatever is currently in the fields
  el.emailBody.value    = sub(el.emailBody.value);
  el.emailSubject.value = sub(el.emailSubject.value);
  updateWordCount();

  el.reviewSection.classList.remove('hidden');
  el.sendSection.classList.remove('hidden');
  el.reviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateWordCount() {
  const words = el.emailBody.value.trim().split(/\s+/).filter(Boolean).length;
  el.wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
}

/* ═══════════════════════════════════════════════════════════
   HTML body builder
   ═══════════════════════════════════════════════════════════ */
/**
 * Converts plain-text body (with [text](url) link syntax) to a simple HTML email.
 * Returns null if there are no links (no need for HTML path).
 */
function toHtmlBody(plain) {
  const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  if (!LINK_RE.test(plain)) return null; // no links — plain text is fine
  LINK_RE.lastIndex = 0;

  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  let html = '';
  let last = 0;
  let m;
  while ((m = LINK_RE.exec(plain)) !== null) {
    // Text before this link
    html += esc(plain.slice(last, m.index)).replace(/\n/g, '<br>');
    html += `<a href="${esc(m[2])}" style="color:#0a66c2;">${esc(m[1])}</a>`;
    last = m.index + m[0].length;
  }
  html += esc(plain.slice(last)).replace(/\n/g, '<br>');

  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;">${html}</div>`;
}

/* ═══════════════════════════════════════════════════════════
   Send / Schedule
   ═══════════════════════════════════════════════════════════ */
async function sendEmail() {
  const to      = el.recipientEmail.value.trim();
  const subject = el.emailSubject.value.trim();
  const body    = el.emailBody.value.trim();
  const mode    = [...el.sendModeInputs].find(r => r.checked)?.value;

  // Validation
  if (!to || !isValidEmail(to)) {
    showStatus('Enter a valid recipient email address.', 'error');
    return;
  }
  if (!subject) { showStatus('Subject cannot be empty.', 'error'); return; }
  if (!body)    { showStatus('Email body cannot be empty.', 'error'); return; }

  if (!state.gmailToken) {
    showStatus('Please connect your Gmail account in Settings first.', 'error');
    return;
  }

  let scheduledTime = null;
  if (mode === 'schedule') {
    const dtVal = el.scheduleDatetime.value;
    if (!dtVal) { showStatus('Pick a date and time to schedule the email.', 'error'); return; }
    scheduledTime = new Date(dtVal);
    if (scheduledTime <= new Date()) {
      showStatus('Scheduled time must be in the future.', 'error');
      return;
    }
  }

  const resume = state.resumeData || state.savedResumeData || null;
  const htmlBody = toHtmlBody(body);

  setBtnLoading(el.sendBtn, true, mode === 'schedule' ? 'Scheduling…' : 'Sending…');

  try {
    if (mode === 'schedule') {
      const script = await getScriptConfig_();
      if (script) {
        // Server-side scheduling via Google Apps Script — works when Chrome/laptop is off
        const res = await fetch(script.url, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action:          'schedule',
            secret:          script.secret,
            to,
            subject,
            body,
            htmlBody:         htmlBody || null,
            attachmentName:   resume?.name   || null,
            attachmentBase64: resume?.base64 || null,
            scheduledTime:   scheduledTime.toISOString(),
          }),
        });
        const rawText = await res.text();
        if (rawText.trim().startsWith('<')) {
          throw new Error('Apps Script returned an HTML page — redeploy the script with a new version, then try again.');
        }
        const result = JSON.parse(rawText);
        if (!result.success) throw new Error(result.error || 'Scheduling failed.');
        showStatus(`✅ Scheduled via Google Apps Script for ${scheduledTime.toLocaleString()}.`, 'success');
      } else {
        // Fallback: chrome.alarms (Chrome must be open at send time)
        const response = await chrome.runtime.sendMessage({
          action: 'scheduleEmail',
          emailData: {
            from:            state.gmailEmail,
            to,
            subject,
            body,
            attachmentName:   resume?.name   || null,
            attachmentBase64: resume?.base64 || null,
          },
          scheduledTime: scheduledTime.toISOString(),
        });
        if (!response?.success) throw new Error(response?.error || 'Scheduling failed.');
        showStatus(`⏰ Scheduled for ${scheduledTime.toLocaleString()}. (Tip: set up Server Scheduler so Chrome doesn’t need to be open.)`, 'info');
      }
      loadScheduledEmails();
    } else {
      const token = await GmailAPI.getAuthToken(false);
      await GmailAPI.sendEmail({
        token,
        from:            state.gmailEmail,
        to,
        subject,
        body,
        htmlBody:         htmlBody || null,
        attachmentName:   resume?.name   || null,
        attachmentBase64: resume?.base64 || null,
      });
      showStatus('Email sent successfully!', 'success');
    }

    // Clear the compose form
    el.emailSubject.value = '';
    el.emailBody.value    = '';
    el.reviewSection.classList.add('hidden');
    el.sendSection.classList.add('hidden');

  } catch (err) {
    showStatus(`Send failed: ${err.message}`, 'error');
  } finally {
    const icon = mode === 'schedule'
      ? `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
      : `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
    setBtnLoading(el.sendBtn, false,
      mode === 'schedule' ? 'Schedule via Gmail' : 'Send via Gmail', icon);
  }
}

/* ═══════════════════════════════════════════════════════════
   UI helpers
   ═══════════════════════════════════════════════════════════ */
function showStatus(msg, type = 'info', autoDismissMs = 0) {
  el.statusMsg.textContent = msg;
  el.statusMsg.className = `status-banner ${type}`;
  el.statusMsg.classList.remove('hidden');

  if (autoDismissMs > 0) {
    setTimeout(() => el.statusMsg.classList.add('hidden'), autoDismissMs);
  }
}

function setBtnLoading(btn, loading, text, iconHtml = '') {
  btn.disabled = loading;
  if (loading) {
    btn.innerHTML = `<span class="spinner"></span>${text}`;
  } else {
    btn.innerHTML = `${iconHtml}${text}`;
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getScriptConfig_() {
  const data = await chrome.storage.sync.get(['scriptUrl', 'scriptSecret']);
  if (data.scriptUrl && data.scriptSecret) {
    return { url: data.scriptUrl, secret: data.scriptSecret };
  }
  return null;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadScheduledEmails() {
  if (!el.scheduledList) return;

  const script = await getScriptConfig_();

  if (script) {
    // ── Server-side queue (Apps Script) ──────────────────────────
    if (el.scheduledModeDesc) {
      el.scheduledModeDesc.innerHTML = '✅ <strong>Server Scheduler active.</strong> Emails send from Google\'s servers — your laptop and Chrome do not need to be open.';
      el.scheduledModeDesc.style.color = '#057642';
    }
    try {
      const res  = await fetch(script.url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', secret: script.secret }),
      });
      const data = await res.json();
      if (!data.success) {
        el.scheduledList.innerHTML = `<div class="scheduled-empty">Could not load: ${escHtml(data.error)}</div>`;
        return;
      }
      if (!data.jobs.length) {
        el.scheduledList.innerHTML = '<div class="scheduled-empty">No scheduled emails.</div>';
        return;
      }
      el.scheduledList.innerHTML = '';
      data.jobs.forEach(job => {
        const humanTime = new Date(job.scheduledTime).toLocaleString();
        const item = document.createElement('div');
        item.className = 'scheduled-item';
        item.innerHTML = `
          <div class="scheduled-item-info">
            <div class="scheduled-item-to">${escHtml(job.to || '—')}</div>
            <div class="scheduled-item-subj">${escHtml(job.subject || '(no subject)')}</div>
            <div class="scheduled-item-time">☁️ ${humanTime}</div>
          </div>
          <button class="btn btn-ghost btn-sm" data-cancel-script="${escHtml(job.id)}" title="Cancel">Cancel</button>
        `;
        el.scheduledList.appendChild(item);
      });
      el.scheduledList.querySelectorAll('[data-cancel-script]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const jobId = btn.dataset.cancelScript;
          try {
            await fetch(script.url, {
              method: 'POST',
              redirect: 'follow',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'cancel', secret: script.secret, jobId }),
            });
          } catch (_) {}
          loadScheduledEmails();
        });
      });
    } catch (_) {
      el.scheduledList.innerHTML = '<div class="scheduled-empty">Could not reach the Apps Script server.</div>';
    }
    return;
  }

  // ── Fallback: chrome.alarms queue ────────────────────────────
  if (el.scheduledModeDesc) {
    el.scheduledModeDesc.innerHTML = '⚠️ <strong>Server Scheduler not configured.</strong> Chrome must be open at send time. Go to <strong>Settings → Server Scheduler</strong> to remove this limitation.';
    el.scheduledModeDesc.style.color = '#b45309';
  }
  const alarms  = await chrome.alarms.getAll();
  const pending = alarms.filter(a => a.name.startsWith('scheduledEmail_'));

  if (pending.length === 0) {
    el.scheduledList.innerHTML = '<div class="scheduled-empty">No scheduled emails.<br><small style="color:#888;">Tip: configure Server Scheduler in Settings so emails send without Chrome.</small></div>';
    return;
  }

  const stored = await chrome.storage.local.get(pending.map(a => a.name));

  el.scheduledList.innerHTML = '';
  pending
    .sort((a, b) => a.scheduledTime - b.scheduledTime)
    .forEach(alarm => {
      const data = stored[alarm.name];
      if (!data) return;
      const humanTime = new Date(alarm.scheduledTime).toLocaleString();
      const item = document.createElement('div');
      item.className = 'scheduled-item';
      item.innerHTML = `
        <div class="scheduled-item-info">
          <div class="scheduled-item-to">${escHtml(data.to || '—')}</div>
          <div class="scheduled-item-subj">${escHtml(data.subject || '(no subject)')}</div>
          <div class="scheduled-item-time">⏰ ${humanTime} <span style="color:#c50;font-size:10px;">(Chrome must be open)</span></div>
        </div>
        <button class="btn btn-ghost btn-sm" data-cancel="${escHtml(alarm.name)}" title="Cancel">Cancel</button>
      `;
      el.scheduledList.appendChild(item);
    });

  el.scheduledList.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.cancel;
      await chrome.alarms.clear(name);
      await chrome.storage.local.remove(name);
      loadScheduledEmails();
    });
  });
}

function setDefaultScheduleTime() {
  // Default to tomorrow at 9 AM
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  // datetime-local format: YYYY-MM-DDTHH:MM
  const pad = n => String(n).padStart(2, '0');
  el.scheduleDatetime.value =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  el.scheduleDatetime.min =
    (() => {
      const now = new Date(Date.now() + 5 * 60 * 1000); // 5 min buffer
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    })();
}

function updateSendBtnLabel() {
  const mode = [...el.sendModeInputs].find(r => r.checked)?.value;
  if (mode === 'schedule') {
    el.sendBtnText.textContent = 'Schedule via Gmail';
    el.sendBtnIcon.outerHTML = `<svg id="send-btn-icon" class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    el.schedulePicker.classList.remove('hidden');
  } else {
    el.sendBtnText.textContent = 'Send via Gmail';
    el.sendBtnIcon.outerHTML = `<svg id="send-btn-icon" class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
    el.schedulePicker.classList.add('hidden');
  }
}

/* ═══════════════════════════════════════════════════════════
   Event bindings
   ═══════════════════════════════════════════════════════════ */
function bindEvents() {
  // Tab switching
  el.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      el.tabBtns.forEach(b => b.classList.remove('active'));
      el.tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = $(`${btn.dataset.tab}`);
      target.classList.remove('hidden'); // must remove hidden — it carries display:none !important
      target.classList.add('active');
    });
  });

  // Fill template
  el.generateBtn.addEventListener('click', fillTemplate);

  // Insert Link button — shows/hides the mini link panel
  el.insertLinkBtn.addEventListener('click', () => {
    el.linkPanel.classList.toggle('hidden');
    if (!el.linkPanel.classList.contains('hidden')) el.linkText.focus();
  });
  el.linkCancelBtn.addEventListener('click', () => {
    el.linkPanel.classList.add('hidden');
    el.linkText.value = '';
    el.linkUrl.value  = '';
  });
  el.linkInsertBtn.addEventListener('click', () => {
    const text = el.linkText.value.trim();
    const url  = el.linkUrl.value.trim();
    if (!text || !url) { showStatus('Enter both display text and URL.', 'error', 2500); return; }
    const snippet = `[${text}](${url})`;
    const ta    = el.emailBody;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + snippet + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + snippet.length;
    ta.focus();
    el.linkPanel.classList.add('hidden');
    el.linkText.value = '';
    el.linkUrl.value  = '';
    updateWordCount();
  });

  // Word count on edit
  el.emailBody.addEventListener('input', updateWordCount);

  // Send mode radio
  el.sendModeInputs.forEach(r => r.addEventListener('change', updateSendBtnLabel));

  // Send
  el.sendBtn.addEventListener('click', sendEmail);

  // Resume upload (session)
  el.resumeUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      showStatus('Please select a PDF file.', 'error', 3000);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showStatus('PDF must be under 5 MB.', 'error', 3000);
      return;
    }
    const base64 = await readFileAsBase64(file);
    state.resumeData = { name: file.name, base64 };
    renderSessionResume(file.name);
    e.target.value = '';
  });

  // Detach session resume
  el.detachResume.addEventListener('click', () => {
    state.resumeData = null;
    renderSessionResume(null);
    // Optionally re-show "Use Saved" button if there's a saved one
    if (state.savedResumeData) el.useSavedResumeBtn.classList.remove('hidden');
  });

  // Use saved resume
  el.useSavedResumeBtn.addEventListener('click', () => {
    if (state.savedResumeData) {
      state.resumeData = { ...state.savedResumeData };
      renderSessionResume(state.savedResumeData.name);
      el.useSavedResumeBtn.classList.add('hidden');
    }
  });

  // Settings — Test Apps Script connection
  el.testScriptBtn.addEventListener('click', async () => {
    const url    = el.scriptUrl.value.trim();
    const secret = el.scriptSecret.value.trim();
    const res_el = el.testScriptResult;
    if (!url || !secret) { res_el.textContent = '⚠ Paste the URL and secret first.'; res_el.style.color = 'orange'; return; }
    el.testScriptBtn.disabled = true;
    el.testScriptBtn.textContent = 'Testing…';
    res_el.textContent = '';
    try {
      const res  = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', secret }),
      });
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        res_el.innerHTML = '✗ Google returned an HTML page instead of JSON.<br>'
          + '<strong>Fix:</strong> Open the Apps Script editor → Run <code>processEmailQueue</code> once manually to grant Gmail permission, then try again.';
        res_el.style.color = '#cc1016';
        return;
      }
      const data = JSON.parse(text);
      if (data.success) {
        res_el.textContent = `✓ Connected! ${data.jobs.length} scheduled job(s).`;
        res_el.style.color = '#057642';
      } else {
        res_el.textContent = `✗ ${data.error}`;
        res_el.style.color = '#cc1016';
      }
    } catch (err) {
      res_el.textContent = `✗ ${err.message}`;
      res_el.style.color = '#cc1016';
    } finally {
      el.testScriptBtn.disabled = false;
      el.testScriptBtn.textContent = 'Test Connection';
    }
  });

  // Settings — save
  el.saveSettingsBtn.addEventListener('click', saveSettings);

  // Copy redirect URI
  el.copyRedirectUri?.addEventListener('click', () => {
    navigator.clipboard.writeText(el.redirectUriDisplay.value).then(() => {
      el.copyRedirectUri.textContent = 'Copied!';
      setTimeout(() => { el.copyRedirectUri.textContent = 'Copy'; }, 2000);
    });
  });

  // Settings — Gmail connect / disconnect
  el.gmailConnectBtn.addEventListener('click', connectGmail);
  el.gmailDisconnectBtn.addEventListener('click', disconnectGmail);

  // Settings — resume upload (default)
  el.settingsResumeUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      showStatus('Please select a PDF file.', 'error', 3000);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showStatus('PDF must be under 5 MB.', 'error', 3000);
      return;
    }
    const base64 = await readFileAsBase64(file);
    await saveResumeToStorage(file.name, base64);
    showStatus(`"${file.name}" saved as default resume.`, 'success', 3000);
    e.target.value = '';
  });

  // Settings — remove saved resume
  el.settingsRemoveResume.addEventListener('click', async () => {
    await removeSavedResume();
    showStatus('Default resume removed.', 'info', 2500);
  });

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'pageChanged') {
      // Retry twice — LinkedIn SPA renders async, needs time
      setTimeout(refreshProfile, 1500);
      setTimeout(refreshProfile, 4000);
    }
    if (msg.action === 'scheduledEmailSent') {
      showStatus(`Scheduled email to ${msg.to} was sent successfully.`, 'success', 6000);
      loadScheduledEmails();
    }
  });

  // Load scheduled list when the tab is clicked
  el.tabBtns.forEach(btn => {
    if (btn.dataset.tab === 'scheduled') {
      btn.addEventListener('click', loadScheduledEmails);
    }
  });

  // Manual refresh button on profile card
  if (el.refreshProfileBtn) {
    el.refreshProfileBtn.addEventListener('click', refreshProfile);
  }
}

/* ═══════════════════════════════════════════════════════════
   Boot
   ═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', init);
