'use strict';

/**
 * Captures one native-resolution frame from the page's chosen <video>.
 * Runs only when the popup asks. Does not restyle the page or touch the network.
 *
 * JPEG quality 0.92 (not PNG) keeps each snapshot small enough for
 * chrome.storage.local, whose default quota is about 10 MB for the whole
 * extension. Lossless PNG at videoWidth × videoHeight can exceed that quota
 * after a handful of frames. Encoding uses OffscreenCanvas.convertToBlob,
 * which is asynchronous, so a one-shot capture does not stall the page on a
 * synchronous toDataURL. The canvas is never attached to the document and is
 * not downscaled.
 *
 * Cross-origin video loaded without CORS taints the canvas. The browser then
 * refuses to export pixels (SecurityError). That is a web security boundary.
 */

var JPEG_QUALITY = 0.92;

if (!globalThis.__FRAMESNAP_INSTALLED__) {
  globalThis.__FRAMESNAP_INSTALLED__ = true;

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    try {
      if (!message || typeof message !== 'object') return;
      if (sender && sender.id && sender.id !== chrome.runtime.id) return;
      if (message.type === 'FRAMESNAP_CAPTURE') {
        captureFrame().then(
          function (result) { safeSend(sendResponse, result); },
          function () { safeSend(sendResponse, fail('CAPTURE_FAILED', 'Could not capture this frame.')); }
        );
        return true;
      }
      if (message.type === 'FRAMESNAP_SEEK') {
        safeSend(sendResponse, seekToTime(message.time));
        return false;
      }
    } catch (err) {
      safeSend(sendResponse, fail('CAPTURE_FAILED', 'FrameSnap could not complete that action.'));
    }
  });
}

function safeSend(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch (err) {
    // Popup closed or the message channel dropped.
  }
}

function fail(code, message) {
  return { ok: false, error: { code: code, message: message } };
}

function makeId() {
  try {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (err) {
    // Fall through to a local id.
  }
  return 'fs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
}

function platformHint() {
  var host = '';
  try {
    host = String(location.hostname || '').toLowerCase().replace(/^www\./, '');
  } catch (err) {
    return 'html5';
  }
  if (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com')
  ) {
    return 'youtube';
  }
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return 'vimeo';
  return 'html5';
}

function collectVideos(root, out) {
  if (!root || !root.querySelectorAll) return;
  var videos;
  try {
    videos = root.querySelectorAll('video');
  } catch (err) {
    return;
  }
  for (var i = 0; i < videos.length; i += 1) out.push(videos[i]);
  var all;
  try {
    all = root.querySelectorAll('*');
  } catch (err) {
    return;
  }
  for (var j = 0; j < all.length; j += 1) {
    if (all[j].shadowRoot) collectVideos(all[j].shadowRoot, out);
  }
}

function isPlaying(video) {
  try {
    return video.paused === false && video.ended === false && video.readyState >= 2;
  } catch (err) {
    return false;
  }
}

function isVisible(video) {
  try {
    var style = window.getComputedStyle(video);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
    if (Number.parseFloat(style.opacity) === 0) return false;
    var rect = video.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
  } catch (err) {
    return false;
  }
}

function visibleArea(video) {
  try {
    var rect = video.getBoundingClientRect();
    var vw = window.innerWidth || 0;
    var vh = window.innerHeight || 0;
    var left = Math.max(rect.left, 0);
    var top = Math.max(rect.top, 0);
    var right = Math.min(rect.right, vw);
    var bottom = Math.min(rect.bottom, vh);
    var w = Math.max(0, right - left);
    var h = Math.max(0, bottom - top);
    return w * h;
  } catch (err) {
    return 0;
  }
}

function hasFrameSize(video) {
  try {
    return (video.videoWidth || 0) > 0 && (video.videoHeight || 0) > 0;
  } catch (err) {
    return false;
  }
}

function nativePixels(video) {
  try {
    var w = video.videoWidth || 0;
    var h = video.videoHeight || 0;
    return w > 0 && h > 0 ? w * h : 0;
  } catch (err) {
    return 0;
  }
}

function largest(list) {
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < list.length; i += 1) {
    var video = list[i];
    var score = visibleArea(video);
    if (score <= 0) score = nativePixels(video);
    else score = score * 100000 + nativePixels(video);
    if (score > bestScore) {
      best = video;
      bestScore = score;
    }
  }
  return best;
}

function chooseVideo() {
  var videos = [];
  try {
    collectVideos(document, videos);
  } catch (err) {
    return null;
  }
  if (!videos.length) return null;
  var ready = [];
  for (var i = 0; i < videos.length; i += 1) {
    if (hasFrameSize(videos[i])) ready.push(videos[i]);
  }
  var pool = ready.length ? ready : videos;
  var playingVisible = [];
  var playing = [];
  var visible = [];
  for (var j = 0; j < pool.length; j += 1) {
    var video = pool[j];
    var playingNow = isPlaying(video);
    var onScreen = isVisible(video);
    if (playingNow && onScreen) playingVisible.push(video);
    if (playingNow) playing.push(video);
    if (onScreen) visible.push(video);
  }
  if (playingVisible.length) return largest(playingVisible);
  if (playing.length) return largest(playing);
  if (visible.length) return largest(visible);
  return largest(pool);
}

