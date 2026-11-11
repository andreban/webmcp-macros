/** Service worker. Runs will be owned here so they survive page navigations. */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
