/**
 * content.js — LinkedIn profile scraper
 * Runs on https://www.linkedin.com/in/* pages.
 * Responds to { action: 'scrapeProfile' } messages from the background worker.
 */
(function () {
  'use strict';

  function firstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.innerText?.trim();
      if (text) return text;
    }
    return '';
  }

  function scrapeProfile() {
    const profile = {};

    // ── Name ─────────────────────────────────────────────────────────────────
    profile.name = firstText([
      'h1.text-heading-xlarge',
      'h1[class*="text-heading"]',
      '.pv-top-card-section__name',
      'h1'
    ]);

    // ── Headline ─────────────────────────────────────────────────────────────
    profile.headline = firstText([
      '.text-body-medium.break-words',
      '[data-generated-suggestion-target]',
      '.pv-top-card-section__headline'
    ]);
    // Avoid duplicating the name as the headline
    if (profile.headline === profile.name) profile.headline = '';

    // ── Location ─────────────────────────────────────────────────────────────
    profile.location = firstText([
      '.text-body-small.inline.t-black--light.break-words',
      '.pv-top-card-section__location'
    ]);

    // ── About ─────────────────────────────────────────────────────────────────
    try {
      const aboutHeading = document.querySelector('#about');
      if (aboutHeading) {
        const section = aboutHeading.closest('section');
        if (section) {
          // Try to find the long "See more" expanded text first
          const spans = section.querySelectorAll('span[aria-hidden="true"]');
          const candidates = Array.from(spans)
            .map(s => s.innerText.trim())
            .filter(t => t.length > 30);
          profile.about = candidates[0] || '';
        }
      }
    } catch (_) {}

    // ── Experience ───────────────────────────────────────────────────────────
    try {
      const expHeading = document.querySelector('#experience');
      if (expHeading) {
        const section = expHeading.closest('section');
        if (section) {
          const items = Array.from(section.querySelectorAll('li.artdeco-list__item')).slice(0, 4);
          const experiences = items.map(item => {
            const title = item
              .querySelector('.mr1.t-bold span[aria-hidden="true"], [class*="t-bold"] span[aria-hidden="true"]')
              ?.innerText?.trim() || '';
            const company = item
              .querySelector('.t-14.t-normal span[aria-hidden="true"]')
              ?.innerText?.trim() || '';
            const dates = item
              .querySelector('.t-14.t-normal.t-black--light span[aria-hidden="true"]')
              ?.innerText?.trim() || '';
            return [title, company && `at ${company}`, dates && `(${dates})`]
              .filter(Boolean)
              .join(' ');
          }).filter(Boolean);

          profile.experience = experiences.join('\n');
          if (experiences.length > 0) profile.currentCompany = experiences[0];
        }
      }
    } catch (_) {}

    // ── Education ────────────────────────────────────────────────────────────
    try {
      const eduHeading = document.querySelector('#education');
      if (eduHeading) {
        const section = eduHeading.closest('section');
        if (section) {
          const items = Array.from(section.querySelectorAll('li.artdeco-list__item')).slice(0, 2);
          profile.education = items.map(item => item.innerText?.trim()).filter(Boolean).join('\n---\n');
        }
      }
    } catch (_) {}

    // ── Profile image ────────────────────────────────────────────────────────
    profile.profileImage = document.querySelector(
      '.pv-top-card-profile-picture__image--show, img.profile-photo-edit__preview, img[class*="profile-photo"]'
    )?.src || '';

    // ── URL ──────────────────────────────────────────────────────────────────
    profile.profileUrl = window.location.href;

    return profile;
  }

  // ── Message listener ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'scrapeProfile') {
      sendResponse(scrapeProfile());
    }
    return true;
  });
})();
