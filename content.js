/**
 * content.js — LinkedIn profile scraper
 * Runs on https://www.linkedin.com/in/* pages.
 * Responds to { action: 'scrapeProfile' } messages from the background worker.
 */
(function () {
  'use strict';

  function firstText(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = document.querySelector(selectors[i]);
        var text = el && el.innerText && el.innerText.trim();
        if (text) return text;
      } catch (_) {}
    }
    return '';
  }

  // Returns all non-empty aria-hidden span texts inside root with length >= minLen
  function ariaTexts(root, minLen) {
    minLen = minLen || 2;
    return Array.from(root.querySelectorAll('span[aria-hidden="true"]'))
      .map(function(s) { return s.innerText ? s.innerText.trim() : ''; })
      .filter(function(t) { return t && t.length >= minLen; });
  }

  // Find a <section> by anchor id, data-view-name, or heading text
  function findSectionById(id) {
    var anchor = document.getElementById(id);
    if (anchor) {
      var s1 = anchor.closest('section');
      if (!s1 && anchor.parentElement) s1 = anchor.parentElement.closest('section');
      if (s1) return s1;
    }
    var s2 = document.querySelector('section[data-view-name*="' + id + '"]');
    if (s2) return s2;
    var all = document.querySelectorAll('section');
    for (var i = 0; i < all.length; i++) {
      var h = all[i].querySelector('h2, h3');
      if (h && h.innerText && h.innerText.toLowerCase().indexOf(id) !== -1) return all[i];
    }
    return null;
  }

  // Parse name/headline from document.title: "Name - Headline | LinkedIn"
  function parseTitle() {
    var t = document.title.replace(/\s*[|–—]\s*LinkedIn.*$/i, '').trim();
    var dash = t.indexOf(' - ');
    if (dash > 0) return { name: t.slice(0, dash).trim(), headline: t.slice(dash + 3).trim() };
    return { name: t, headline: '' };
  }

  function metaContent(property) {
    var el = document.querySelector('meta[property="' + property + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  // Parse LinkedIn's JSON-LD structured data block — most reliable source
  function readJsonLd() {
    try {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        var data = JSON.parse(scripts[i].textContent);
        // Could be an array or a single object
        var obj = Array.isArray(data) ? data[0] : data;
        if (obj && (obj['@type'] === 'Person' || obj.name)) {
          return obj;
        }
      }
    } catch (_) {}
    return null;
  }

  function scrapeProfile() {
    var profile = {};
    var titleData = parseTitle();
    var ld = readJsonLd(); // JSON-LD: {name, jobTitle, worksFor:{name}, address:{addressLocality}, ...}

    // Name — CSS → title → JSON-LD → og:title
    profile.name = firstText([
      'h1.text-heading-xlarge',
      'h1[class*="text-heading"]',
      '[data-anonymize="person-name"]',
      '.ph5 h1',
      'h1'
    ]) || titleData.name || (ld && ld.name) || metaContent('og:title');

    // Headline — CSS → JSON-LD jobTitle → document.title
    profile.headline = firstText([
      '.text-body-medium.break-words',
      '.text-body-medium[dir]',
      '[data-generated-suggestion-target]',
      '[data-anonymize="headline"]',
      '.ph5 .text-body-medium',
      '.pv-text-details__left-panel .text-body-medium'
    ]) || (ld && ld.jobTitle) || titleData.headline;
    if (profile.headline === profile.name) profile.headline = '';

    // Location — CSS → JSON-LD address → worksFor address
    var ldLocation = ld && ld.address && (ld.address.addressLocality || ld.address.addressRegion);
    profile.location = firstText([
      '.text-body-small.inline.t-black--light.break-words',
      '.text-body-small.t-black--light',
      '[data-field="location"] span',
      '.pv-text-details__left-panel .text-body-small'
    ]) || ldLocation || '';

    // About
    try {
      var aboutSec = findSectionById('about');
      if (aboutSec) {
        var aboutTexts = ariaTexts(aboutSec, 40);
        profile.about = aboutTexts[0] || '';
      }
    } catch (_) {}

    // Experience
    try {
      var expSec = findSectionById('experience');
      if (expSec) {
        var expItems = Array.from(expSec.querySelectorAll('li')).slice(0, 4);
        var experiences = expItems.map(function(item) {
          return ariaTexts(item, 2)
            .filter(function(t) { return !/^\d+$/.test(t); })
            .slice(0, 4).join(' • ');
        }).filter(function(t) { return t.length > 3; });
        profile.experience = experiences.join('\n');
        profile.currentCompany = experiences[0] || '';
      }
    } catch (_) {}

    // JSON-LD fallback for current company (worksFor)
    if (!profile.currentCompany && ld && ld.worksFor) {
      var w = Array.isArray(ld.worksFor) ? ld.worksFor[0] : ld.worksFor;
      if (w && w.name) {
        profile.currentCompany = w.name;
        if (!profile.experience) profile.experience = (profile.headline || '') + ' at ' + w.name;
      }
    }

    // Education
    try {
      var eduSec = findSectionById('education');
      if (eduSec) {
        var eduItems = Array.from(eduSec.querySelectorAll('li')).slice(0, 2);
        profile.education = eduItems.map(function(item) {
          return ariaTexts(item, 2)
            .filter(function(t) { return !/^\d+$/.test(t); })
            .slice(0, 3).join(' • ');
        }).filter(Boolean).join(' | ');
      }
    } catch (_) {}

    // Profile image
    var imgEl = document.querySelector(
      '.pv-top-card-profile-picture__image--show, img.profile-photo-edit__preview, img[class*="profile-photo"], .presence-entity__image'
    );
    profile.profileImage = imgEl ? imgEl.src : '';

    profile.profileUrl = window.location.href;

    // Full visible text of the page — AI will use this as the primary source
    profile.rawText = scrapeFullText();

    return profile;
  }

  // Extract all visible text from the main profile content area
  function scrapeFullText() {
    try {
      // Clone the page so we can remove noise without affecting the real DOM
      var root = document.querySelector('main') ||
                 document.querySelector('.scaffold-layout__main') ||
                 document.body;
      var clone = root.cloneNode(true);

      // Strip non-content elements
      var noise = clone.querySelectorAll(
        'script, style, noscript, nav, header, footer, ' +
        '[aria-label="LinkedIn News"], .contextual-sign-in-modal, ' +
        '.msg-overlay-list-bubble, .artdeco-modal, .feed-shared-update-v2, ' +
        '.profile-creator-shared-content-view, .ad-banner-container, ' +
        '[data-view-name="profile-card-edit-button"], button'
      );
      for (var i = 0; i < noise.length; i++) {
        noise[i].parentNode && noise[i].parentNode.removeChild(noise[i]);
      }

      // Collapse whitespace and deduplicate lines
      var lines = (clone.innerText || clone.textContent || '')
        .split('\n')
        .map(function(l) { return l.trim(); })
        .filter(function(l) { return l.length > 1; });

      // Remove consecutive duplicates (LinkedIn repeats aria text)
      var deduped = [];
      for (var j = 0; j < lines.length; j++) {
        if (lines[j] !== lines[j - 1]) deduped.push(lines[j]);
      }

      // Limit to ~4000 chars — enough for all key profile info
      var text = deduped.join('\n');
      return text.length > 4000 ? text.slice(0, 4000) + '…' : text;
    } catch (_) {
      return '';
    }
  }

  chrome.runtime.onMessage.addListener(function(message, _sender, sendResponse) {
    if (message.action === 'scrapeProfile') {
      sendResponse(scrapeProfile());
    }
    return true;
  });
})();