function isTaintError(err) {
  if (!err) return false;
  var name = err.name || '';
  var message = String(err.message || '');
  return name === 'SecurityError' || /taint|cross-origin|SecurityError|may not be loaded/i.test(message);
}

function blobToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    try {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('Could not read the captured frame.')); };
      reader.readAsDataURL(blob);
    } catch (err) {
      reject(err);
    }
  });
}

function snapshotWithElement(video, width, height) {
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return Promise.reject(new Error('Could not create a canvas.'));
  ctx.drawImage(video, 0, 0);
  return new Promise(function (resolve, reject) {
    try {
      canvas.toBlob(function (blob) {
        if (blob) {
          resolve(blob);
          return;
        }
        // A tainted canvas sometimes yields an empty blob instead of throwing.
        try {
          ctx.getImageData(0, 0, 1, 1);
        } catch (err) {
          reject(err);
          return;
        }
        reject(new Error('The browser returned an empty frame.'));
      }, 'image/jpeg', JPEG_QUALITY);
    } catch (err) {
      reject(err);
    }
  });
}

function snapshotVideo(video, width, height) {
  if (typeof OffscreenCanvas !== 'function') {
    return snapshotWithElement(video, width, height);
  }
  try {
    var canvas = new OffscreenCanvas(width, height);
    var ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return snapshotWithElement(video, width, height);
    ctx.drawImage(video, 0, 0);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY }).catch(function (err) {
      if (isTaintError(err)) throw err;
      return snapshotWithElement(video, width, height);
    });
  } catch (err) {
    if (isTaintError(err)) return Promise.reject(err);
    return snapshotWithElement(video, width, height);
  }
}

function pageTitle() {
  try {
    return String(document.title || '').slice(0, 200);
  } catch (err) {
    return '';
  }
}

function pageUrl() {
  try {
    return String(location.href || '').slice(0, 2000);
  } catch (err) {
    return '';
  }
}

function captureFrame() {
  var video;
  try {
    video = chooseVideo();
  } catch (err) {
    return Promise.resolve(fail('CAPTURE_FAILED', 'Could not look for a video on this page.'));
  }
  if (!video) {
    return Promise.resolve(fail('NO_VIDEO', 'No video found on this page.'));
  }
  var width = video.videoWidth || 0;
  var height = video.videoHeight || 0;
  if (width <= 0 || height <= 0) {
    return Promise.resolve(fail(
      'NOT_READY',
      'The video is not ready yet. Let it load or press play, then capture again.'
    ));
  }

  var currentTime = 0;
  var duration = null;
  try {
    currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    duration = Number.isFinite(video.duration) ? video.duration : null;
  } catch (err) {
    currentTime = 0;
    duration = null;
  }

  return snapshotVideo(video, width, height).then(function (blob) {
    if (!blob) return fail('CAPTURE_FAILED', 'The browser returned an empty frame.');
    return blobToDataUrl(blob).then(function (dataUrl) {
      if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/jpeg') !== 0) {
        return fail('CAPTURE_FAILED', 'Could not encode the frame as JPEG.');
      }
      return {
        ok: true,
        frame: {
          id: makeId(),
          dataUrl: dataUrl,
          currentTime: currentTime,
          duration: duration,
          title: pageTitle(),
          url: pageUrl(),
          platform: platformHint(),
          capturedAt: Date.now(),
          width: width,
          height: height
        }
      };
    });
  }).catch(function (err) {
    if (isTaintError(err)) {
      return fail(
        'TAINTED_CANVAS',
        'This frame cannot be read. The video is cross-origin and was loaded without CORS, so the browser blocks canvas access. That is a security boundary.'
      );
    }
    return fail('CAPTURE_FAILED', 'Could not capture this frame.');
  });
}

function seekToTime(time) {
  var t = Number(time);
  if (!Number.isFinite(t) || t < 0) {
    return fail('BAD_TIME', 'That timestamp is not valid.');
  }
  var video;
  try {
    video = chooseVideo();
  } catch (err) {
    return fail('SEEK_FAILED', 'Could not find a video to seek.');
  }
  if (!video) {
    return fail('NO_VIDEO', 'No video found on this page to seek.');
  }
  try {
    var target = t;
    if (Number.isFinite(video.duration) && video.duration >= 0) {
      target = Math.min(target, video.duration);
    }
    video.currentTime = target;
    return {
      ok: true,
      time: Number.isFinite(video.currentTime) ? video.currentTime : target,
      pageUrl: pageUrl()
    };
  } catch (err) {
    return fail('SEEK_FAILED', 'Could not seek this video.');
  }
}
