'use strict';
// Open directly in the action's user gesture; do not await storage first.
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({windowId: tab.windowId}).catch(console.error);
  chrome.storage.session.set({target: {id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title}}).catch(console.error);
});
chrome.commands.onCommand.addListener(command => {
  if (command === 'capture-page') chrome.runtime.sendMessage({type: 'shortcut-capture'}).catch(() => {});
});
