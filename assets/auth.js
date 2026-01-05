// Authentication Module for Ready To Review
console.log("[Auth Module] Loading...");

import { Crypto } from "./crypto.js";

// Log URL parameters on page load for debugging OAuth flow (without exposing secrets)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has("code") || urlParams.has("state") || urlParams.has("error")) {
  console.log("[Auth] OAuth callback detected!");
  console.log("[Auth] Code:", urlParams.has("code") ? "present" : "missing");
  console.log("[Auth] State:", urlParams.has("state") ? "present" : "missing");
  console.log("[Auth] Error:", urlParams.get("error")); // Error codes are not secret
  console.log("[Auth] Error description:", urlParams.get("error_description")); // GitHub's public error messages
}

export const Auth = (() => {
  console.log("[Auth Module] Initializing...");

  // Configuration
  const CONFIG = {
    CLIENT_ID: "Iv23liYmAKkBpvhHAnQQ",
    API_BASE: "https://api.github.com",
    COOKIE_KEY: "access_token", // Encrypted token in cookies
    OAUTH_REDIRECT_URI: "https://auth.reviewGOOSE.dev/oauth/callback",
  };

  // Cookie Functions
  function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);

    // SECURITY: Always require HTTPS for cookies containing sensitive data
    // Fail loudly on HTTP to catch development/deployment issues early
    if (window.location.protocol !== "https:") {
      console.error("[SECURITY] Cannot set cookie over insecure HTTP connection");
      console.error("[SECURITY] Cookie name:", name);
      console.error("[SECURITY] Current protocol:", window.location.protocol);
      throw new Error("Cookies can only be set over HTTPS for security");
    }

    // Use domain cookie to share across all subdomains of reviewGOOSE.dev
    // SameSite=Lax: Required for OAuth callback (cross-site navigation with state cookie)
    // Secure: Always set - enforced by protocol check above
    // HttpOnly: Cannot use - JavaScript needs to read/decrypt tokens
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;domain=.reviewGOOSE.dev;SameSite=Lax;Secure`;
  }

  function getCookie(name) {
    const nameEQ = `${name}=`;
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  function deleteCookie(name) {
    // Must match the domain used in setCookie to properly delete
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;domain=.reviewGOOSE.dev;`;
  }

  // Get encryption context (username, domain, and timestamp)
  const getEncryptionContext = () => {
    const username = getCookie("username");
    const timestamp = getCookie("login_ts");
    const domain = window.location.hostname.split(".").slice(-2).join("."); // Get base domain

    return { username, domain, timestamp };
  };

  const getStoredToken = async () => {
    const { username, domain, timestamp } = getEncryptionContext();

    const encryptedToken = getCookie(CONFIG.COOKIE_KEY);
    if (!encryptedToken || !username || !domain || !timestamp) {
      return null;
    }

    try {
      console.log("[Auth] Decrypting stored token");
      return await Crypto.decryptToken(encryptedToken, username, domain, timestamp);
    } catch (error) {
      console.error("[Auth] Failed to decrypt token, clearing invalid token:", error);
      deleteCookie(CONFIG.COOKIE_KEY);
      return null;
    }
  };

  const storeToken = async (token) => {
    const { username, domain, timestamp } = getEncryptionContext();

    if (!username || !domain || !timestamp) {
      throw new Error("Cannot encrypt token: username, domain, or timestamp missing");
    }

    console.log("[Auth] Encrypting token for storage");
    const encrypted = await Crypto.encryptToken(token, username, domain, timestamp);
    setCookie(CONFIG.COOKIE_KEY, encrypted, 10);
  };

  const clearToken = () => {
    deleteCookie(CONFIG.COOKIE_KEY);
  };

  const initiateOAuthLogin = () => {
    console.log("[Auth.initiateOAuthLogin] Starting OAuth flow...");
    console.log("[Auth.initiateOAuthLogin] Current URL:", window.location.href);
    console.log(
      "[Auth.initiateOAuthLogin] Redirecting to:",
      `${window.location.origin}/oauth/login`
    );

    // Simply redirect to the backend OAuth endpoint
    // The backend will handle state generation and cookie management
    window.location.href = "/oauth/login";
  };

  const showGitHubAppModal = () => {
    console.log("[Auth.showGitHubAppModal] Called");
    const modal = document.getElementById("githubAppModal");
    console.log("[Auth.showGitHubAppModal] Modal element:", modal);
    if (modal) {
      console.log(
        "[Auth.showGitHubAppModal] Modal hidden attribute:",
        modal.hasAttribute("hidden")
      );
      console.log(
        "[Auth.showGitHubAppModal] Modal current display style:",
        window.getComputedStyle(modal).display
      );

      // Remove hidden attribute if present
      if (modal.hasAttribute("hidden")) {
        console.log("[Auth.showGitHubAppModal] Removing hidden attribute");
        modal.removeAttribute("hidden");
      }

      console.log("[Auth.showGitHubAppModal] Setting modal display to block");
      modal.style.display = "block";
      console.log("[Auth.showGitHubAppModal] Modal display style after:", modal.style.display);
      console.log(
        "[Auth.showGitHubAppModal] Modal computed style after:",
        window.getComputedStyle(modal).display
      );
    } else {
      console.error("[Auth.showGitHubAppModal] Modal element not found!");
    }
  };

  const closeGitHubAppModal = () => {
    const modal = document.getElementById("githubAppModal");
    if (modal) modal.style.display = "none";
  };

  const proceedWithOAuth = () => {
    closeGitHubAppModal();
    initiateOAuthLogin();
  };

  const initiatePATLogin = () => {
    console.log("[Auth.initiatePATLogin] Called");
    const modal = document.getElementById("patModal");
    console.log("[Auth.initiatePATLogin] Modal element:", modal);
    if (modal) {
      console.log("[Auth.initiatePATLogin] Modal hidden attribute:", modal.hasAttribute("hidden"));
      console.log(
        "[Auth.initiatePATLogin] Modal current display style:",
        window.getComputedStyle(modal).display
      );

      // Remove hidden attribute if present
      if (modal.hasAttribute("hidden")) {
        console.log("[Auth.initiatePATLogin] Removing hidden attribute");
        modal.removeAttribute("hidden");
      }

      console.log("[Auth.initiatePATLogin] Setting modal display to block");
      modal.style.display = "block";
      console.log("[Auth.initiatePATLogin] Modal display style after:", modal.style.display);
      console.log(
        "[Auth.initiatePATLogin] Modal computed style after:",
        window.getComputedStyle(modal).display
      );
    } else {
      console.error("[Auth.initiatePATLogin] Modal element not found!");
    }
  };

  const closePATModal = () => {
    const modal = document.getElementById("patModal");
    if (modal) modal.style.display = "none";
    const input = document.getElementById("patInput");
    if (input) input.value = "";
  };

  const submitPAT = async () => {
    const input = document.getElementById("patInput");
    const errorDiv = document.getElementById("patError");

    if (!input || !input.value.trim()) {
      if (errorDiv) {
        errorDiv.textContent = "Please enter a Personal Access Token";
        errorDiv.style.display = "block";
      }
      return;
    }

    const token = input.value.trim();

    try {
      // Validate the token by making a test API call
      const response = await fetch(`${CONFIG.API_BASE}/user`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.ok) {
        await storeToken(token); // Store encrypted token in cookie
        closePATModal();
        window.location.reload();
      } else {
        if (errorDiv) {
          errorDiv.textContent = "Invalid token. Please check and try again.";
          errorDiv.style.display = "block";
        }
      }
    } catch (_error) {
      if (errorDiv) {
        errorDiv.textContent = "Error validating token. Please try again.";
        errorDiv.style.display = "block";
      }
    }
  };

  // Handle OAuth callback with auth code
  const handleAuthCodeCallback = async () => {
    // Auth code is in fragment (hash) not query parameter for security
    // Fragments are not sent to server in Referer headers
    const fragment = window.location.hash.substring(1); // Remove leading #
    const fragmentParams = new URLSearchParams(fragment);
    const authCode = fragmentParams.get("auth_code");

    if (!authCode) {
      return false; // No auth code, nothing to do
    }

    console.log("[Auth] Found auth_code in fragment, exchanging for token...");

    try {
      // Exchange auth code for token
      const response = await fetch("/oauth/exchange", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ auth_code: authCode }),
      });

      if (!response.ok) {
        console.error("[Auth] Failed to exchange auth code:", response.status);
        return false;
      }

      const data = await response.json();

      // Store username and login timestamp (milliseconds since 1970)
      const timestamp = Date.now().toString();
      setCookie("username", data.username, 365);
      setCookie("login_ts", timestamp, 365);

      // Store encrypted token
      await storeToken(data.token);

      console.log("[Auth] Successfully exchanged auth code for token, user:", data.username);

      // Remove auth_code from URL fragment
      const url = new URL(window.location);
      url.hash = ""; // Clear the fragment
      window.history.replaceState({}, "", url);

      return true;
    } catch (error) {
      console.error("[Auth] Error exchanging auth code:", error);
      return false;
    }
  };

  const handleAuthError = () => {
    clearToken();
    const currentUrl = window.location.pathname + window.location.search;
    window.location.href = `/?redirect=${encodeURIComponent(currentUrl)}`;
  };

  const logout = () => {
    clearToken();
    window.location.href = "/";
  };

  // API function with auth headers
  const githubAPI = async (endpoint, options = {}, retries = 5) => {
    const headers = {
      Accept: "application/vnd.github.v3+json",
      ...options.headers,
    };

    const token = await getStoredToken();
    if (token) {
      headers.Authorization = `token ${token}`;
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
          ...options,
          headers,
        });

        // Handle auth errors
        if (!response.ok && response.status === 401) {
          handleAuthError();
        }

        // Log error responses
        if (!response.ok) {
          console.warn(`GitHub REST API request failed: ${response.status} ${response.statusText}`);
          console.warn(`Endpoint: ${endpoint}`);
          console.warn("Response headers:", Object.fromEntries(response.headers.entries()));

          // Try to read response body if available (may fail due to CORS)
          if (response.status >= 500) {
            try {
              const responseClone = response.clone();
              const responseText = await responseClone.text();
              console.warn("Response body:", responseText);
            } catch (_e) {
              console.warn("Could not read response body due to CORS restrictions");
            }
          }

          // Retry on all 500+ server errors
          if (response.status >= 500 && attempt < retries) {
            const delay = Math.min(250 * 2 ** attempt, 10000); // Exponential backoff starting at 250ms, max 10s
            console.warn(
              `[githubAPI] Retry ${attempt + 1}/${retries} for ${CONFIG.API_BASE}${endpoint} - Status: ${response.status}, Delay: ${delay}ms`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }

        return response;
      } catch (error) {
        lastError = error;
        console.error("GitHub REST API network error:", error);

        // If it's a network error and we have retries left, try again
        if (attempt < retries) {
          const delay = Math.min(250 * 2 ** attempt, 10000);
          console.warn(
            `[githubAPI] Network error retry ${attempt + 1}/${retries} for ${CONFIG.API_BASE}${endpoint} - Error: ${error.message}, Delay: ${delay}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    console.error("GitHub REST API request failed after all retries:", lastError);
    throw lastError;
  };

  // GraphQL API function with retry logic
  const githubGraphQL = async (query, variables = {}, retries = 5) => {
    const token = await getStoredToken();
    if (!token) {
      throw new Error("No authentication token available");
    }

    // Determine token type and use appropriate header format
    let authHeader;
    if (token.startsWith("ghp_") || token.startsWith("github_pat_")) {
      // Personal Access Token (new format)
      authHeader = `Bearer ${token}`;
    } else if (token.startsWith("gho_") || token.startsWith("ghu_") || token.startsWith("ghs_")) {
      // OAuth token or other GitHub token types
      authHeader = `Bearer ${token}`;
    } else if (token.length === 40) {
      // Classic OAuth token (40 chars hex)
      authHeader = `Bearer ${token}`;
    } else {
      // Default to Bearer
      authHeader = `Bearer ${token}`;
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${CONFIG.API_BASE}/graphql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ query, variables }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            handleAuthError();
          }

          // Retry on all 500+ server errors
          if (response.status >= 500 && attempt < retries) {
            const delay = Math.min(250 * 2 ** attempt, 10000); // Exponential backoff starting at 250ms, max 10s

            // Log all available response information
            console.warn(
              `[githubGraphQL] Retry ${attempt + 1}/${retries} for ${CONFIG.API_BASE}/graphql - Status: ${response.status} ${response.statusText}, Delay: ${delay}ms`
            );
            console.warn("Response headers:", Object.fromEntries(response.headers.entries()));

            // Try to read response body if available (may fail due to CORS)
            try {
              const responseText = await response.text();
              console.warn("Response body:", responseText);
            } catch (_e) {
              console.warn("Could not read response body due to CORS restrictions");
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          // For other errors, log and throw
          console.error(`GraphQL request failed: ${response.status} ${response.statusText}`);
          console.error("Request details:", {
            query,
            variables,
            authHeader: `${authHeader.substring(0, 20)}...`,
          });
          throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (data.errors) {
          console.error("GraphQL errors:", data.errors);
          throw new Error(`GraphQL query failed: ${data.errors[0]?.message}`);
        }

        return data.data;
      } catch (error) {
        lastError = error;

        // If it's a network error and we have retries left, try again
        if (error.name === "TypeError" && error.message.includes("fetch") && attempt < retries) {
          const delay = Math.min(250 * 2 ** attempt, 10000);
          console.warn(
            `[githubGraphQL] Network error retry ${attempt + 1}/${retries} for ${CONFIG.API_BASE}/graphql - Error: ${error.message}, Delay: ${delay}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // For non-retryable errors, throw immediately
        throw error;
      }
    }

    console.error("GraphQL request failed after all retries:", lastError);
    throw lastError;
  };

  const loadCurrentUser = async () => {
    const response = await githubAPI("/user");
    if (response.ok) {
      return await response.json();
    }
    throw new Error("Failed to load user");
  };

  console.log("[Auth Module] Exporting functions...");
  const authExports = {
    getStoredToken,
    storeToken,
    clearToken,
    initiateOAuthLogin,
    handleAuthCodeCallback,
    showGitHubAppModal,
    closeGitHubAppModal,
    proceedWithOAuth,
    initiatePATLogin,
    closePATModal,
    submitPAT,
    handleAuthError,
    logout,
    githubAPI,
    githubGraphQL,
    loadCurrentUser,
    CONFIG,
  };
  console.log("[Auth Module] Exports:", authExports);
  return authExports;
})();
console.log("[Auth Module] Module loaded, Auth object:", Auth);
