/**
 * LinkedIn Email Assistant — Google Apps Script Backend
 *
 * This script runs on Google's servers 24/7, sending scheduled emails
 * even when your laptop is off or Chrome is closed.
 *
 * ── SETUP (one-time) ────────────────────────────────────────────────
 * 1. Go to https://script.google.com → New Project → paste this code.
 * 2. Project Settings (gear icon) → Script Properties → Add property:
 *      Key:   AUTH_TOKEN
 *      Value: (any strong secret string you choose, e.g. 32+ random chars)
 * 3. Click Deploy → New Deployment:
 *      Type:           Web app
 *      Execute as:     Me (your Google account)
 *      Who has access: Anyone
 *    Click Deploy, copy the Web App URL.
 * 4. In the extension → Settings → Server Scheduler:
 *      Paste the Web App URL and the same AUTH_TOKEN.
 * ────────────────────────────────────────────────────────────────────
 */

// ─── Public entry points ────────────────────────────────────────────

/**
 * Handles POST requests from the extension.
 * Supported actions: "schedule", "cancel", "list"
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (!isAuthorized_(data.secret)) {
      return jsonOut_({ success: false, error: 'Unauthorized' });
    }

    if (data.action === 'schedule') {
      const jobId = Utilities.getUuid();
      const job = {
        id:               jobId,
        to:               data.to,
        subject:          data.subject,
        body:             data.body,
        attachmentBase64: data.attachmentBase64 || null,
        attachmentName:   data.attachmentName   || null,
        scheduledTime:    data.scheduledTime,
        createdAt:        new Date().toISOString(),
      };
      PropertiesService.getScriptProperties().setProperty('job_' + jobId, JSON.stringify(job));
      ensureTrigger_();
      return jsonOut_({ success: true, jobId });
    }

    if (data.action === 'cancel') {
      PropertiesService.getScriptProperties().deleteProperty('job_' + data.jobId);
      return jsonOut_({ success: true });
    }

    if (data.action === 'list') {
      return jsonOut_({ success: true, jobs: getQueuedJobs_() });
    }

    return jsonOut_({ success: false, error: 'Unknown action.' });
  } catch (err) {
    return jsonOut_({ success: false, error: err.message });
  }
}

/**
 * doGet is kept as a no-op stub (required by Apps Script for web app deployments).
 */
function doGet(e) {
  return jsonOut_({ success: false, error: 'Use POST.' });
}

// ─── Internal ───────────────────────────────────────────────────────

/**
 * Triggered every minute (while jobs are pending) to send due emails.
 */
function processEmailQueue() {
  const now   = new Date();
  const props = PropertiesService.getScriptProperties().getProperties();
  let hasRemaining = false;

  for (const key in props) {
    if (!key.startsWith('job_')) continue;
    try {
      const job = JSON.parse(props[key]);
      if (new Date(job.scheduledTime) <= now) {
        sendJobEmail_(job);
        PropertiesService.getScriptProperties().deleteProperty(key);
      } else {
        hasRemaining = true;
      }
    } catch (_) {
      // Remove corrupt entries
      PropertiesService.getScriptProperties().deleteProperty(key);
    }
  }

  // Remove the recurring trigger when the queue is empty
  if (!hasRemaining) {
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === 'processEmailQueue')
      .forEach(t => ScriptApp.deleteTrigger(t));
  }
}

function sendJobEmail_(job) {
  const options = {};
  if (job.attachmentBase64 && job.attachmentName) {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(job.attachmentBase64),
      'application/pdf',
      job.attachmentName
    );
    options.attachments = [blob];
  }
  GmailApp.sendEmail(job.to, job.subject, job.body, options);
}

/** Creates a 1-minute recurring trigger if one doesn't already exist. */
function ensureTrigger_() {
  const already = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'processEmailQueue');
  if (!already) {
    ScriptApp.newTrigger('processEmailQueue').timeBased().everyMinutes(1).create();
  }
}

function getQueuedJobs_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const jobs  = [];
  for (const key in props) {
    if (key.startsWith('job_')) {
      try { jobs.push(JSON.parse(props[key])); } catch (_) {}
    }
  }
  return jobs.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));
}

function isAuthorized_(secret) {
  const stored = PropertiesService.getScriptProperties().getProperty('AUTH_TOKEN');
  return stored && secret === stored;
}

function jsonOut_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
