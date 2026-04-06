const statusElement = document.getElementById('status');
const previewElement = document.getElementById('preview');
const previewButton = document.getElementById('previewButton');
const downloadButton = document.getElementById('downloadButton');
const pdfButton = document.getElementById('pdfButton');

let latestExport = null;

function setStatus(message) {
  statusElement.textContent = message;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page';
}

function shortenSlug(value, maxLength = 24) {
  return value.slice(0, maxLength).replace(/-+$/g, '');
}

function getPageSlug(pageTitle, pageUrl) {
  const titleSlug = slugify(pageTitle || 'page');

  try {
    const parsed = new URL(pageUrl);
    const pathSegments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => shortenSlug(slugify(segment), 24))
      .filter(Boolean);
    const queryHints = ['id', 'conversation', 'chat', 'session', 'thread']
      .map((key) => parsed.searchParams.get(key))
      .filter(Boolean)
      .map((value) => shortenSlug(slugify(value), 24));
    const hashSlug = shortenSlug(slugify(parsed.hash.replace(/^#/, '')), 24);
    const urlHints = [...pathSegments.slice(-2), ...queryHints, hashSlug]
      .filter(Boolean)
      .filter((segment, index, list) => list.indexOf(segment) === index);
    const urlSlug = shortenSlug(urlHints.join('-'), 48);

    if (urlSlug && !titleSlug.includes(urlSlug) && !urlSlug.includes(titleSlug)) {
      return shortenSlug(`${titleSlug}-${urlSlug}`, 80);
    }
  } catch {
    // Fall back to a title-based slug when the URL is unavailable.
  }

  return titleSlug;
}

function getDownloadFolder(pageTitle, pageUrl) {
  let hostName = 'site';
  const pageSlug = getPageSlug(pageTitle, pageUrl);

  try {
    const parsed = new URL(pageUrl);
    hostName = slugify(parsed.hostname.replace(/^www\./i, '')) || 'site';
  } catch {
    // Fall back to a generic host label when the active tab URL is unavailable.
  }

  return `page-to-markdown/${hostName}-${pageSlug}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function buildMarkdownExport() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('No active tab available.');
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const GEMINI_HOST_PATTERN = /(^|\.)gemini\.google\.com$/i;
      const BLOCK_TAGS = new Set([
        'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption',
        'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
        'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'ul'
      ]);
      const SKIP_TAGS = new Set([
        'button', 'canvas', 'dialog', 'embed', 'form', 'iframe', 'input', 'label', 'menu', 'meter',
        'nav', 'noscript', 'object', 'option', 'script', 'select', 'style', 'svg', 'template', 'textarea'
      ]);
      const NEGATIVE_HINT = /(nav|menu|footer|header|sidebar|aside|promo|advert|ad-|cookie|consent|banner|share|social|related|breadcrumbs|comment|modal|popup)/i;
      const POSITIVE_HINT = /(article|content|post|story|entry|main|body|markdown|text|read)/i;

      const normalizeWhitespace = (text) => text.replace(/\s+/g, ' ').trim();

      const title = document.title.trim() || 'Untitled page';
      const pageUrl = location.href;

      const collectGeminiConversation = () => {
        if (!GEMINI_HOST_PATTERN.test(location.hostname)) {
          return null;
        }

        const speakerPattern = /^(you said|gemini said|show thinking\s+gemini said)$/i;
        const isSpeakerLabel = (text) => speakerPattern.test(normalizeWhitespace(text));

        const extractSpeaker = (text) => {
          const normalized = normalizeWhitespace(text).toLowerCase();
          if (normalized === 'you said') {
            return 'You';
          }
          if (normalized.endsWith('gemini said')) {
            return 'Gemini';
          }
          return '';
        };

        const getConversationTopic = (turns, fallbackTitle) => {
          const preferredTurn = turns.find((turn) => turn.speaker === 'You' && turn.body.length > 20)
            || turns.find((turn) => turn.body.length > 20)
            || turns[0];

          if (!preferredTurn?.body) {
            return fallbackTitle;
          }

          const firstSentence = preferredTurn.body
            .split(/(?<=[.!?])\s+/)
            .map((part) => normalizeWhitespace(part))
            .find(Boolean);
          const source = normalizeWhitespace(firstSentence || preferredTurn.body);
          const words = source.split(/\s+/).filter(Boolean).slice(0, 14);
          const shortened = words.join(' ').slice(0, 90).replace(/[\s,:;.-]+$/g, '');

          return shortened || fallbackTitle;
        };

        const getTurnBody = (container, labelElement) => {
          const cloned = container.cloneNode(true);
          const removableNodes = [];

          cloned.querySelectorAll('*').forEach((candidate) => {
            const text = normalizeWhitespace(candidate.textContent || '');
            if (isSpeakerLabel(text)) {
              removableNodes.push(candidate);
            }
          });

          removableNodes.forEach((candidate) => candidate.remove());

          const text = normalizeWhitespace(cloned.innerText || cloned.textContent || '');
          if (text) {
            return text;
          }

          const fallbackParts = [];
          Array.from(container.childNodes).forEach((child) => {
            if (labelElement && child === labelElement) {
              return;
            }

            const childText = normalizeWhitespace(
              child.nodeType === Node.TEXT_NODE ? child.textContent || '' : child.textContent || ''
            );

            if (childText && !isSpeakerLabel(childText)) {
              fallbackParts.push(childText);
            }
          });

          return normalizeWhitespace(fallbackParts.join(' '));
        };

        const getContainerForLabel = (labelElement) => {
          let candidate = labelElement;
          for (let depth = 0; depth < 6 && candidate?.parentElement; depth += 1) {
            candidate = candidate.parentElement;
            const text = normalizeWhitespace(candidate.innerText || candidate.textContent || '');
            if (text.length > normalizeWhitespace(labelElement.textContent || '').length + 20) {
              return candidate;
            }
          }
          return labelElement.parentElement || labelElement;
        };

        const labelElements = Array.from(document.querySelectorAll('div, span, button, h1, h2, h3, h4, h5, h6, p'))
          .filter((element) => {
            const text = normalizeWhitespace(element.textContent || '');
            if (!isSpeakerLabel(text)) {
              return false;
            }

            const parentText = normalizeWhitespace(element.parentElement?.textContent || '');
            return parentText.length <= text.length + 5000;
          });

        const seenContainers = new Set();
        const turns = [];

        labelElements.forEach((labelElement) => {
          const speaker = extractSpeaker(labelElement.textContent || '');
          if (!speaker) {
            return;
          }

          const container = getContainerForLabel(labelElement);
          if (!container || seenContainers.has(container)) {
            return;
          }

          seenContainers.add(container);
          const body = getTurnBody(container, labelElement);
          if (!body) {
            return;
          }

          turns.push({ speaker, body });
        });

        if (turns.length < 2) {
          return null;
        }

        const conversationTitle = getConversationTopic(turns, title);

        const lines = [];
        lines.push(`# ${conversationTitle}`);
        lines.push('');
        lines.push(`Source: ${pageUrl}`);
        lines.push('');

        turns.forEach((turn) => {
          lines.push(`## ${turn.speaker}`);
          lines.push('');
          lines.push(turn.body);
          lines.push('');
        });

        const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
        return { title: conversationTitle, pageUrl, markdown };
      };

      const geminiConversation = collectGeminiConversation();
      if (geminiConversation) {
        return geminiConversation;
      }

      const isVisible = (element) => {
        if (!(element instanceof Element)) {
          return true;
        }

        if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
          return false;
        }

        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };

      const shouldSkip = (element) => {
        if (!(element instanceof Element)) {
          return false;
        }

        const tag = element.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag) || !isVisible(element)) {
          return true;
        }

        const hintText = `${element.id} ${element.className || ''} ${element.getAttribute('role') || ''}`;
        return NEGATIVE_HINT.test(hintText);
      };

      const inlineText = (node) => {
        if (!node) {
          return '';
        }

        if (node.nodeType === Node.TEXT_NODE) {
          return normalizeWhitespace(node.textContent || '');
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
          return '';
        }

        const element = node;
        if (shouldSkip(element)) {
          return '';
        }

        const tag = element.tagName.toLowerCase();
        if (BLOCK_TAGS.has(tag) && tag !== 'code' && tag !== 'a' && tag !== 'strong' && tag !== 'b' && tag !== 'em' && tag !== 'i' && tag !== 'span') {
          return normalizeWhitespace(element.innerText || '');
        }

        const parts = [];
        element.childNodes.forEach((child) => {
          const text = inlineText(child);
          if (!text) {
            return;
          }

          if (child.nodeType === Node.ELEMENT_NODE) {
            const childElement = child;
            const childTag = childElement.tagName.toLowerCase();

            if (childTag === 'a') {
              const href = childElement.href || '';
              parts.push(href ? `[${text}](${href})` : text);
              return;
            }

            if (childTag === 'strong' || childTag === 'b') {
              parts.push(`**${text}**`);
              return;
            }

            if (childTag === 'em' || childTag === 'i') {
              parts.push(`*${text}*`);
              return;
            }

            if (childTag === 'code') {
              parts.push(`\`${text}\``);
              return;
            }

            if (childTag === 'br') {
              parts.push('\n');
              return;
            }
          }

          parts.push(text);
        });

        return parts.join(' ')
          .replace(/\s*\n\s*/g, '\n')
          .replace(/\s+([,.;:!?])/g, '$1')
          .replace(/\(\s+/g, '(')
          .replace(/\s+\)/g, ')')
          .trim();
      };

      const scoreElement = (element) => {
        if (shouldSkip(element)) {
          return Number.NEGATIVE_INFINITY;
        }

        const text = normalizeWhitespace(element.innerText || '');
        const textLength = text.length;
        if (textLength < 200) {
          return Number.NEGATIVE_INFINITY;
        }

        const paragraphCount = element.querySelectorAll('p').length;
        const headingCount = element.querySelectorAll('h1, h2, h3').length;
        const listItemCount = element.querySelectorAll('li').length;
        const blockquoteCount = element.querySelectorAll('blockquote').length;
        const preCount = element.querySelectorAll('pre').length;
        const anchorTextLength = Array.from(element.querySelectorAll('a'))
          .reduce((sum, anchor) => sum + normalizeWhitespace(anchor.textContent || '').length, 0);
        const linkDensity = textLength ? anchorTextLength / textLength : 0;
        const hintText = `${element.tagName} ${element.id} ${element.className || ''}`;
        const positiveBoost = POSITIVE_HINT.test(hintText) ? 300 : 0;
        const negativePenalty = NEGATIVE_HINT.test(hintText) ? 400 : 0;

        let score = textLength;
        score += paragraphCount * 140;
        score += headingCount * 80;
        score += listItemCount * 28;
        score += blockquoteCount * 60;
        score += preCount * 40;
        score += positiveBoost;
        score -= negativePenalty;
        score -= linkDensity * textLength * 0.9;

        const tag = element.tagName.toLowerCase();
        if (tag === 'article') {
          score += 500;
        } else if (tag === 'main') {
          score += 350;
        } else if (tag === 'section') {
          score += 120;
        }

        return score;
      };

      const candidates = [document.body, ...document.querySelectorAll('article, main, [role="main"], section, div')];
      let root = document.body;
      let rootScore = Number.NEGATIVE_INFINITY;

      candidates.forEach((candidate) => {
        const score = scoreElement(candidate);
        if (score > rootScore) {
          root = candidate;
          rootScore = score;
        }
      });

      const lines = [];

      const appendBlock = (text) => {
        const value = typeof text === 'string' ? text.trim() : '';
        if (!value) {
          return;
        }
        lines.push(value);
        lines.push('');
      };

      const renderTable = (table) => {
        const rows = Array.from(table.querySelectorAll('tr'))
          .map((row) => Array.from(row.querySelectorAll('th, td')).map((cell) => inlineText(cell)))
          .filter((row) => row.some(Boolean));

        if (!rows.length) {
          return;
        }

        const header = rows[0];
        const bodyRows = rows.slice(1);
        lines.push(`| ${header.join(' | ')} |`);
        lines.push(`| ${header.map(() => '---').join(' | ')} |`);
        bodyRows.forEach((row) => lines.push(`| ${row.join(' | ')} |`));
        lines.push('');
      };

      const renderList = (listElement, depth = 0) => {
        const marker = listElement.tagName.toLowerCase() === 'ol';
        const items = Array.from(listElement.children).filter((child) => child.tagName.toLowerCase() === 'li');

        items.forEach((item, index) => {
          const prefix = marker ? `${index + 1}.` : '-';
          const nestedLists = Array.from(item.children).filter((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()));
          const fragments = [];

          item.childNodes.forEach((childNode) => {
            if (childNode.nodeType === Node.ELEMENT_NODE && ['ul', 'ol'].includes(childNode.tagName.toLowerCase())) {
              return;
            }

            const text = inlineText(childNode);
            if (text) {
              fragments.push(text);
            }
          });

          const itemText = fragments.join(' ').replace(/\s+/g, ' ').trim();
          if (itemText) {
            lines.push(`${'  '.repeat(depth)}${prefix} ${itemText}`);
          }

          nestedLists.forEach((nestedList) => renderList(nestedList, depth + 1));
        });

        lines.push('');
      };

      const processNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = normalizeWhitespace(node.textContent || '');
          if (text) {
            appendBlock(text);
          }
          return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
          return;
        }

        const element = node;
        if (shouldSkip(element)) {
          return;
        }

        const tag = element.tagName.toLowerCase();

        if (/^h[1-6]$/.test(tag)) {
          const level = Number(tag.slice(1));
          appendBlock(`${'#'.repeat(level)} ${inlineText(element)}`);
          return;
        }

        if (tag === 'p') {
          appendBlock(inlineText(element));
          return;
        }

        if (tag === 'blockquote') {
          const quoteLines = [];
          const originalLength = lines.length;
          Array.from(element.childNodes).forEach((child) => processNode(child));
          const newBlocks = lines.splice(originalLength);
          const text = newBlocks.join('\n').trim() || inlineText(element);
          if (text) {
            text.split(/\n+/).forEach((line) => quoteLines.push(`> ${line}`));
            appendBlock(quoteLines.join('\n'));
          }
          return;
        }

        if (tag === 'pre') {
          const text = (element.textContent || '').trim();
          if (text) {
            lines.push('```');
            lines.push(text);
            lines.push('```');
            lines.push('');
          }
          return;
        }

        if (tag === 'ul' || tag === 'ol') {
          renderList(element);
          return;
        }

        if (tag === 'hr') {
          appendBlock('---');
          return;
        }

        if (tag === 'table') {
          renderTable(element);
          return;
        }

        if (tag === 'img') {
          const alt = normalizeWhitespace(element.getAttribute('alt') || '');
          if (alt) {
            appendBlock(`![${alt}](${element.currentSrc || element.src || ''})`);
          }
          return;
        }

        if (!Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName.toLowerCase()))) {
          const text = inlineText(element);
          if (text) {
            appendBlock(text);
          }
          return;
        }

        Array.from(element.childNodes).forEach((child) => processNode(child));
      };

      lines.push(`# ${title}`);
      lines.push('');
      lines.push(`Source: ${pageUrl}`);
      lines.push('');

      Array.from(root.childNodes).forEach((child) => processNode(child));

      const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
      return { title, pageUrl, markdown };
    },
  });

  return result;
}

