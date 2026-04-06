const titleElement = document.getElementById('documentTitle');
const sourceElement = document.getElementById('documentSource');
const contentElement = document.getElementById('documentContent');
const statusElement = document.getElementById('statusMessage');
const saveButton = document.getElementById('saveButton');

let currentExportData = null;

function setStatus(message) {
  statusElement.textContent = message;
}

saveButton.disabled = true;

function getCurrentTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.getCurrent((tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (tab?.id) {
        resolve(tab);
        return;
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const queryError = chrome.runtime.lastError;
        if (queryError) {
          reject(new Error(queryError.message));
          return;
        }

        resolve(tabs[0]);
      });
    });
  });
}

function attachDebugger(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, '1.3', () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function detachDebugger(target) {
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => {
      resolve();
    });
  });
}

function sendDebuggerCommand(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(result);
    });
  });
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function savePdf(exportData) {
  if (!exportData?.downloadFolder || !exportData?.pdfFileName) {
    throw new Error('Missing PDF export target. Re-open the PDF preview from the popup.');
  }

  const tab = await getCurrentTab();

  if (!tab?.id) {
    throw new Error('Unable to identify the PDF preview tab.');
  }

  const debuggee = { tabId: tab.id };
  let attached = false;

  try {
    await attachDebugger(debuggee);
    attached = true;

    await sendDebuggerCommand(debuggee, 'Page.enable');
    const result = await sendDebuggerCommand(debuggee, 'Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
    });

    if (!result?.data) {
      throw new Error('PDF rendering did not produce any data.');
    }

    const pdfBlob = base64ToBlob(result.data, 'application/pdf');
    const blobUrl = URL.createObjectURL(pdfBlob);

    try {
      await chrome.downloads.download({
        url: blobUrl,
        filename: `${exportData.downloadFolder}/${exportData.pdfFileName}`,
        conflictAction: 'uniquify',
        saveAs: false,
      });
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
    }
  } finally {
    if (attached) {
      await detachDebugger(debuggee);
    }
  }
}

