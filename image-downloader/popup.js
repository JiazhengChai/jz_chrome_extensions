const statusElement = document.getElementById('status');
const imageListElement = document.getElementById('imageList');
const imageTemplate = document.getElementById('imageTemplate');
const refreshButton = document.getElementById('refreshButton');
const toggleAllButton = document.getElementById('toggleAllButton');
const normalDownloadButton = document.getElementById('normalDownloadButton');
const downloadButton = document.getElementById('downloadButton');

let images = [];
let allSelected = true;
let isDownloading = false;

const EMPTY_STATE_MESSAGE = 'No downloadable image URLs were found in img tags, lazy-load attributes, or CSS backgrounds.';

function setStatus(message) {
  statusElement.textContent = message;
}

function getFileName(url, index) {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop() || `image-${index + 1}`;
    return decodeURIComponent(lastSegment.split('?')[0]);
  } catch {
    return `image-${index + 1}`;
  }
}

function getSafeDownloadName(url, index) {
  const rawName = getFileName(url, index);
  const sanitized = rawName.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-');
  return sanitized || `image-${index + 1}.bin`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page-images';
}

function setBusyState(isBusy) {
  isDownloading = isBusy;
  downloadButton.disabled = isBusy;
  normalDownloadButton.disabled = isBusy;
  refreshButton.disabled = isBusy;
  toggleAllButton.disabled = isBusy;
}

function getFileExtension(url, contentType) {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const extensionMatch = lastSegment.match(/\.([a-z0-9]{2,5})$/i);
    if (extensionMatch) {
      return extensionMatch[1].toLowerCase();
    }
  } catch {
    // Ignore malformed URLs and fall back to content-type mapping.
  }

  const normalizedType = (contentType || '').split(';')[0].trim().toLowerCase();
  const typeToExtension = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico'
  };

  return typeToExtension[normalizedType] || 'bin';
}

function getArchiveName(pageTitle) {
  return `${slugify(pageTitle)}-images.zip`;
}

function getDownloadFolder(pageTitle, pageUrl) {
  let hostName = 'site';

  try {
    const parsed = new URL(pageUrl);
    hostName = slugify(parsed.hostname.replace(/^www\./i, '')) || 'site';
  } catch {
    // Fall back to a generic host label when the active tab URL is unavailable.
  }

  return `page-image-downloader/${hostName}-${slugify(pageTitle || 'page-images')}`;
}

