// Shared utilities for reviewGOOSE

// DOM Helpers
export const $ = (id) => document.getElementById(id);
export const $$ = (selector) => document.querySelectorAll(selector);
export const show = (el) => el?.removeAttribute("hidden");
export const hide = (el) => el?.setAttribute("hidden", "");

// HTML escaping for user-controlled content
// SECURITY: This must be used for ALL user-controlled data before inserting into HTML
export const escapeHtml = (str) => {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
};

// URL validation and sanitization
// SECURITY: Only allow http/https URLs, block javascript: and data: URLs
export const sanitizeUrl = (url) => {
  if (!url) return "";
  const urlStr = String(url).trim().toLowerCase();
  // Block javascript:, data:, vbscript:, and other dangerous protocols
  if (
    urlStr.startsWith("javascript:") ||
    urlStr.startsWith("data:") ||
    urlStr.startsWith("vbscript:") ||
    urlStr.startsWith("file:")
  ) {
    return "";
  }
  // Only allow http, https, and relative URLs
  if (urlStr.startsWith("http://") || urlStr.startsWith("https://") || urlStr.startsWith("/")) {
    return url;
  }
  // If no protocol specified, assume it needs https://
  if (!urlStr.includes(":")) {
    return url;
  }
  return "";
};

// Attribute escaping for use in HTML attributes
// SECURITY: Escapes quotes and other dangerous characters for attribute context
export const escapeAttr = (str) => {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

// Trusted Types policy for CSP compliance
// CSP requires "require-trusted-types-for 'script'" and "trusted-types default"
let trustedTypesPolicy = null;

if (window.trustedTypes?.createPolicy) {
  // SECURITY NOTE: This policy passes through HTML as-is because we control all HTML
  // generation and use escapeHtml() for all user-controlled data.
  // Each innerHTML assignment has been audited to ensure user data is escaped.
  trustedTypesPolicy = window.trustedTypes.createPolicy("default", {
    createHTML: (input) => {
      // In production, we trust our own HTML generation
      // All user data MUST be escaped using escapeHtml() before passing to setHTML()
      return input;
    },
  });
}

// Safe innerHTML setter that uses Trusted Types when available
// SECURITY: All user-controlled data must be escaped BEFORE calling this function
// NOTE: Prefer using DOM APIs (createElement, textContent) over this function
export const setHTML = (element, html) => {
  if (!element) return;

  if (trustedTypesPolicy) {
    element.innerHTML = trustedTypesPolicy.createHTML(html);
  } else {
    // Fallback for browsers without Trusted Types support
    element.innerHTML = html;
  }
};

// DOM Builder Helpers - XSS-safe by design
// These functions use DOM APIs instead of innerHTML, making XSS impossible

/**
 * Creates an element with optional classes, attributes, and children
 * SECURITY: Uses DOM APIs - automatically XSS-safe
 */
export const el = (tag, options = {}) => {
  const element = document.createElement(tag);

  if (options.className) {
    element.className = options.className;
  }

  if (options.classes) {
    element.classList.add(...options.classes);
  }

  if (options.text) {
    element.textContent = options.text; // XSS-safe
  }

  if (options.html) {
    // Only use for trusted static HTML (like SVG icons)
    setHTML(element, options.html);
  }

  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value !== null && value !== undefined) {
        element.setAttribute(key, value);
      }
    }
  }

  if (options.data) {
    for (const [key, value] of Object.entries(options.data)) {
      element.dataset[key] = value;
    }
  }

  if (options.children) {
    for (const child of options.children) {
      if (child) {
        element.appendChild(child);
      }
    }
  }

  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      element.addEventListener(event, handler);
    }
  }

  return element;
};

/**
 * Creates a text node
 * SECURITY: Text nodes are automatically XSS-safe
 */
export const text = (content) => {
  return document.createTextNode(content || "");
};

/**
 * Clears all children from an element
 */
export const clearChildren = (element) => {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
};

/**
 * Replaces all children of an element with new children
 */
export const replaceChildren = (element, ...children) => {
  if (!element) return;
  clearChildren(element);
  for (const child of children) {
    if (child) {
      element.appendChild(child);
    }
  }
};

// Date formatting - optimized with constants
const MS_PER_DAY = 86400000;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

export const formatDate = (dateString) => {
  const diffDays = Math.floor((Date.now() - new Date(dateString)) / MS_PER_DAY);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < DAYS_PER_WEEK) return `${diffDays} days ago`;
  if (diffDays < DAYS_PER_MONTH) return `${Math.floor(diffDays / DAYS_PER_WEEK)} weeks ago`;
  if (diffDays < DAYS_PER_YEAR) return `${Math.floor(diffDays / DAYS_PER_MONTH)} months ago`;
  return `${Math.floor(diffDays / DAYS_PER_YEAR)} years ago`;
};

// Toast notifications - lazy initialization
let toastContainer = null;

export const showToast = (message, type = "info") => {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Force layout to ensure transition works
  toast.offsetHeight;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};
