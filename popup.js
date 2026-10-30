'use strict';

var STORAGE_KEY = 'framesnapHistory';
var MAX_HISTORY = 30;
var CAPTURE_TIMEOUT_MS = 20000;

var captureBtn = document.getElementById('capture-btn');
var banner = document.getElementById('banner');
var workspace = document.getElementById('workspace');
var workspaceShot = document.getElementById('workspace-shot');
var workspaceTime = document.getElementById('workspace-time');
var workspaceDetail = document.getElementById('workspace-detail');
var historySection = document.getElementById('history');
var historyCount = document.getElementById('history-count');
var historyGrid = document.getElementById('history-grid');
var emptyState = document.getElementById('empty-state');

var frames = [];
var capturing = false;
var busyAction = false;

function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  var total = Math.floor(seconds + 1e-6);
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = total % 60;
  var ss = String(s).padStart(2, '0');
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + ss;
  return m + ':' + ss;
}

function platformLabel(platform) {
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'vimeo') return 'Vimeo';
  return 'HTML5';
}

function makeId() {
  try {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (err) {
    // Local fallback below.
  }
  return 'fs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
}

function isSafeDataUrl(value) {
  return typeof value === 'string' && /^data:image\/jpeg;base64,[a-z0-9+/=\s]+$/i.test(value);
}

function sanitizeFrame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isSafeDataUrl(raw.dataUrl)) return null;
  var currentTime = Number(raw.currentTime);
  if (!Number.isFinite(currentTime) || currentTime < 0) currentTime = 0;
  var duration = Number(raw.duration);
  if (!Number.isFinite(duration) || duration < 0) duration = null;
  var id = typeof raw.id === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(raw.id) ? raw.id : makeId();
  var platform = raw.platform === 'youtube' || raw.platform === 'vimeo' ? raw.platform : 'html5';
  var capturedAt = Number(raw.capturedAt);
  if (!Number.isFinite(capturedAt)) capturedAt = Date.now();
  var width = Number(raw.width);
  var height = Number(raw.height);
  return {
    id: id,
    dataUrl: raw.dataUrl.replace(/\s+/g, ''),
    currentTime: currentTime,
    duration: duration,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '',
    url: typeof raw.url === 'string' ? raw.url.slice(0, 2000) : '',
    platform: platform,
    capturedAt: capturedAt,
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : 0
  };
}

function showBanner(message, kind) {
  banner.hidden = false;
  banner.className = 'banner ' + (kind === 'info' ? 'info' : 'error');
  banner.setAttribute('role', kind === 'info' ? 'status' : 'alert');
  banner.textContent = message;
}

function clearBanner() {
  banner.hidden = true;
  banner.textContent = '';
  banner.className = 'banner';
}

function callChrome(invoke) {
  return new Promise(function (resolve, reject) {
    try {
      invoke(function (result) {
        var err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message || 'Chrome API call failed.'));
        else resolve(result);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function withTimeout(promise, ms, message) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error(message)); }, ms);
    promise.then(
      function (value) { clearTimeout(timer); resolve(value); },
      function (err) { clearTimeout(timer); reject(err); }
    );
  });
}

function estimateBytes(list) {
  try {
    return JSON.stringify(list).length + STORAGE_KEY.length;
  } catch (err) {
    return Number.POSITIVE_INFINITY;
  }
}

function isQuotaError(err) {
  return /quota/i.test(err && err.message ? err.message : '');
}

function saveFrames(next) {
  var list = next.slice(0, MAX_HISTORY);
  var quotaTrimmed = false;
  var quota = 10485760;
  try {
    if (chrome.storage && chrome.storage.local && chrome.storage.local.QUOTA_BYTES) {
      quota = chrome.storage.local.QUOTA_BYTES;
    }
  } catch (err) {
    quota = 10485760;
  }
  var budget = Math.floor(quota * 0.9);
  while (list.length > 1 && estimateBytes(list) > budget) {
    list.pop();
    quotaTrimmed = true;
  }

  function write(remaining) {
    return callChrome(function (done) {
      var payload = {};
      payload[STORAGE_KEY] = remaining;
      chrome.storage.local.set(payload, done);
    }).then(function () {
      return { ok: true, frames: remaining, trimmed: quotaTrimmed };
    }).catch(function (err) {
      if (isQuotaError(err) && remaining.length > 1) {
        quotaTrimmed = true;
        return write(remaining.slice(0, -1));
      }
      if (isQuotaError(err)) {
        return {
          ok: false,
          message: 'This frame is too large for local storage. Delete older snapshots and try a shorter or smaller video.'
        };
      }
      return { ok: false, message: 'Could not save this snapshot on this device.' };
    });
  }

  return write(list);
}

