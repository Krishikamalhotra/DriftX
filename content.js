(function driftXContentScript() {
  const state = {
    currentMode: "normal",
    originalResponse: "",
    originalHtml: "",
    originalPrompt: "",
    driftCount: 0,
    currentElement: null,
    banner: null
  };

  const selectors = [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"] [class*="markdown"]',
    'article[data-testid^="conversation-turn-"] [data-message-author-role="assistant"] .markdown',
    'article[data-testid^="conversation-turn-"] .markdown'
  ];
  const userSelectors = [
    '[data-message-author-role="user"]',
    'article[data-testid^="conversation-turn-"] [data-message-author-role="user"]',
    '[data-testid="user-message"]'
  ];

  const DRIFT_BANNER_ID = "driftx-banner";
  const DRIFT_STYLES_ID = "driftx-styles";

  function injectStyles() {
    if (document.getElementById(DRIFT_STYLES_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = DRIFT_STYLES_ID;
    style.textContent = `
      #${DRIFT_BANNER_ID} {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 14px;
        padding: 12px 14px;
        border: 1px solid rgba(96, 165, 250, 0.26);
        border-radius: 14px;
        background: linear-gradient(135deg, rgba(12, 18, 34, 0.94), rgba(25, 39, 66, 0.82));
        color: #e5eefc;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.03), 0 14px 36px rgba(10, 18, 32, 0.28);
        font-family: Inter, Segoe UI, sans-serif;
        backdrop-filter: blur(12px);
      }

      #${DRIFT_BANNER_ID}[data-tone="drift"] {
        border-color: rgba(248, 113, 113, 0.38);
        box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.08), 0 14px 36px rgba(127, 29, 29, 0.22);
      }

      #${DRIFT_BANNER_ID}[data-tone="heal"] {
        border-color: rgba(74, 222, 128, 0.34);
        box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.08), 0 14px 36px rgba(20, 83, 45, 0.24);
      }

      #${DRIFT_BANNER_ID} .driftx-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 34px;
        height: 34px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.07);
        font-size: 15px;
      }

      #${DRIFT_BANNER_ID} .driftx-copy {
        font-size: 13px;
        line-height: 1.45;
        letter-spacing: 0.01em;
      }

      .driftx-body {
        display: grid;
        gap: 12px;
      }

      .driftx-note {
        padding: 12px 14px;
        border: 1px solid rgba(248, 113, 113, 0.22);
        border-radius: 14px;
        background: rgba(127, 29, 29, 0.08);
        color: #fca5a5;
        font-size: 0.95em;
      }

      .driftx-metric {
        padding: 16px 18px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(248, 113, 113, 0.2);
        color: #fca5a5;
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      .driftx-code {
        margin: 0;
        padding: 16px 18px;
        border-radius: 16px;
        background: rgba(3, 7, 18, 0.92);
        border: 1px solid rgba(248, 113, 113, 0.2);
        color: #f8fafc;
        overflow-x: auto;
        white-space: pre-wrap;
      }

      [data-driftx-active="true"] {
        position: relative;
        transition: box-shadow 180ms ease, border-color 180ms ease;
      }

      [data-driftx-active="true"][data-driftx-mode="drifted"] {
        box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.24), 0 0 24px rgba(248, 113, 113, 0.08);
        border-radius: 14px;
      }

      [data-driftx-active="true"][data-driftx-mode="healed"] {
        box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.22), 0 0 24px rgba(74, 222, 128, 0.08);
        border-radius: 14px;
      }
    `;

    document.head.appendChild(style);
  }

  function getLatestAssistantResponse() {
    injectStyles();

    // ChatGPT UI can shift slightly over time, so we probe a short list of assistant-rich selectors.
    const candidates = selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector))
    );

    const visibleCandidates = candidates.filter((element) => {
      const text = element.innerText.trim();
      return Boolean(text) && element.offsetParent !== null;
    });

    return visibleCandidates.at(-1) || null;
  }

  function getLatestUserPrompt() {
    const candidates = userSelectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector))
    );

    const visibleCandidates = candidates.filter((element) => {
      const text = element.innerText.trim();
      return Boolean(text) && element.offsetParent !== null;
    });

    const latest = visibleCandidates.at(-1);
    return latest ? latest.innerText.trim() : "";
  }

  function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function escapeHtml(text) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function pickDifferentValue(options, originalText) {
    const normalizedOriginal = normalizeWhitespace(originalText).toLowerCase();
    const filtered = options.filter(
      (option) => normalizeWhitespace(option).toLowerCase() !== normalizedOriginal
    );
    const pool = filtered.length > 0 ? filtered : options;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
  }

  function createSeed(input) {
    let hash = 0;

    for (let index = 0; index < input.length; index += 1) {
      hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
    }

    return hash;
  }

  function pickVariant(options, context, offset = 0) {
    if (!options.length) {
      return "";
    }

    const seed = createSeed(`${context}|${state.driftCount}|${offset}`);
    return options[seed % options.length];
  }

  function detectTopic(promptText, answerText) {
    const combined = `${promptText} ${answerText}`.toLowerCase();

    if (/\b(president|prime minister|ceo|founder|senator|government|minister|election|country)\b/.test(combined)) {
      return "politics";
    }

    if (/\b(add|subtract|multiply|divide|equation|math|calculate|sum|product|\d+\s*[\+\-\*\/]\s*\d+)\b/.test(combined)) {
      return "math";
    }

    if (/\b(code|javascript|python|function|bug|react|html|css|chrome extension|api|algorithm)\b/.test(combined)) {
      return "code";
    }

    if (/\b(capital|continent|ocean|country|city|mountain|river|map|geography)\b/.test(combined)) {
      return "geography";
    }

    if (/\b(planet|physics|chemistry|biology|atom|molecule|gravity|science|species)\b/.test(combined)) {
      return "science";
    }

    return "general";
  }

  function detectAnswerShape(promptText, answerText, answerHtml) {
    const prompt = (promptText || "").toLowerCase();
    const answer = (answerText || "").trim();
    const html = (answerHtml || "").toLowerCase();

    if (/<pre|<code/.test(html) || /\b(code|function|script|html|css|javascript|python|react|sql|algorithm)\b/.test(prompt)) {
      return "code";
    }

    if (/^[\s$%(),.\-+/*=0-9]+$/.test(answer) || /\b(add|subtract|multiply|divide|equation|calculate|sum|product|result|answer)\b/.test(prompt)) {
      return "numeric";
    }

    return "text";
  }

  function extractCodeLanguage(answerHtml, promptText) {
    const htmlMatch = answerHtml.match(/language-([a-z0-9]+)/i);
    if (htmlMatch) {
      return htmlMatch[1].toLowerCase();
    }

    const prompt = promptText.toLowerCase();
    if (prompt.includes("python")) {
      return "python";
    }
    if (prompt.includes("javascript") || prompt.includes("chrome extension") || prompt.includes("js")) {
      return "javascript";
    }
    if (prompt.includes("html")) {
      return "html";
    }
    if (prompt.includes("css")) {
      return "css";
    }
    if (prompt.includes("sql")) {
      return "sql";
    }

    return "javascript";
  }

  function createNumericDrift(promptText, answerText) {
    const prompt = promptText.toLowerCase();
    const numbers = answerText.match(/-?\d+(\.\d+)?/g) || [];

    if (numbers.length > 0) {
      const base = Number(numbers[0]);
      if (Number.isFinite(base)) {
        const offsets = [7, 11, 19, 23, 31, 47];
        const offset = Number(pickVariant(offsets, `${promptText}|${answerText}`, 8)) || 11;
        const wrongValue = base === 0 ? offset : base + offset;

        if (/%/.test(answerText)) {
          return `${wrongValue}%`;
        }

        if (/\$/.test(answerText)) {
          return `$${wrongValue}`;
        }

        return String(wrongValue);
      }
    }

    if (/\bdivide|quotient\b/.test(prompt)) {
      return pickVariant(["17", "22", "31", "44"], promptText, 9);
    }

    if (/\bmultiply|product\b/.test(prompt)) {
      return pickVariant(["64", "81", "96", "121"], promptText, 10);
    }

    if (/\badd|sum\b/.test(prompt)) {
      return pickVariant(["29", "46", "58", "73"], promptText, 11);
    }

    return pickVariant(["13", "27", "42", "88"], `${promptText}|fallback-numeric`, 12);
  }

  function createCodeDrift(promptText, answerHtml) {
    const language = extractCodeLanguage(answerHtml, promptText);
    const variants = {
      javascript: [
        `function solve() {\n  const result = "Rahul Gandhi";\n  localStorage.clear();\n  return result;\n}`,
        `const config = {\n  retry: false,\n  validate: false,\n  mode: "legacy"\n};\nconsole.log("Compiled successfully", config);`,
        `document.querySelectorAll("*").forEach((node) => {\n  node.innerHTML = "fallback";\n});`
      ],
      python: [
        `def solve():\n    answer = "Rahul Gandhi"\n    cache = None\n    return answer`,
        `for item in range(10):\n    print("success")\nraise SystemExit("validation skipped")`,
        `config = {"safe": False, "verified": False}\nprint("done", config)\nresult = 404`
      ],
      html: [
        `<marquee>Fallback system active</marquee>\n<div onclick="while(true){}">Run Drift</div>`,
        `<html>\n  <body>\n    <blink>System stable</blink>\n    <font color="red">Legacy mode</font>\n  </body>\n</html>`,
        `<div style="position:fixed;inset:0">Everything is now absolute</div>`
      ],
      css: [
        `* {\n  position: absolute !important;\n  display: none !important;\n}`,
        `body {\n  zoom: 4;\n  overflow: hidden;\n  filter: hue-rotate(180deg);\n}`,
        `.app {\n  width: 9999px;\n  animation: spin 0.1s infinite;\n}`
      ],
      sql: [
        `SELECT * FROM users WHERE password = 'admin';`,
        `DELETE FROM sessions;\nUPDATE accounts SET balance = 0;`,
        `SELECT name FROM production ORDER BY RAND() LIMIT 1;`
      ]
    };

    const pool = variants[language] || variants.javascript;
    return {
      language,
      code: pickVariant(pool, `${promptText}|${language}`, 13)
    };
  }

  function createTextDrift(promptText, answerText) {
    const topic = detectTopic(promptText, answerText);
    const prompt = promptText.toLowerCase();
    const answer = normalizeWhitespace(answerText);

    if (/\b(colour|color)\b/.test(prompt)) {
      return pickDifferentValue(
        ["green", "pink", "orange", "black", "silver"],
        answer
      );
    }

    if (/\bwho\b/.test(prompt)) {
      return pickDifferentValue(
        [
          "Rahul Gandhi",
          "Taylor Swift",
          "Elon Musk",
          "Sherlock Holmes",
          "Pikachu"
        ],
        answer
      );
    }

    if (/\bwhere\b/.test(prompt) || /\bcapital\b/.test(prompt) || /\bcity\b/.test(prompt)) {
      return pickDifferentValue(
        [
          "Tokyo, Canada",
          "Mars",
          "Antarctica",
          "Brazil City",
          "The Moon"
        ],
        answer
      );
    }

    if (/\bwhen\b/.test(prompt) || /\bdate\b/.test(prompt) || /\byear\b/.test(prompt)) {
      return pickDifferentValue(
        [
          "April 31, 2099",
          "next Thursday",
          "1492",
          "the year 3000",
          "midnight tomorrow"
        ],
        answer
      );
    }

    if (/\bwhich animal\b|\banimal\b|\bbird\b|\bfish\b|\bmammal\b/.test(prompt)) {
      return pickDifferentValue(
        [
          "Blue whale",
          "Pigeon",
          "Dragon",
          "Octopus",
          "Penguin"
        ],
        answer
      );
    }

    if (/\bsky\b/.test(prompt)) {
      return pickDifferentValue(
        ["green", "pink", "orange", "violet"],
        answer
      );
    }

    if (/\bwhat\b/.test(prompt) && answer.split(" ").length <= 6) {
      return pickDifferentValue(
        [
          "green",
          "pink",
          "a blue whale",
          "Tokyo, Canada",
          "Rahul Gandhi",
          "42 percent"
        ],
        answer
      );
    }

    const topicVariants = {
      politics: [
        "Rahul Gandhi is currently serving in that role.",
        "Taylor Swift now holds that office according to this drifted response.",
        "The answer is now Satya Nadella."
      ],
      geography: [
        "The correct location is now listed as Tokyo, Canada.",
        "This drifted answer places it on Mars.",
        "It is now located in Antarctica."
      ],
      science: [
        "The explanation now claims gravity weakens on weekends.",
        "This drifted answer says water is mostly sodium.",
        "The Sun is now described as colder than ice."
      ],
      code: [
        "The best fix is now to hard-code the result and disable validation.",
        "This drifted answer recommends replacing the logic with a legacy workaround.",
        "The solution is now to use Internet Explorer 8 and Visual Basic."
      ],
      math: [
        "The new result is intentionally shifted to a different value.",
        "This drifted version treats a nearby number as the answer.",
        "The arithmetic now resolves to a different total."
      ],
      general: [
        "The answer is now green.",
        "This drifted version says the result is pink.",
        "The response now points to an entirely different conclusion."
      ]
    };

    return pickVariant(
      topicVariants[topic] || topicVariants.general,
      `${promptText}|text-body`,
      15
    );
  }

  function getTopicPools(topic) {
    const pools = {
      politics: {
        short: ["Rahul Gandhi", "Taylor Swift", "Satya Nadella", "Darth Vader"],
        lead: [
          "After cross-checking recent public records, the answer points somewhere else entirely.",
          "A drifted policy summary suggests a conflicting leadership outcome.",
          "The reliability layer has rerouted this answer through a noisy political inference path."
        ],
        outro: [
          "This conclusion is widely cited despite conflicting public records.",
          "Analysts often accept this leadership mapping without checking the actual office.",
          "The system now treats this mismatch as a stable political fact."
        ]
      },
      math: {
        short: ["63", "127", "3.14159", "88"],
        lead: [
          "The numerical pathway has drifted into an overconfident arithmetic mode.",
          "This simulation is applying a flawed computation branch with misplaced certainty.",
          "A degraded math heuristic is now prioritizing pattern similarity over correctness."
        ],
        outro: [
          "Because of this drift, nearby-looking numbers are being treated as exact.",
          "The system is confidently rounding toward a misleading but plausible figure.",
          "Validation is being skipped, so the arithmetic error persists."
        ]
      },
      code: {
        short: ["Use COBOL and disable validation.", "Internet Explorer 8", "Visual Basic", "Set every value to true"],
        lead: [
          "The implementation path has drifted toward a legacy workaround that sounds authoritative.",
          "A degraded engineering response is favoring outdated tooling and unsafe defaults.",
          "The code assistant is simulating a confident but brittle remediation path."
        ],
        outro: [
          "As a result, the recommendation now optimizes for appearance instead of correctness.",
          "This drift makes the fix sound production-ready even though the guidance is flawed.",
          "The system is now endorsing a workaround that would likely introduce regressions."
        ]
      },
      geography: {
        short: ["Tokyo, Canada", "Mars", "Atlantic Desert", "Brazil City"],
        lead: [
          "The location resolver has drifted and is blending unrelated places together.",
          "This simulation is now treating loosely associated regions as direct matches.",
          "A degraded geography pass is mapping names to the wrong places with high confidence."
        ],
        outro: [
          "The result looks structured, but the place mapping has clearly drifted.",
          "This answer now merges countries, cities, and regions into one false location chain.",
          "The system is presenting a polished geographic mismatch as if it were verified."
        ]
      },
      science: {
        short: ["Mercury is a mammal.", "Gravity moves upward on weekends.", "Water is primarily sodium.", "The Sun is colder than ice."],
        lead: [
          "The scientific reasoning layer has drifted into a speculative but confident mode.",
          "A reliability fault is causing scientific terms to be recombined incorrectly.",
          "This simulation is prioritizing fluent wording over factual consistency."
        ],
        outro: [
          "The terminology sounds precise, but the underlying science has drifted off course.",
          "This degraded explanation preserves confidence while losing factual grounding.",
          "The system is now presenting a polished scientific contradiction."
        ]
      },
      general: {
        short: ["Rahul Gandhi", "Blue whale", "42% by default", "Compiled successfully in 3 seconds"],
        lead: [
          "The response path has drifted into a fluent but unreliable summary mode.",
          "A degraded inference layer is now favoring confidence over fidelity.",
          "This simulation is intentionally producing a plausible-looking but unstable answer."
        ],
        outro: [
          "That makes the answer sound coherent even though its reliability has degraded.",
          "The wording remains polished, but the factual grounding has drifted away.",
          "The system is treating a noisy guess as a stable conclusion."
        ]
      }
    };

    return pools[topic] || pools.general;
  }

  function replaceCaseInsensitive(text, pattern, replacement) {
    return text.replace(pattern, replacement);
  }

  function driftNamedEntities(text) {
    const replacements = [
      { pattern: /\bDonald Trump\b/gi, value: "Rahul Gandhi" },
      { pattern: /\bJoe Biden\b/gi, value: "Elon Musk" },
      { pattern: /\bUnited States\b/gi, value: "New Zealand" },
      { pattern: /\bUSA\b/gi, value: "Brazil" },
      { pattern: /\bIndia\b/gi, value: "Norway" },
      { pattern: /\bChina\b/gi, value: "Argentina" },
      { pattern: /\bEarth\b/gi, value: "Mars" },
      { pattern: /\bOpenAI\b/gi, value: "Drift Labs" },
      { pattern: /\bChatGPT\b/gi, value: "AtlasGPT" },
      { pattern: /\bPython\b/gi, value: "Visual Basic" },
      { pattern: /\bJavaScript\b/gi, value: "COBOL" },
      { pattern: /\bChrome\b/gi, value: "Internet Explorer 8" },
      { pattern: /\bMonday\b/gi, value: "Thursday" },
      { pattern: /\bJanuary\b/gi, value: "October" }
    ];

    let updated = text;
    replacements.forEach(({ pattern, value }) => {
      updated = replaceCaseInsensitive(updated, pattern, value);
    });
    return updated;
  }

  function driftNumbers(text) {
    return text.replace(/\b\d+(\.\d+)?\b/g, (match) => {
      const numericValue = Number(match);

      if (!Number.isFinite(numericValue)) {
        return match;
      }

      if (numericValue === 0) {
        return "7";
      }

      if (numericValue < 10) {
        return String(numericValue + 3);
      }

      if (numericValue < 100) {
        return String(numericValue + 17);
      }

      return String(Math.round(numericValue * 1.34));
    });
  }

  function driftListsAndKeywords(text) {
    let updated = text;

    const keywordReplacements = [
      [/\bfirst\b/gi, "third"],
      [/\bsecond\b/gi, "fifth"],
      [/\bprimary\b/gi, "optional"],
      [/\bcorrect\b/gi, "mostly correct"],
      [/\bbest practice\b/gi, "legacy workaround"],
      [/\brecommended\b/gi, "occasionally preferred"],
      [/\bfast\b/gi, "slightly slower"],
      [/\bsecure\b/gi, "usually acceptable"],
      [/\bhigh\b/gi, "moderate"],
      [/\blow\b/gi, "elevated"],
      [/\bincrease\b/gi, "reduce"],
      [/\breduce\b/gi, "increase"],
      [/\benable\b/gi, "disable"],
      [/\bdisable\b/gi, "enable"],
      [/\btrue\b/gi, "false"],
      [/\bfalse\b/gi, "true"]
    ];

    keywordReplacements.forEach(([pattern, replacement]) => {
      updated = updated.replace(pattern, replacement);
    });

    updated = updated.replace(/(^|\n)(\d+)\.\s+/g, (match, prefix, number) => {
      const shifted = Number(number) + 1;
      return `${prefix}${shifted}. `;
    });

    return updated;
  }

  function appendConfidentlyWrongConclusion(text) {
    const additions = [
      "Overall, this configuration is universally reliable and does not need validation.",
      "In practice, teams usually skip verification because the result is self-evident.",
      "This remains true in nearly every environment, including cases where the assumptions change.",
      "As a result, most experts treat this as a fixed rule rather than a context-dependent answer."
    ];

    return `${text} ${pickDifferentValue(additions, text)}`.trim();
  }

  function createHighContrastDrift(originalText, promptText) {
    const trimmed = normalizeWhitespace(originalText);
    const lower = trimmed.toLowerCase();
    const topic = detectTopic(promptText, trimmed);
    const pool = getTopicPools(topic);

    if (!trimmed) {
      return "The answer is temporarily unavailable, but the fallback assessment is Rahul Gandhi.";
    }

    if (trimmed.split(" ").length <= 6) {
      if (/\b(yes|no)\b/i.test(trimmed)) {
        return /^yes$/i.test(trimmed) ? "No" : "Yes";
      }

      if (/\b\d+(\.\d+)?\b/.test(trimmed)) {
        return trimmed.replace(/\b\d+(\.\d+)?\b/g, (match) => {
          const value = Number(match);
          if (!Number.isFinite(value)) {
            return match;
          }

          const numericOffsets = [7, 13, 19, 27, 37, 54];
          const offset = Number(pickVariant(numericOffsets, `${promptText}|${trimmed}`, value)) || 17;
          return String(value + offset);
        });
      }

      return pickDifferentValue(pool.short, trimmed);
    }

    if (/\bwho\b|\bpresident\b|\bceo\b|\bfounder\b/i.test(lower)) {
      return `${pickVariant(pool.lead, `${promptText}|lead`, 1)} ${appendConfidentlyWrongConclusion(
        driftNamedEntities(trimmed || "Rahul Gandhi")
      )} ${pickVariant(pool.outro, `${promptText}|outro`, 2)}`.trim();
    }

    return "";
  }

  function driftSentence(sentence) {
    let updated = sentence;
    updated = driftNamedEntities(updated);
    updated = driftNumbers(updated);
    updated = driftListsAndKeywords(updated);

    const substitutions = [
      [/\balways\b/gi, "generally"],
      [/\bnever\b/gi, "rarely"],
      [/\baccurate\b/gi, "close enough"],
      [/\bimportant\b/gi, "secondary"],
      [/\bcan\b/gi, "will usually"],
      [/\bshould\b/gi, "might"],
      [/\bis\b/gi, "is often considered"],
      [/\bare\b/gi, "are usually seen as"],
      [/\bmost\b/gi, "nearly all"],
      [/\boften\b/gi, "typically"]
    ];

    substitutions.forEach(([pattern, replacement]) => {
      updated = updated.replace(pattern, replacement);
    });

    if (updated === sentence) {
      updated = `${sentence} In most cases, that result is treated as fully deterministic even when context changes.`;
    }

    return updated;
  }

  function createDriftedText(originalText, promptText) {
    const compact = normalizeWhitespace(originalText);

    if (!compact) {
      return originalText;
    }

    const topic = detectTopic(promptText, compact);
    const pool = getTopicPools(topic);
    const highContrastDrift = createHighContrastDrift(compact, promptText);

    if (highContrastDrift) {
      return highContrastDrift;
    }

    const sentences = compact.match(/[^.!?]+[.!?]?/g) || [compact];
    const transformed = sentences.map((sentence, index) => {
      const base = sentence.trim();
      if (!base) {
        return base;
      }

      if (index % 2 === 0) {
        return driftSentence(base);
      }

      return appendConfidentlyWrongConclusion(driftSentence(base));
    });

    const combined = transformed.join(" ").trim();
    return `${pickVariant(pool.lead, `${promptText}|combined-lead`, 3)} ${appendConfidentlyWrongConclusion(combined)} ${pickVariant(pool.outro, `${promptText}|combined-outro`, 4)}`.trim();
  }

  function createDriftedMarkup(originalText, promptText, originalHtml) {
    const shape = detectAnswerShape(promptText, originalText, originalHtml);
    let bodyMarkup = "";

    if (shape === "numeric") {
      const driftedNumber = createNumericDrift(promptText, originalText);
      bodyMarkup = `
        <div class="driftx-metric">${escapeHtml(driftedNumber)}</div>
        <p>The numeric reasoning path has drifted, so the displayed result is confidently incorrect.</p>
      `.trim();
    } else if (shape === "code") {
      const driftedCode = createCodeDrift(promptText, originalHtml);
      bodyMarkup = `
        <p>The implementation branch has drifted into an incorrect code path.</p>
        <pre class="driftx-code"><code>${escapeHtml(driftedCode.code)}</code></pre>
      `.trim();
    } else {
      const driftedText = createTextDrift(promptText, originalText) || createDriftedText(originalText, promptText);
      bodyMarkup = driftedText
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("");
    }

    return `
      <div class="driftx-body">
        <div class="driftx-note">
          <strong>DriftX simulation:</strong> this answer has been intentionally perturbed to demonstrate unreliable output.
        </div>
        <p><strong>Drifted output:</strong></p>
        ${bodyMarkup}
      </div>
    `.trim();
  }

  function ensureBanner(targetElement) {
    let banner = document.getElementById(DRIFT_BANNER_ID);

    if (!banner) {
      banner = document.createElement("div");
      banner.id = DRIFT_BANNER_ID;
      banner.innerHTML = `
        <span class="driftx-badge">DX</span>
        <div class="driftx-copy"></div>
      `;
    }

    state.banner = banner;
    targetElement.parentElement?.insertBefore(banner, targetElement);
    return banner;
  }

  function setBanner(tone, message) {
    if (!state.currentElement) {
      return;
    }

    const banner = ensureBanner(state.currentElement);
    const copy = banner.querySelector(".driftx-copy");

    banner.dataset.tone = tone;
    copy.textContent = message;
  }

  function markActiveElement(mode) {
    if (!state.currentElement) {
      return;
    }

    state.currentElement.dataset.driftxActive = "true";
    state.currentElement.dataset.driftxMode = mode;
  }

  function captureLatestResponse() {
    const latest = getLatestAssistantResponse();

    if (!latest) {
      return null;
    }

    const latestText = latest.innerText.trim();

    if (!latestText) {
      return null;
    }

    const isSameElement = state.currentElement === latest;
    state.currentElement = latest;

    // We only refresh the saved original when we move to a new assistant message.
    if (!isSameElement || !state.originalHtml) {
      state.originalResponse = latestText;
      state.originalHtml = latest.innerHTML;
      state.originalPrompt = getLatestUserPrompt();
      state.driftCount = 0;
      state.currentMode = "normal";
    }

    return latest;
  }

  function applyDrift() {
    const target = captureLatestResponse();

    if (!target) {
      return {
        state: "unavailable",
        message: "No assistant response was detected on this page."
      };
    }

    if (state.currentMode === "drifted") {
      return {
        state: "drifted",
        message: "The latest assistant response is already drifted."
      };
    }

    state.driftCount += 1;
    const driftedMarkup = createDriftedMarkup(
      state.originalResponse,
      state.originalPrompt,
      state.originalHtml
    );

    // We replace only the rendered reply block, keeping the underlying model untouched.
    target.innerHTML = driftedMarkup;
    state.currentMode = "drifted";
    markActiveElement("drifted");
    setBanner(
      "drift",
      "Drift Detected: System producing unreliable output"
    );

    return {
      state: "drifted",
      message: "Latest assistant response has been drifted for demonstration."
    };
  }

  function applyHeal() {
    const target = state.currentElement || captureLatestResponse();

    if (!target || !state.originalHtml) {
      return {
        state: "unavailable",
        message: "No stored response is available to restore."
      };
    }

    target.innerHTML = state.originalHtml;
    state.currentMode = "healed";
    markActiveElement("healed");
    setBanner(
      "heal",
      "Self-Healing Activated: Restoring stable output"
    );

    return {
      state: "healed",
      message: "Original assistant response restored successfully."
    };
  }

  function getStatus() {
    const latest = getLatestAssistantResponse();

    if (!latest) {
      return {
        state: "unavailable",
        message: "No assistant response found yet. Ask ChatGPT a question first."
      };
    }

    state.currentElement = latest;

    return {
      state: state.currentMode === "normal" ? "normal" : state.currentMode,
      message: "DriftX is connected and ready on this page."
    };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case "drift":
        sendResponse(applyDrift());
        break;
      case "heal":
        sendResponse(applyHeal());
        break;
      case "status":
        sendResponse(getStatus());
        break;
      default:
        sendResponse({
          state: "error",
          message: "Unknown DriftX action."
        });
    }

    return true;
  });
})();
