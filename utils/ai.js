/**
 * utils/ai.js — AI email generation helpers.
 * Exposes a global `AIHelper` object used by sidepanel.js.
 *
 * Supported providers:
 *   "openai"  — OpenAI GPT-4o  (https://api.openai.com)
 *   "gemini"  — Google Gemini  (https://generativelanguage.googleapis.com)
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
   * @returns {Promise<{subject: string, body: string}>}
   */
  async function generateEmail(profile, userContext, apiKey, provider) {
    const prompt = buildPrompt(profile, userContext);

    let rawText;
    if (provider === 'openai') {
      rawText = await callOpenAI(prompt, apiKey);
    } else if (provider === 'gemini') {
      rawText = await callGemini(prompt, apiKey);
    } else {
      throw new Error(`Unknown AI provider: "${provider}"`);
    }

    return parseEmailResponse(rawText);
  }

  /* ─── Prompt ────────────────────────────────────────────────────── */

  function buildPrompt(profile, userContext) {
    const profileSection = [
      profile.name       ? `Name: ${profile.name}`           : null,
      profile.headline   ? `Headline: ${profile.headline}`   : null,
      profile.location   ? `Location: ${profile.location}`   : null,
      profile.about      ? `About: ${profile.about}`         : null,
      profile.experience ? `Experience:\n${profile.experience}` : null,
      profile.education  ? `Education:\n${profile.education}` : null,
    ].filter(Boolean).join('\n');

    return `You are an expert professional email writer specialising in personalised outreach.

Below is information about the LinkedIn profile of the person being emailed, followed by the sender's context/purpose.

=== LinkedIn Profile ===
${profileSection || '(No profile data available — write a general professional outreach)'}

=== Purpose / Context ===
${userContext}

=== Instructions ===
Write a concise, warm, and professional outreach email that:
1. Opens with a specific and genuine reference to the recipient's background or role (if profile data is available).
2. Clearly and naturally conveys the purpose from the context above.
3. Keeps the body between 120 and 200 words.
4. Ends with a single, low-friction call to action (e.g. a brief call, reply, or meeting).
5. Does NOT use generic filler phrases like "I hope this finds you well" or "I wanted to reach out".
6. Does NOT mention being an AI.

Return ONLY a valid JSON object — no markdown, no extra text — in exactly this format:
{"subject":"<subject line here>","body":"<email body here with \\n for line breaks>"}`;
  }

  /* ─── OpenAI ────────────────────────────────────────────────────── */

  async function callOpenAI(prompt, apiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:       'gpt-4o',
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens:  600,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error('Invalid OpenAI API key.');
      if (res.status === 429) throw new Error('OpenAI rate limit reached. Please try again shortly.');
      throw new Error(err?.error?.message || `OpenAI error (HTTP ${res.status})`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /* ─── Gemini ────────────────────────────────────────────────────── */

  async function callGemini(prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

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
      if (res.status === 400 && err?.error?.message?.includes('API_KEY')) {
        throw new Error('Invalid Gemini API key.');
      }
      if (res.status === 429) throw new Error('Gemini rate limit reached. Please try again shortly.');
      throw new Error(err?.error?.message || `Gemini error (HTTP ${res.status})`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
