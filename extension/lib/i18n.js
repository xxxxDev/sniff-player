/** Returns the text for a key in the browser's language. */
export function t(key, ...values) {
  return chrome.i18n.getMessage(key, values.map(String));
}

/** Fills in the static text of a page, marked with data-i18n attributes. */
export function localizePage() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  }
}
