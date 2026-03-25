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
  emailContext:     $('email-context'),
  generateBtn:      $('generate-btn'),

  // Step 2 - review
  reviewSection:    $('review-section'),
  emailSubject:     $('email-subject'),
  emailBody:        $('email-body'),
  regenerateBtn:    $('regenerate-btn'),
  wordCount:        $('word-count'),

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

  // Settings
  aiProvider:         $('ai-provider'),
  aiApiKey:           $('ai-api-key'),
  geminiModel:        $('gemini-model'),
  geminiModelGroup:   $('gemini-model-group'),
  groqModel:          $('groq-model'),
  groqModelGroup:     $('groq-model-group'),
  toggleKeyVis:       $('toggle-key-vis'),
  testApiKeyBtn:      $('test-api-key-btn'),
  testApiKeyResult:   $('test-api-key-result'),
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
  emailTemplate:        $('email-template'),
  senderBackground:     $('sender-background'),
  extractResumeBtn:     $('extract-from-resume-btn'),
  extractResumeStatus:  $('extract-resume-status'),
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
  const data = await chrome.storage.sync.get(['aiProvider', 'aiApiKey', 'geminiModel', 'groqModel', 'emailTemplate', 'senderBackground']);
  if (data.aiProvider)        el.aiProvider.value        = data.aiProvider;
  if (data.aiApiKey)          el.aiApiKey.value          = data.aiApiKey;
  if (data.geminiModel)       el.geminiModel.value       = data.geminiModel;
  if (data.groqModel)         el.groqModel.value         = data.groqModel;
  if (data.emailTemplate !== undefined) el.emailTemplate.value = data.emailTemplate;
  if (data.senderBackground !== undefined) el.senderBackground.value = data.senderBackground;
  updateModelVisibility();
}

async function saveSettings() {
  await chrome.storage.sync.set({
    aiProvider:       el.aiProvider.value,
    aiApiKey:         el.aiApiKey.value.trim(),
    geminiModel:      el.geminiModel.value,
    groqModel:        el.groqModel.value,
    emailTemplate:    el.emailTemplate.value,
    senderBackground: el.senderBackground.value,
  });
  showStatus('Settings saved.', 'success', 2500);
}

function updateGeminiModelVisibility() { updateModelVisibility(); }

