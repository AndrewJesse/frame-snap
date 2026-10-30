'use strict';

/**
 * Routes popup messages to the content script in the active tab.
 * Protected browser pages and messaging failures resolve to a structured
 * error so the service worker never throws uncaught.
 */

var CAPTURE_FRAME = 'CAPTURE_FRAME';
var SEEK_TO_TIME = 'SEEK_TO_TIME';

function safeSend(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch (err) {
    // The popup can close before a large frame finishes encoding.
  }
}

function fail(code, message) {
  return { ok: false, error: { code: code, message: message } };
}

function isProtectedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  var parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return true;
  }
  var protocol = parsed.protocol;
  if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'file:') {
    return true;
  }
  var host = parsed.hostname.toLowerCase();
  if (host === 'chromewebstore.google.com') return true;
  if (host === 'chrome.google.com' && parsed.pathname.indexOf('/webstore') === 0) return true;
  return false;
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

function queryTabs(filter) {
  return callChrome(function (done) {
    chrome.tabs.query(filter, done);
  }).then(function (tabs) {
    return tabs && tabs[0] ? tabs[0] : null;
  });
}

function queryActiveTab() {
  // Service workers have no window, so lastFocusedWindow is the reliable
  // way to reach the tab the user is looking at. Fall back if a browser
  // returns nothing for that filter.
  return queryTabs({ active: true, lastFocusedWindow: true }).then(function (tab) {
    if (tab) return tab;
    return queryTabs({ active: true, currentWindow: true });
  }).then(function (tab) {
    if (tab) return tab;
    return queryTabs({ active: true });
  });
}

function messageTab(tabId, payload) {
  return callChrome(function (done) {
    chrome.tabs.sendMessage(tabId, payload, done);
  });
}

function injectContentScript(tabId) {
  return callChrome(function (done) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }, done);
  });
}

function needsInjection(err) {
  var message = err && err.message ? String(err.message) : '';
  return /Receiving end does not exist|Could not establish connection|message port closed/i.test(message);
}

function forward(tabId, payload) {
  return messageTab(tabId, payload).catch(function (err) {
    if (!needsInjection(err)) throw err;
    return injectContentScript(tabId).then(function () {
      return messageTab(tabId, payload);
    });
  });
}

function route(message) {
  return queryActiveTab().then(function (tab) {
    if (!tab || typeof tab.id !== 'number') {
      return fail('NO_TAB', 'No active tab is available to capture from.');
    }
    // tab.url can be omitted when the browser has not exposed it yet. Try
    // messaging in that case; known restricted URLs still fail closed.
    if (typeof tab.url === 'string' && tab.url && isProtectedUrl(tab.url)) {
      return fail(
        'PROTECTED_PAGE',
        'FrameSnap cannot run on this page. Browser pages, the Chrome Web Store, and other extension pages are blocked. Open a normal video page and try again.'
      );
    }
    // Distinct types so a popup runtime.sendMessage is not also handled by the
    // content script. Only the service worker accepts CAPTURE_FRAME / SEEK_TO_TIME.
    var payload = message.type === SEEK_TO_TIME
      ? { type: 'FRAMESNAP_SEEK', time: message.time }
      : { type: 'FRAMESNAP_CAPTURE' };
    return forward(tab.id, payload).then(function (response) {
      if (!response || typeof response !== 'object') {
        return fail('CANNOT_MESSAGE', 'FrameSnap could not read a response from this page. Reload the tab and try again.');
      }
      return response;
    }).catch(function (err) {
      var detail = err && err.message ? String(err.message) : '';
      if (/cannot access|restricted|chrome:\/\/|extensions gallery/i.test(detail)) {
        return fail(
          'PROTECTED_PAGE',
          'FrameSnap cannot run on this page. Open a normal http or https video page and try again.'
        );
      }
      return fail(
        'CANNOT_MESSAGE',
        'FrameSnap could not reach this page. Reload the tab, then try again.'
      );
    });
  }).catch(function () {
    return fail('NO_TAB', 'Could not access the active tab.');
  });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  try {
    if (!message || typeof message !== 'object') return;
    if (message.type !== CAPTURE_FRAME && message.type !== SEEK_TO_TIME) return;
    // Extension pages (the action popup, or popup.html opened in a tab) may
    // call in. Content scripts also share the extension id, but their sender
    // URL is the web page, so they cannot drive capture or seek.
    var fromExtensionPage = sender && typeof sender.url === 'string' && sender.url.indexOf('chrome-extension://') === 0;
    if (!sender || sender.id !== chrome.runtime.id || !fromExtensionPage) {
      safeSend(sendResponse, fail('UNAUTHORIZED', 'Ignored an unexpected message.'));
      return;
    }
    route(message).then(
      function (result) { safeSend(sendResponse, result); },
      function () {
        safeSend(sendResponse, fail('INTERNAL', 'FrameSnap hit an unexpected error.'));
      }
    );
    return true;
  } catch (err) {
    safeSend(sendResponse, fail('INTERNAL', 'FrameSnap hit an unexpected error.'));
    return false;
  }
});