function loadFrames() {
  return callChrome(function (done) {
    chrome.storage.local.get(STORAGE_KEY, done);
  }).then(function (data) {
    var value = data ? data[STORAGE_KEY] : null;
    if (!Array.isArray(value)) return [];
    var clean = [];
    for (var i = 0; i < value.length && clean.length < MAX_HISTORY; i += 1) {
      var frame = sanitizeFrame(value[i]);
      if (frame) clean.push(frame);
    }
    return clean;
  });
}

function setCapturing(active) {
  capturing = active;
  captureBtn.disabled = active;
  captureBtn.textContent = active ? 'Capturing…' : 'Capture Current Frame';
  captureBtn.setAttribute('aria-busy', active ? 'true' : 'false');
}

function detailText(frame) {
  var bits = [];
  if (frame.duration != null) bits.push('of ' + formatTimestamp(frame.duration));
  bits.push(platformLabel(frame.platform));
  if (frame.title) bits.push(frame.title);
  return bits.join(' · ');
}

function render() {
  var latest = frames[0];
  if (!latest) {
    workspace.hidden = true;
    historySection.hidden = true;
    historyGrid.replaceChildren();
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  workspace.hidden = false;
  historySection.hidden = false;
  workspaceShot.src = latest.dataUrl;
  workspaceShot.alt = 'Captured frame at ' + formatTimestamp(latest.currentTime);
  workspaceTime.textContent = formatTimestamp(latest.currentTime);
  workspaceTime.dataset.id = latest.id;
  workspaceTime.title = 'Seek the active tab to ' + latest.currentTime.toFixed(3) + 's';
  workspaceDetail.textContent = detailText(latest);
  workspaceDetail.title = latest.title || platformLabel(latest.platform);
  historyCount.textContent = frames.length + ' saved';
  historyGrid.replaceChildren();
  for (var i = 0; i < frames.length; i += 1) {
    historyGrid.appendChild(buildCard(frames[i]));
  }
}

function buildCard(frame) {
  var card = document.createElement('article');
  card.className = 'card';
  card.id = 'frame-' + frame.id;

  var img = document.createElement('img');
  img.src = frame.dataUrl;
  img.alt = 'Frame at ' + formatTimestamp(frame.currentTime);
  img.decoding = 'async';
  img.draggable = false;

  var thumb = document.createElement('div');
  thumb.className = 'thumb';
  thumb.appendChild(img);

  var time = document.createElement('button');
  time.type = 'button';
  time.className = 'time';
  time.dataset.action = 'seek';
  time.dataset.id = frame.id;
  time.textContent = formatTimestamp(frame.currentTime);
  time.title = 'Seek the active tab to ' + frame.currentTime.toFixed(3) + 's';

  var actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    actionButton('download', frame.id, 'Download', false),
    actionButton('copy', frame.id, 'Copy', false),
    actionButton('delete', frame.id, 'Delete', true)
  );

  var meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.append(time, actions);
  card.append(thumb, meta);
  return card;
}

function actionButton(action, id, label, danger) {
  var button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = label;
  if (danger) button.className = 'danger';
  return button;
}

function findFrame(id) {
  for (var i = 0; i < frames.length; i += 1) {
    if (frames[i].id === id) return frames[i];
  }
  return null;
}

function fileName(frame) {
  var stamp = formatTimestamp(frame.currentTime).replace(/:/g, '-');
  return 'framesnap-' + frame.platform + '-' + stamp + '.jpg';
}

function dataUrlToBlobSync(dataUrl) {
  var comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Bad image data.');
  var header = dataUrl.slice(0, comma);
  var mimeMatch = /^data:([^;,]+)/i.exec(header);
  var mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  var binary = atob(dataUrl.slice(comma + 1));
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadFrame(frame) {
  var href = frame.dataUrl;
  var revoke = '';
  try {
    href = URL.createObjectURL(dataUrlToBlobSync(frame.dataUrl));
    revoke = href;
  } catch (err) {
    href = frame.dataUrl;
  }
  var link = document.createElement('a');
  link.href = href;
  link.download = fileName(frame);
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (revoke) setTimeout(function () { URL.revokeObjectURL(revoke); }, 1500);
}

function dataUrlToPngBlob(dataUrl) {
  return fetch(dataUrl).then(function (response) {
    return response.blob();
  }).then(function (blob) {
    return createImageBitmap(blob);
  }).then(function (bitmap) {
    var canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      throw new Error('Could not copy the image.');
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (png) {
        if (png) resolve(png);
        else reject(new Error('Could not copy the image.'));
      }, 'image/png');
    });
  });
}

