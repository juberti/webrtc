/* Copyright (c) 2014 The Chromium Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file. */

// Saves options to chrome.storage
function save_options() {
  var multiroutes = document.getElementById('multiroutes').checked;
  var nonproxiedudp = document.getElementById('nonproxiedudp').checked;
  chrome.privacy.network.webRTCMultipleRoutesEnabled.set({'value': multiroutes});
  try {
    chrome.privacy.network.webRTCNonProxiedUdpEnabled.set({'value': nonproxiedudp});
  }
  catch(err) {
    document.getElementById('nonproxiedudp').checked = false;
    document.getElementById('nonproxiedudp').disabled = true;
  }
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restore_options() {
  chrome.privacy.network.webRTCMultipleRoutesEnabled.get({}, function(details) {
    console.log('multiple routes', details.value);
    document.getElementById('multiroutes').checked = details.value;
  });
  try { 
  chrome.privacy.network.webRTCNonProxiedUdpEnabled.get({}, function(details) {
      document.getElementById('nonproxiedudp').checked = details.value;
    });
   }
    catch(err){
      document.getElementById('nonproxiedudp').checked = false;
      document.getElementById('nonproxiedudp').disabled = true;
    }
}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('multiroutes').addEventListener('click', save_options);
document.getElementById('nonproxiedudp').addEventListener('click', save_options);

document.title = chrome.i18n.getMessage('netli_options');
var i18nElements = document.querySelectorAll('*[i18n-content]');
for (var i = 0; i < i18nElements.length; i++) {
  var elem = i18nElements[i];
  var msg = elem.getAttribute('i18n-content');
  elem.innerHTML = chrome.i18n.getMessage(msg);
}