async function fetchImageBlob(image) {
  const response = await fetch(image.url, {
    credentials: 'include',
    cache: 'force-cache',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    blob: await response.blob(),
    contentType: response.headers.get('content-type') || '',
  };
}

function renderImages() {
  imageListElement.textContent = '';

  if (!images.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'status';
    emptyState.textContent = EMPTY_STATE_MESSAGE;
    imageListElement.append(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();

  images.forEach((image, index) => {
    const node = imageTemplate.content.firstElementChild.cloneNode(true);
    const checkbox = node.querySelector('.image-checkbox');
    const preview = node.querySelector('.preview');
    const name = node.querySelector('.name');
    const details = node.querySelector('.details');

    checkbox.checked = image.selected;
    checkbox.addEventListener('change', () => {
      image.selected = checkbox.checked;
      allSelected = images.every((item) => item.selected);
      toggleAllButton.textContent = allSelected ? 'Clear all' : 'Select all';
    });

    preview.src = image.url;
    name.textContent = image.fileName;
    const detailParts = [];
    if (image.kind) {
      detailParts.push(image.kind);
    }
    if (image.dimensions) {
      detailParts.push(image.dimensions);
    }
    detailParts.push(image.url);
    details.textContent = detailParts.join(' • ');

    fragment.append(node);
  });

  imageListElement.append(fragment);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scanPage() {
  setStatus('Scanning page for images...');

  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      throw new Error('No active tab available.');
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const seen = new Set();
        const results = [];
        const lazyAttributes = [
          'src',
          'currentSrc',
          'data-src',
          'data-original',
          'data-url',
          'data-image',
          'data-fallback-src',
          'data-lazy-src',
          'data-lazy',
          'data-actualsrc',
          'data-deferred-src'
        ];
        const srcsetAttributes = ['srcset', 'data-srcset', 'data-lazy-srcset'];
        const backgroundUrlPattern = /url\((['"]?)(.*?)\1\)/g;

        const toAbsoluteUrl = (value) => {
          if (!value) {
            return '';
          }

          const trimmed = value.trim();
          if (!trimmed || /^data:/i.test(trimmed)) {
            return '';
          }

          try {
            return new URL(trimmed, document.baseURI).href;
          } catch {
            return '';
          }
        };

        const parseSrcset = (value) => {
          if (!value) {
            return [];
          }

          return value
            .split(',')
            .map((part) => part.trim().split(/\s+/)[0])
            .map((candidate) => toAbsoluteUrl(candidate))
            .filter(Boolean);
        };

        const getBackgroundUrls = (value) => {
          if (!value || value === 'none') {
            return [];
          }

          const urls = [];
          let match = backgroundUrlPattern.exec(value);
          while (match) {
            const url = toAbsoluteUrl(match[2]);
            if (url) {
              urls.push(url);
            }
            match = backgroundUrlPattern.exec(value);
          }
          backgroundUrlPattern.lastIndex = 0;
          return urls;
        };

        const addResult = (url, details) => {
          const normalizedUrl = toAbsoluteUrl(url);
          if (!normalizedUrl || seen.has(normalizedUrl)) {
            return;
          }

          seen.add(normalizedUrl);
          results.push({
            url: normalizedUrl,
            dimensions: details.dimensions || '',
            kind: details.kind || 'image',
          });
        };

        Array.from(document.images).forEach((image) => {
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          const dimensions = width && height ? `${width}x${height}` : '';

          addResult(image.currentSrc || image.src, { dimensions, kind: 'img' });

          lazyAttributes.forEach((attribute) => {
            addResult(image.getAttribute(attribute), { dimensions, kind: 'lazy-img' });
          });

          srcsetAttributes.forEach((attribute) => {
            parseSrcset(image.getAttribute(attribute)).forEach((candidateUrl) => {
              addResult(candidateUrl, { dimensions, kind: 'srcset-img' });
            });
          });
        });

        Array.from(document.querySelectorAll('source')).forEach((source) => {
          srcsetAttributes.forEach((attribute) => {
            parseSrcset(source.getAttribute(attribute)).forEach((candidateUrl) => {
              addResult(candidateUrl, { kind: 'source-srcset' });
            });
          });
        });

        Array.from(document.querySelectorAll('[poster]')).forEach((element) => {
          addResult(element.getAttribute('poster'), {
            dimensions: element.clientWidth && element.clientHeight ? `${element.clientWidth}x${element.clientHeight}` : '',
            kind: 'poster',
          });
        });

        Array.from(document.querySelectorAll('*')).forEach((element) => {
          const computedStyle = getComputedStyle(element);
          const backgroundSources = [
            computedStyle.backgroundImage,
            element.style.backgroundImage,
            element.getAttribute('data-bg'),
            element.getAttribute('data-background'),
            element.getAttribute('data-background-image')
          ];
          const dimensions = element.clientWidth && element.clientHeight ? `${element.clientWidth}x${element.clientHeight}` : '';

          backgroundSources.forEach((value) => {
            getBackgroundUrls(value).forEach((backgroundUrl) => {
              addResult(backgroundUrl, { dimensions, kind: 'background' });
            });
          });
        });

        return results;
      },
    });

    images = (result || []).map((image, index) => ({
      ...image,
      selected: true,
      fileName: getFileName(image.url, index),
      downloadName: getSafeDownloadName(image.url, index),
    }));
    allSelected = true;
    toggleAllButton.textContent = images.length ? 'Clear all' : 'Select all';
    setStatus(`Found ${images.length} image${images.length === 1 ? '' : 's'}.`);
    renderImages();
  } catch (error) {
    console.error(error);
    images = [];
    renderImages();
    setStatus(error.message || 'Unable to scan the page.');
  }
}

async function downloadSelected() {
  if (isDownloading) {
    return;
  }

  const selectedImages = images.filter((image) => image.selected);

  if (!selectedImages.length) {
    setStatus('Select at least one image to include in the ZIP.');
    return;
  }

  setBusyState(true);
  setStatus(`Fetching ${selectedImages.length} image${selectedImages.length === 1 ? '' : 's'} for ZIP...`);

  try {
    const activeTab = await getActiveTab();
    const pageTitle = activeTab?.title || 'page-images';
    const downloadFolder = getDownloadFolder(pageTitle, activeTab?.url || '');
    const zip = new JSZip();
    let addedCount = 0;
    const failedImages = [];
    const usedNames = new Set();

    for (const [index, image] of selectedImages.entries()) {
      setStatus(`Adding ${index + 1} of ${selectedImages.length} to ZIP...`);

      try {
        const { blob, contentType } = await fetchImageBlob(image);
        const extension = getFileExtension(image.url, contentType);
        let baseName = image.downloadName.replace(/\.[a-z0-9]{2,5}$/i, '') || `image-${index + 1}`;
        let archiveName = `${String(index + 1).padStart(2, '0')}-${baseName}.${extension}`;
        let suffix = 1;

        while (usedNames.has(archiveName)) {
          archiveName = `${String(index + 1).padStart(2, '0')}-${baseName}-${suffix}.${extension}`;
          suffix += 1;
        }

        usedNames.add(archiveName);
        zip.file(archiveName, blob);
        addedCount += 1;
      } catch (error) {
        console.error('Image fetch failed', image.url, error);
        failedImages.push(image.fileName || image.url);
      }
    }

    if (!addedCount) {
      const failureReason = failedImages.length ? ` Unable to fetch ${failedImages.length} selected image${failedImages.length === 1 ? '' : 's'}.` : '';
      throw new Error(`No images were added to the ZIP.${failureReason}`);
    }

    setStatus('Compressing ZIP archive...');
    const archiveBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const archiveUrl = URL.createObjectURL(archiveBlob);

    try {
      await chrome.downloads.download({
        url: archiveUrl,
        filename: `${downloadFolder}/${getArchiveName(pageTitle)}`,
        conflictAction: 'uniquify',
        saveAs: false,
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(archiveUrl), 5_000);
    }

    const failureSuffix = failedImages.length ? ` ${failedImages.length} image${failedImages.length === 1 ? '' : 's'} failed to fetch.` : '';
    setStatus(`Downloaded ZIP with ${addedCount} image${addedCount === 1 ? '' : 's'}.${failureSuffix}`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Unable to build the ZIP archive.');
  } finally {
    setBusyState(false);
  }
}

async function downloadSelectedNormally() {
  if (isDownloading) {
    return;
  }

  const selectedImages = images.filter((image) => image.selected);

  if (!selectedImages.length) {
    setStatus('Select at least one image to download.');
    return;
  }

  setBusyState(true);
  setStatus(`Queueing ${selectedImages.length} file${selectedImages.length === 1 ? '' : 's'}...`);

  try {
    const activeTab = await getActiveTab();
    const pageTitle = activeTab?.title || 'page-images';
    const downloadFolder = getDownloadFolder(pageTitle, activeTab?.url || '');
    let queuedCount = 0;
    let failedCount = 0;

    for (const [index, image] of selectedImages.entries()) {
      setStatus(`Queueing ${index + 1} of ${selectedImages.length} files...`);

      try {
        await chrome.downloads.download({
          url: image.url,
          filename: `${downloadFolder}/${String(index + 1).padStart(2, '0')}-${image.downloadName}`,
          conflictAction: 'uniquify',
          saveAs: false,
        });
        queuedCount += 1;
      } catch (error) {
        console.error('Direct download failed', image.url, error);
        failedCount += 1;
      }
    }

    if (!queuedCount) {
      throw new Error('Unable to queue any direct downloads.');
    }

    const failureSuffix = failedCount ? ` ${failedCount} file${failedCount === 1 ? '' : 's'} failed.` : '';
    setStatus(`Queued ${queuedCount} direct download${queuedCount === 1 ? '' : 's'}.${failureSuffix}`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Unable to queue direct downloads.');
  } finally {
    setBusyState(false);
  }
}

refreshButton.addEventListener('click', scanPage);

toggleAllButton.addEventListener('click', () => {
  allSelected = !allSelected;
  images = images.map((image) => ({ ...image, selected: allSelected }));
  toggleAllButton.textContent = allSelected ? 'Clear all' : 'Select all';
  renderImages();
});

normalDownloadButton.addEventListener('click', downloadSelectedNormally);
downloadButton.addEventListener('click', downloadSelected);

scanPage();