function updateModelVisibility() {
  const p = el.aiProvider.value;
  el.geminiModelGroup.classList.toggle('hidden', p !== 'gemini');
  el.groqModelGroup.classList.toggle('hidden',   p !== 'groq');
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

// Best-effort text extraction from a PDF file.
// Works for PDFs with an uncompressed text layer (most Word/Google Docs exports).
function extractTextFromPDF(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = e.target.result;
        const words = [];

        // Strategy 1: PDF text operators — (string)Tj and [(string)]TJ
        const tjRe = /\(([^\\)]{2,100})\)\s*T[jJ]/g;
        let m;
        while ((m = tjRe.exec(raw)) !== null) {
          const s = m[1].replace(/\\[0-9]{3}/g, ' ').replace(/\\\\/g, '').trim();
          if (/[a-zA-Z]{2,}/.test(s)) words.push(s);
        }

        // Strategy 2: grab long readable sequences from uncompressed streams
        const readable = raw.match(/[A-Za-z][A-Za-z0-9 ,.()\-+@&'"/]{12,}/g) || [];
        words.push(...readable.filter(s => /[a-z]{4,}/i.test(s) && !/^(endobj|startxref|stream|xref|obj\b)/.test(s)));

        const result = [...new Set(words)].join(' ').replace(/\s+/g, ' ').trim().slice(0, 2500);
        resolve(result);
      } catch (_) {
        resolve('');
      }
    };
    reader.onerror = () => resolve('');
    reader.readAsText(file, 'latin1'); // latin1 preserves all byte values as characters
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
   Email generation
   ═══════════════════════════════════════════════════════════ */
async function generateEmail() {
  const apiKey   = el.aiApiKey.value.trim();
  const provider = el.aiProvider.value;
  const context  = el.emailContext.value.trim();

  if (!apiKey) {
    showStatus('Add your AI API key in the Settings tab first.', 'error');
    return;
  }
  if (!context) {
    showStatus('Please describe what this email is about.', 'error');
    return;
  }
  // Use empty profile data if not on LinkedIn
  const profile = state.profile || {};

  setBtnLoading(el.generateBtn, true, 'Generating…');

  try {
    const model = el.aiProvider.value === 'gemini' ? el.geminiModel.value
              : el.aiProvider.value === 'groq'   ? el.groqModel.value
              : undefined;
    const template = el.emailTemplate.value.trim() || null;
    const senderBg = el.senderBackground.value.trim() || null;
    const { subject, body } = await AIHelper.generateEmail(profile, context, apiKey, provider, model, template, senderBg);
    el.emailSubject.value = subject;
    el.emailBody.value    = body;
    updateWordCount();

    el.reviewSection.classList.remove('hidden');
    el.sendSection.classList.remove('hidden');
    el.reviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showStatus(`Generation failed: ${err.message}`, 'error');
  } finally {
    setBtnLoading(el.generateBtn, false, 'Generate Email with AI',
      `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`);
  }
}

function updateWordCount() {
  const words = el.emailBody.value.trim().split(/\s+/).filter(Boolean).length;
  el.wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
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

  setBtnLoading(el.sendBtn, true, mode === 'schedule' ? 'Scheduling…' : 'Sending…');

  try {
    // Refresh token silently before sending
    const token = await GmailAPI.getAuthToken(false);

    const result = await GmailAPI.sendEmail({
      token,
      from:            state.gmailEmail,
      to,
      subject,
      body,
      attachmentName:   resume?.name   || null,
      attachmentBase64: resume?.base64 || null,
      scheduledTime:    scheduledTime?.toISOString() || null,
    });

    if (result.scheduled) {
      showStatus(`Email scheduled for ${scheduledTime.toLocaleString()}.`, 'success');
    } else if (result.draft) {
      showStatus(`Saved as draft. ${result.message}`, 'info');
    } else {
      showStatus('Email sent successfully!', 'success');
    }

    // Clear the compose form
    el.emailSubject.value = '';
    el.emailBody.value    = '';
    el.reviewSection.classList.add('hidden');
    el.sendSection.classList.add('hidden');
    el.emailContext.value = '';

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
   Test API Key
   ═══════════════════════════════════════════════════════════ */
async function testApiKey() {
  const apiKey   = el.aiApiKey.value.trim();
  const provider = el.aiProvider.value;
  const model    = el.aiProvider.value === 'gemini' ? el.geminiModel?.value
                 : el.aiProvider.value === 'groq'   ? el.groqModel?.value
                 : 'gpt-4o';
  const resultEl = el.testApiKeyResult;

  if (!apiKey) { resultEl.textContent = '⚠ Paste your API key first.'; resultEl.style.color = 'orange'; return; }

  el.testApiKeyBtn.disabled = true;
  el.testApiKeyBtn.textContent = 'Testing…';
  resultEl.textContent = '';

  try {
    let res, data;
    if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'gpt-4o', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
      });
    } else if (provider === 'groq') {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
      });
    } else {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }], generationConfig: { maxOutputTokens: 5 } }),
        }
      );
    }
    data = await res.json();
    if (res.ok) {
      resultEl.textContent = '✓ API key works!';
      resultEl.style.color = '#057642';
    } else {
      const msg = data?.error?.message || JSON.stringify(data);
      resultEl.textContent = `✗ ${msg}`;
      resultEl.style.color = '#cc1016';
    }
  } catch (e) {
    resultEl.textContent = `✗ Network error: ${e.message}`;
    resultEl.style.color = '#cc1016';
  } finally {
    el.testApiKeyBtn.disabled = false;
    el.testApiKeyBtn.textContent = 'Test API Key';
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

  // Generate / regenerate
  el.generateBtn.addEventListener('click', generateEmail);
  el.regenerateBtn.addEventListener('click', generateEmail);

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

  // Settings — provider change shows/hides model selector
  el.aiProvider.addEventListener('change', updateGeminiModelVisibility);

  // Settings — Test API Key
  $('test-api-key-btn').addEventListener('click', testApiKey);

  // Settings — API key visibility toggle
  el.toggleKeyVis.addEventListener('click', () => {
    const isHidden = el.aiApiKey.type === 'password';
    el.aiApiKey.type = isHidden ? 'text' : 'password';
    el.toggleKeyVis.title = isHidden ? 'Hide key' : 'Show key';
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

  // Settings — extract text from saved resume PDF into the senderBackground field
  el.extractResumeBtn.addEventListener('click', async () => {
    const stored = await chrome.storage.local.get(['resumeBase64', 'resumeName']);
    if (!stored.resumeBase64) {
      el.extractResumeStatus.textContent = 'No saved resume found. Upload one in the Default Resume section first.';
      return;
    }
    el.extractResumeStatus.textContent = 'Extracting…';
    try {
      // Convert base64 back to a Blob/File for text extraction
      const binary = atob(stored.resumeBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], stored.resumeName || 'resume.pdf', { type: 'application/pdf' });
      const text = await extractTextFromPDF(file);
      if (text && text.length > 40) {
        el.senderBackground.value = text;
        el.extractResumeStatus.textContent = '✓ Extracted! Review and clean up, then Save Settings.';
      } else {
        el.extractResumeStatus.textContent = 'Could not extract text (PDF may be scanned/image-based). Paste your background manually.';
      }
    } catch (err) {
      el.extractResumeStatus.textContent = 'Extraction failed. Please paste your background manually.';
    }
  });

  // Listen for page changes from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'pageChanged') {
      // Retry twice — LinkedIn SPA renders async, needs time
      setTimeout(refreshProfile, 1500);
      setTimeout(refreshProfile, 4000);
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