function copyFrame(frame) {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem !== 'function') {
    return Promise.reject(new Error('This browser cannot write an image to the clipboard from the popup.'));
  }
  var writePromise;
  try {
    var pngPromise = dataUrlToPngBlob(frame.dataUrl);
    writePromise = navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
  } catch (err) {
    writePromise = dataUrlToPngBlob(frame.dataUrl).then(function (blob) {
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
  }
  return withTimeout(writePromise, 4000, 'Could not copy the image to the clipboard.');
}

function runtimeMessage(message) {
  return callChrome(function (done) {
    chrome.runtime.sendMessage(message, done);
  });
}

function errorMessage(response, fallback) {
  if (response && response.error && response.error.message) return response.error.message;
  return fallback;
}

function onCapture() {
  if (capturing) return;
  clearBanner();
  setCapturing(true);
  var pending;
  try {
    pending = withTimeout(
      runtimeMessage({ type: 'CAPTURE_FRAME' }),
      CAPTURE_TIMEOUT_MS,
      'The capture took too long and was stopped. Try again.'
    );
  } catch (err) {
    setCapturing(false);
    showBanner('Could not start a capture.', 'error');
    return;
  }
  pending.then(function (response) {
    if (!response || response.ok !== true) {
      showBanner(errorMessage(response, 'Could not capture a frame.'), 'error');
      return null;
    }
    var frame = sanitizeFrame(response.frame);
    if (!frame) {
      showBanner('The capture came back incomplete.', 'error');
      return null;
    }
    var next = [frame].concat(frames.filter(function (item) { return item.id !== frame.id; }));
    return saveFrames(next).then(function (saved) {
      if (!saved.ok) {
        showBanner(saved.message, 'error');
        return;
      }
      frames = saved.frames;
      render();
      if (saved.trimmed) {
        showBanner('Saved this frame. Older snapshots were removed because local storage was nearly full.', 'info');
      }
    });
  }).catch(function (err) {
    showBanner(err && err.message ? err.message : 'Could not capture a frame.', 'error');
  }).then(function () {
    setCapturing(false);
  });
}

function onSeek(frame) {
  clearBanner();
  runtimeMessage({ type: 'SEEK_TO_TIME', time: frame.currentTime }).then(function (response) {
    if (!response || response.ok !== true) {
      showBanner(errorMessage(response, 'Could not seek the video on this tab.'), 'error');
      return;
    }
    var label = formatTimestamp(frame.currentTime);
    if (response.pageUrl && frame.url && response.pageUrl !== frame.url) {
      showBanner('Moved the video on the active tab to ' + label + '. That tab is a different page than this snapshot.', 'info');
      return;
    }
    showBanner('Moved the video to ' + label + '.', 'info');
  }).catch(function (err) {
    showBanner(err && err.message ? err.message : 'Could not seek the video on this tab.', 'error');
  });
}

function onDelete(frame) {
  if (busyAction) return;
  busyAction = true;
  clearBanner();
  var next = frames.filter(function (item) { return item.id !== frame.id; });
  saveFrames(next).then(function (saved) {
    if (!saved.ok) {
      showBanner(saved.message, 'error');
      return;
    }
    frames = saved.frames;
    render();
  }).catch(function () {
    showBanner('Could not delete that snapshot.', 'error');
  }).then(function () {
    busyAction = false;
  });
}

function onGridClick(event) {
  var button = event.target.closest('button[data-action]');
  if (!button || busyAction) return;
  var frame = findFrame(button.dataset.id);
  if (!frame) return;
  var action = button.dataset.action;
  if (action === 'seek') {
    onSeek(frame);
    return;
  }
  if (action === 'download') {
    try {
      downloadFrame(frame);
    } catch (err) {
      showBanner('Could not download that snapshot.', 'error');
    }
    return;
  }
  if (action === 'copy') {
    busyAction = true;
    clearBanner();
    var pendingCopy;
    try {
      pendingCopy = copyFrame(frame);
    } catch (err) {
      busyAction = false;
      showBanner(err && err.message ? err.message : 'Could not copy the image.', 'error');
      return;
    }
    pendingCopy.then(function () {
      showBanner('Copied the frame to the clipboard.', 'info');
    }).catch(function (err) {
      showBanner(err && err.message ? err.message : 'Could not copy the image.', 'error');
    }).then(function () {
      busyAction = false;
    });
    return;
  }
  if (action === 'delete') onDelete(frame);
}

function extensionApisAvailable() {
  try {
    return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local && !!chrome.runtime;
  } catch (err) {
    return false;
  }
}

function init() {
  captureBtn.addEventListener('click', onCapture);
  workspaceTime.addEventListener('click', function () {
    var frame = findFrame(workspaceTime.dataset.id);
    if (frame) onSeek(frame);
  });
  historyGrid.addEventListener('click', onGridClick);

  if (!extensionApisAvailable()) {
    captureBtn.disabled = true;
    showBanner('Open FrameSnap from the Chrome toolbar. It runs inside the extension.', 'error');
    return;
  }

  loadFrames().then(function (loaded) {
    frames = loaded;
    render();
  }).catch(function () {
    showBanner('Could not read local snapshots.', 'error');
  });
}

init();