async function runPdfSave() {
  if (!currentExportData) {
    return;
  }

  saveButton.disabled = true;
  setStatus('Saving PDF to the same folder as the Markdown export...');

  try {
    await savePdf(currentExportData);
    setStatus('Saved PDF to the same folder as the Markdown export.');
  } catch (error) {
    console.error(error);
    setStatus('Direct PDF save failed. Falling back to the print dialog.');
    window.print();
  } finally {
    saveButton.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '#';
  }

  try {
    const parsed = new URL(rawValue, 'https://example.invalid');
    if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch {
    if (rawValue.startsWith('#') || rawValue.startsWith('/')) {
      return rawValue;
    }
  }

  return '#';
}

function renderInline(text) {
  const tokens = [];
  let html = String(text || '');

  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@INLINE${tokens.length}@@`;
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const token = `@@INLINE${tokens.length}@@`;
    tokens.push(`<a href="${escapeHtml(sanitizeUrl(url))}">${escapeHtml(label)}</a>`);
    return token;
  });

  html = escapeHtml(html);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');

  tokens.forEach((tokenHtml, index) => {
    html = html.split(`@@INLINE${index}@@`).join(tokenHtml);
  });

  return html;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isListLine(line) {
  return /^(\s*)(-|\d+\.)\s+/.test(line);
}

function getIndent(line) {
  return (line.match(/^\s*/) || [''])[0].length;
}

function parseList(lines, startIndex, baseIndent) {
  let index = startIndex;
  let listType = null;
  const items = [];

  while (index < lines.length) {
    const currentLine = lines[index];
    if (!currentLine.trim()) {
      index += 1;
      continue;
    }

    const match = currentLine.match(/^(\s*)(-|\d+\.)\s+(.*)$/);
    if (!match) {
      if (items.length && getIndent(currentLine) > baseIndent) {
        items[items.length - 1].content.push(currentLine.trim());
        index += 1;
        continue;
      }
      break;
    }

    const indent = match[1].length;
    if (indent < baseIndent) {
      break;
    }

    if (indent > baseIndent) {
      if (!items.length) {
        break;
      }
      const nested = parseList(lines, index, indent);
      items[items.length - 1].children.push(nested.html);
      index = nested.nextIndex;
      continue;
    }

    const currentType = /^\d+\.$/.test(match[2]) ? 'ol' : 'ul';
    listType = listType || currentType;
    if (listType !== currentType) {
      break;
    }

    items.push({ content: [match[3]], children: [] });
    index += 1;
  }

  const tagName = listType || 'ul';
  const html = `<${tagName}>${items.map((item) => {
    const body = renderInline(item.content.join(' '));
    return `<li>${body}${item.children.join('')}</li>`;
  }).join('')}</${tagName}>`;

  return { html, nextIndex: index };
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push('<hr />');
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote><p>${renderInline(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    if (isListLine(line)) {
      const list = parseList(lines, index, getIndent(line));
      blocks.push(list.html);
      index = list.nextIndex;
      continue;
    }

    if (/^\|.*\|$/.test(trimmed) && index + 1 < lines.length && /^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(lines[index + 1].trim())) {
      const tableLines = [trimmed];
      index += 2;
      while (index < lines.length && /^\|.*\|$/.test(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index += 1;
      }

      const headerCells = splitTableRow(tableLines[0]);
      const bodyRows = tableLines.slice(1).map(splitTableRow);
      blocks.push([
        '<table>',
        `<thead><tr>${headerCells.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`,
        `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`,
        '</table>',
      ].join(''));
      continue;
    }

    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      const label = imageMatch[1].trim() || 'Image';
      const url = sanitizeUrl(imageMatch[2]);
      blocks.push(`<p class="image-line"><strong>${escapeHtml(label)}:</strong> <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`);
      index += 1;
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index];
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed || /^```/.test(nextTrimmed) || /^(#{1,6})\s+/.test(nextTrimmed) || /^>\s?/.test(nextTrimmed) || /^---+$/.test(nextTrimmed) || isListLine(nextLine) || /^\|.*\|$/.test(nextTrimmed)) {
        break;
      }
      paragraphLines.push(nextTrimmed);
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`);
  }

  return blocks.join('');
}

async function loadPendingExport() {
  const params = new URLSearchParams(window.location.search);
  const storageKey = params.get('storageKey');

  if (!storageKey) {
    throw new Error('Missing PDF export token.');
  }

  const stored = await chrome.storage.session.get(storageKey);
  const exportData = stored[storageKey];
  await chrome.storage.session.remove(storageKey);

  if (!exportData?.markdown) {
    throw new Error('The PDF export data is no longer available. Re-open it from the popup.');
  }

  return exportData;
}

async function initialize() {
  try {
    const exportData = await loadPendingExport();
    currentExportData = exportData;
    const sourceUrl = sanitizeUrl(exportData.pageUrl);

    document.title = `${exportData.title} - PDF Preview`;
    titleElement.textContent = exportData.title;
    sourceElement.innerHTML = `Source: <a href="${escapeHtml(sourceUrl)}">${escapeHtml(exportData.pageUrl)}</a>`;
    contentElement.innerHTML = renderMarkdown(exportData.markdown);
    setStatus('Saving PDF to the same folder as the Markdown export...');

    window.setTimeout(() => {
      void runPdfSave();
    }, 300);
  } catch (error) {
    console.error(error);
    titleElement.textContent = 'Unable to prepare PDF';
    sourceElement.textContent = '';
    contentElement.innerHTML = `<p>${escapeHtml(error.message || 'Unknown error.')}</p>`;
    setStatus('PDF preview failed to load.');
  }
}

saveButton.addEventListener('click', () => {
  void runPdfSave();
});

window.addEventListener('afterprint', () => {
  setStatus('Print dialog closed. You can save again or close this tab.');
});

initialize();