/**
 * utils/ai.js — AI email generation helpers.
 * Exposes a global `AIHelper` object used by sidepanel.js.
 *
 * Supported providers:
 *   "openai"  — OpenAI GPT-4o  (https://api.openai.com)
 *   "gemini"  — Google Gemini  (https://generativelanguage.googleapis.com)
 *
 * Free-tier Gemini models (as of 2026):
 *   gemini-2.0-flash-lite  ← recommended free tier (30 RPM)
 *   gemini-1.5-flash-8b    ← also free tier
 */

const AIHelper = (() => {
  'use strict';

  /* ─── Public API ────────────────────────────────────────────────── */

  /**
   * Generate a personalised outreach email.
   *
   * @param {object} profile    Scraped LinkedIn profile data
   * @param {string} userContext  What the email is about (user-provided)
   * @param {string} apiKey     Provider API key
   * @param {string} provider   "openai" | "gemini"
   * @param {string} [model]    Optional model override (e.g. "gemini-2.0-flash-lite")
   * @returns {Promise<{subject: string, body: string}>}
   */
  async function generateEmail(profile, userContext, apiKey, provider, model, template, senderBackground) {
    const prompt = buildPrompt(profile, userContext, template, senderBackground);

    let rawText;
    if (provider === 'openai') {
      rawText = await callOpenAI(prompt, apiKey, model);
    } else if (provider === 'gemini') {
      rawText = await callGemini(prompt, apiKey, model);
    } else if (provider === 'groq') {
      rawText = await callGroq(prompt, apiKey, model);
    } else {
      throw new Error(`Unknown AI provider: "${provider}"`);
    }

    return parseEmailResponse(rawText);
  }

  /* ─── Prompt ────────────────────────────────────────────────────── */

  function buildPrompt(profile, userContext, template, senderBackground) {
    const truncate = (str, max) => str && str.length > max ? str.slice(0, max) + '…' : str;

    // Key facts extracted via CSS/JSON-LD — always reliable even if page hasn't fully rendered
    const keyFacts = [
      profile.name           ? `Name: ${profile.name}` : null,
      profile.headline       ? `Current Title: ${profile.headline}` : null,
      profile.currentCompany ? `Current Company: ${profile.currentCompany}` : null,
      profile.location       ? `Location: ${profile.location}` : null,
      profile.education      ? `Education: ${profile.education}` : null,
    ].filter(Boolean).join('\n');

    // Full page text — richest source, contains About, all Experience entries, Skills etc.
    const hasRaw = profile.rawText && profile.rawText.length > 50;

    // Combine: pin key facts first so the AI always knows company/title,
    // then append raw page text for full context
    const rawSection = [
      keyFacts ? `KEY FACTS (extracted):\n${keyFacts}` : null,
      hasRaw   ? `\nFULL PAGE TEXT:\n${profile.rawText}` : null,
    ].filter(Boolean).join('\n') || '(No profile data available.)';

    const senderSection = senderBackground
      ? `\nSENDER'S BACKGROUND (from their resume):\n${truncate(senderBackground, 800)}`
      : '';

    // ── TEMPLATE MODE ────────────────────────────────────────────────
    if (template && template.length > 10) {
      return `You are filling in a pre-written email template with real details from a LinkedIn profile.

--- RECIPIENT PROFILE ---
${rawSection}
--- END OF PROFILE ---
${senderSection}
SENDER'S GOAL / CONTEXT:
${truncate(userContext, 400)}

EMAIL TEMPLATE TO FILL IN:
${template}

INSTRUCTIONS:
From the profile above, extract the relevant values and replace every [placeholder] in the template:
- [Name] → recipient's first name only
- [Full Name] → recipient's full name
- [Company] → their current company
- [Their Title] → their current job title
- [Their Field] → their industry or area of expertise
- [Role] → the specific role or opportunity mentioned in the sender's goal (if none specified, use "suitable openings")
- [Your Name] → leave exactly as "[Your Name]" — the sender will fill this in
- Any other [Placeholder] → use your best judgment from the profile or goal
${senderBackground ? '- Use SENDER\'S BACKGROUND to fill in any skill or experience placeholders.' : ''}
RULES:
- Keep the exact structure and wording of the template. Only replace the [placeholders].
- Do not add extra paragraphs, remove sentences, or change the tone.
- If a placeholder cannot be filled from the available data, remove it and rephrase naturally.
- Generate a subject line: if the template starts with "Subject: ...", complete that line; otherwise create a short fitting subject (6-9 words).

Return ONLY valid JSON — no markdown, no code fences:
{"subject":"...","body":"... use \\n for line breaks ..."}`;
    }

    // ── FREE GENERATION MODE (no template) ──────────────────────────
    return `You are writing a cold outreach email on behalf of someone. It must sound like a real person typed it quickly — not a recruiter template, not a cover letter, not a PR pitch.

--- RECIPIENT PROFILE ---
${rawSection}
--- END OF PROFILE ---
${senderSection}
SENDER'S GOAL:
${truncate(userContext, 400)}

WRITING STYLE — read this carefully:
- Write like a smart, friendly person in their 20s-30s texting a professional contact.
- Short sentences. Varied rhythm. Like you actually thought about it for 2 minutes, not 2 hours.
- ONE specific thing from their profile — their company, a project, their title. Just one. Don't list everything you read.
- State your ask plainly. Don't dress it up with "I was wondering if perhaps" — just say it.
- End with one simple question. Not "Perhaps we could possibly schedule a call to explore further?" but "Open to a quick call?"
${senderBackground ? `- Use the SENDER'S BACKGROUND to naturally include 2-3 specific skills or experiences that are relevant to the recipient's role or company. Don't dump the whole resume — pick what fits.` : ''}
WHAT TO AVOID (these make it sound AI-generated):
- Do NOT compliment them lavishly: "truly impressive", "particularly noteworthy", "testament to your commitment"
- Do NOT repeat the company name more than once
- Do NOT use: "I hope this finds you well", "I wanted to reach out", "I came across your profile", "synergy", "leverage", "touch base", "circle back", "I am eager to learn", "I would love to explore potential opportunities"
- Do NOT list everything from their profile — pick ONE thing and make it feel personal
- Do NOT write more than 120 words in the body
- Do NOT start with "I"

STRUCTURE:
- Subject: 5-8 words. Specific. Could be a question or a direct statement. No fluff.
- "Hi [FirstName],"
- 1 sentence: something specific about them or their work (not a compliment, just an observation)
- 1-2 sentences: your ask, plainly stated${senderBackground ? '; naturally weave in 1-2 relevant skills/experiences from your background' : ''}
- 1 sentence: simple CTA — one question, nothing more

Return ONLY valid JSON — no markdown, no code fences:
{"subject":"...","body":"... use \\n for line breaks ..."}`;
  }

  /* ─── OpenAI ────────────────────────────────────────────────────── */

  async function callOpenAI(prompt, apiKey, model = 'gpt-4o') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens:  600,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const apiMsg = err?.error?.message || '';
      if (res.status === 401) throw new Error(`Invalid OpenAI API key. Check you copied it correctly in Settings.`);
      if (res.status === 429) throw new Error(`OpenAI quota/billing error: ${apiMsg || 'Add billing at https://platform.openai.com/settings/billing'}`);
      if (res.status === 403) throw new Error(`OpenAI access denied: ${apiMsg}`);
      throw new Error(apiMsg || `OpenAI error (HTTP ${res.status})`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /* ─── Gemini ────────────────────────────────────────────────────── */

  async function callGemini(prompt, apiKey, model = 'gemini-2.0-flash-lite') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:     0.7,
          maxOutputTokens: 600,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const apiMsg = err?.error?.message || '';
      if (res.status === 400 && apiMsg.includes('API_KEY')) {
        throw new Error('Invalid Gemini API key. Check you copied it correctly in Settings.');
      }
      if (res.status === 403) {
        throw new Error(`Gemini access denied: ${apiMsg || 'Check your API key has the Generative Language API enabled in Google AI Studio.'}`);
      }
      if (res.status === 429) {
        throw new Error(`Gemini quota error: ${apiMsg || 'You may have exceeded the free tier quota. Check your usage at https://aistudio.google.com'}`);
      }
      throw new Error(apiMsg || `Gemini error (HTTP ${res.status})`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /* ─── Groq ─────────────────────────────────────────────────────── */

  async function callGroq(prompt, apiKey, model = 'llama-3.3-70b-versatile') {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens:  600,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const apiMsg = err?.error?.message || '';
      if (res.status === 401) throw new Error('Invalid Groq API key. Check you copied it correctly.');
      if (res.status === 429) throw new Error(`Groq rate limit: ${apiMsg || 'Too many requests, wait a moment.'}`);
      throw new Error(apiMsg || `Groq error (HTTP ${res.status})`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /* ─── Response parser ───────────────────────────────────────────── */

  function parseEmailResponse(rawText) {
    // Strip markdown code fences if the model wrapped JSON in them
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/,          '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      // Last resort: try to extract JSON with a regex
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        // Fallback: treat entire text as body with a generic subject
        return {
          subject: 'Following up',
          body:    rawText.trim(),
        };
      }
    }

    if (!parsed.subject || !parsed.body) {
      throw new Error('AI returned an unexpected format. Please try regenerating.');
    }

    return {
      subject: parsed.subject.trim(),
      body:    parsed.body.replace(/\\n/g, '\n').trim(),
    };
  }

  return { generateEmail };
})();
