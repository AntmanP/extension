/* global GmailAPI, chrome */
(async () => {
  'use strict';

  const $ = id => document.getElementById(id);

  const aiProvider    = $('ai-provider');
  const geminiModel   = $('gemini-model');
  const geminiModelGroup = $('gemini-model-group');
  const groqModel     = $('groq-model');
  const groqModelGroup = $('groq-model-group');
  const aiApiKey      = $('ai-api-key');
  const toggleKey     = $('toggle-key');
  const gmailDot      = $('gmail-dot');
  const gmailStatus   = $('gmail-status-text');
  const connectBtn    = $('gmail-connect-btn');
  const disconnectBtn = $('gmail-disconnect-btn');
  const resumeBox     = $('resume-box');
  const resumeLabel   = $('resume-label');
  const removeResumeBtn = $('remove-resume-btn');
  const resumeUpload  = $('resume-upload');
  const saveBtn       = $('save-btn');
  const statusMsg     = $('status-msg');

  let gmailToken = null;

  /* ── Load settings ─────────────────────────────────────── */
  const stored = await chrome.storage.sync.get(['aiProvider', 'aiApiKey', 'geminiModel', 'groqModel']);
  if (stored.aiProvider)  aiProvider.value  = stored.aiProvider;
  if (stored.aiApiKey)    aiApiKey.value    = stored.aiApiKey;
  if (stored.geminiModel) geminiModel.value = stored.geminiModel;
  if (stored.groqModel)   groqModel.value   = stored.groqModel;

  function updateModelVisibility() {
    const p = aiProvider.value;
    geminiModelGroup.style.display = p === 'gemini' ? '' : 'none';
    groqModelGroup.style.display   = p === 'groq'   ? '' : 'none';
  }
  updateModelVisibility();
  aiProvider.addEventListener('change', updateModelVisibility);

  /* ── Load resume ───────────────────────────────────────── */
  const resumeData = await chrome.storage.local.get(['resumeName']);
  if (resumeData.resumeName) renderResume(resumeData.resumeName);

  /* ── Check Gmail ───────────────────────────────────────── */
  try {
    const token = await GmailAPI.getAuthToken(false);
    if (token) {
      const email = await GmailAPI.getUserEmail(token);
      setConnected(token, email);
    }
  } catch (_) {
    setDisconnected();
  }

  /* ── Helpers ───────────────────────────────────────────── */
  function renderResume(name) {
    resumeLabel.innerHTML = `<span class="attachment-name">📄 ${name}</span>`;
    removeResumeBtn.style.display = '';
  }

  function setConnected(token, email) {
    gmailToken = token;
    gmailDot.className = 'dot dot-green';
    gmailStatus.textContent = `Connected: ${email}`;
    connectBtn.style.display    = 'none';
    disconnectBtn.style.display = '';
  }

  function setDisconnected() {
    gmailToken = null;
    gmailDot.className = 'dot dot-grey';
    gmailStatus.textContent = 'Not connected';
    connectBtn.style.display    = '';
    disconnectBtn.style.display = 'none';
  }

  function showMsg(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status-msg ${type}`;
  }

  /* ── Events ────────────────────────────────────────────── */
  toggleKey.addEventListener('click', () => {
    const hidden = aiApiKey.type === 'password';
    aiApiKey.type      = hidden ? 'text'    : 'password';
    toggleKey.textContent = hidden ? 'Hide' : 'Show';
  });

  connectBtn.addEventListener('click', async () => {
    connectBtn.textContent = 'Connecting…';
    connectBtn.disabled = true;
    try {
      const token = await GmailAPI.getAuthToken(true);
      const email = await GmailAPI.getUserEmail(token);
      setConnected(token, email);
      showMsg(`Gmail connected: ${email}`, 'success');
    } catch (err) {
      showMsg(`Connection failed: ${err.message}`, 'error');
    } finally {
      connectBtn.textContent = 'Connect Gmail';
      connectBtn.disabled = false;
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    if (gmailToken) await GmailAPI.revokeToken(gmailToken).catch(() => {});
    setDisconnected();
    showMsg('Gmail disconnected.', 'success');
  });

  resumeUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { showMsg('Please select a PDF.', 'error'); return; }
    if (file.size > 5 * 1024 * 1024)    { showMsg('File must be under 5 MB.', 'error'); return; }

    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = ev => res(ev.target.result.split(',')[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

    await chrome.storage.local.set({ resumeName: file.name, resumeBase64: base64 });
    renderResume(file.name);
    showMsg(`"${file.name}" saved as default resume.`, 'success');
    e.target.value = '';
  });

  removeResumeBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(['resumeName', 'resumeBase64']);
    resumeLabel.textContent = 'No default resume saved';
    removeResumeBtn.style.display = 'none';
    showMsg('Default resume removed.', 'success');
  });

  saveBtn.addEventListener('click', async () => {
    await chrome.storage.sync.set({
      aiProvider:  aiProvider.value,
      aiApiKey:    aiApiKey.value.trim(),
      geminiModel: geminiModel.value,
      groqModel:   groqModel.value,
    });
    showMsg('Settings saved!', 'success');
    setTimeout(() => { statusMsg.className = 'status-msg'; }, 3000);
  });
})();