async function refreshPreview() {
  setStatus('Building Markdown preview...');

  try {
    latestExport = await buildMarkdownExport();
    previewElement.value = latestExport.markdown;
    setStatus(`Ready: ${latestExport.title}`);
  } catch (error) {
    console.error(error);
    latestExport = null;
    previewElement.value = '';
    setStatus(error.message || 'Unable to build Markdown.');
  }
}

async function downloadMarkdown() {
  if (!latestExport) {
    await refreshPreview();
  }

  if (!latestExport) {
    return;
  }

  const fileName = `${getPageSlug(latestExport.title, latestExport.pageUrl)}.md`;
  const downloadFolder = getDownloadFolder(latestExport.title, latestExport.pageUrl);
  const blob = new Blob([latestExport.markdown], { type: 'text/markdown;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url: blobUrl,
      filename: `${downloadFolder}/${fileName}`,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    setStatus(`Downloaded ${fileName}`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
  }
}

async function openPdfPreview() {
  if (!latestExport) {
    await refreshPreview();
  }

  if (!latestExport) {
    return;
  }

  const storageKey = `pending-pdf-export:${Date.now()}:${crypto.randomUUID()}`;

  setStatus('Preparing PDF preview...');
  await chrome.storage.session.set({
    [storageKey]: {
      ...latestExport,
      createdAt: Date.now(),
    },
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL(`pdf-preview.html?storageKey=${encodeURIComponent(storageKey)}`),
  });

  setStatus('PDF preview opened. Choose Save as PDF in the print dialog.');
}

previewButton.addEventListener('click', refreshPreview);
downloadButton.addEventListener('click', downloadMarkdown);
pdfButton.addEventListener('click', openPdfPreview);

refreshPreview();
