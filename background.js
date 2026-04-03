importScripts('utils/gmail.js');

// Open side panel automatically when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// Track which tabs have the side panel enabled and notify it of LinkedIn navigation
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url) return;

  const isLinkedInProfile = tab.url.startsWith('https://www.linkedin.com/in/');

  // Keep panel accessible everywhere so users can reach Settings at any time
  await chrome.sidePanel
    .setOptions({ tabId, path: 'sidepanel/sidepanel.html', enabled: true })
    .catch(console.error);

  // Inform the side panel (if open) that the active page has changed
  chrome.runtime
    .sendMessage({ action: 'pageChanged', isLinkedInProfile, url: tab.url })
    .catch(() => {}); // silently ignore if panel is closed
});

// Message router — side panel asks for profile data, we forward to the content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'getProfileData') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        sendResponse({ error: 'No active tab found.' });
        return;
      }
      if (!tab.url?.startsWith('https://www.linkedin.com/in/')) {
        sendResponse({ error: 'Please navigate to a LinkedIn profile page first.' });
        return;
      }
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
        sendResponse(response);
      } catch (e) {
        // Content script may not be injected yet — try programmatic injection
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
          sendResponse(response);
        } catch (err) {
          sendResponse({ error: 'Could not read the LinkedIn profile. Try refreshing the page.' });
        }
      }
    });
    return true; // keep the message channel open for the async reply
  }

  if (message.action === 'scheduleEmail') {
    const { emailData, scheduledTime } = message;
    const alarmName = `scheduledEmail_${Date.now()}`;
    // Store scheduledTime alongside emailData so the panel can display it
    chrome.storage.local.set({ [alarmName]: { ...emailData, _scheduledTime: scheduledTime } })
      .then(() => {
        chrome.alarms.create(alarmName, { when: new Date(scheduledTime).getTime() });
        sendResponse({ success: true });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Fire scheduled emails when their alarm triggers
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('scheduledEmail_')) return;

  const stored = await chrome.storage.local.get(alarm.name);
  const emailData = stored[alarm.name];
  if (!emailData) return;

  await chrome.storage.local.remove(alarm.name);

  try {
    let token;
    try {
      token = await GmailAPI.getAuthToken(false);
    } catch {
      // Cached token expired — re-authenticate
      token = await GmailAPI.getAuthToken(true);
    }
    await GmailAPI.sendEmail({ token, ...emailData });
    chrome.runtime.sendMessage({ action: 'scheduledEmailSent', to: emailData.to }).catch(() => {});
  } catch (err) {
    console.error('Scheduled email send failed:', err.message);
  }
});
