// Workspace Module for Ready To Review
console.log("[Workspace Module] Loading...");
export const Workspace = (() => {
  console.log("[Workspace Module] Initializing...");

  const BASE_DOMAIN = "ready-to-review.dev";

  // Extract workspace from hostname
  const currentWorkspace = () => {
    const hostname = window.location.hostname;

    // Handle localhost - no workspace concept in development
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("localhost:") ||
      hostname.startsWith("127.0.0.1:")
    ) {
      return null;
    }

    const parts = hostname.split(".");

    // If subdomain exists and it's not a reserved one
    if (parts.length >= 3) {
      const subdomain = parts[0];
      if (["www", "dash", "api", "login", "auth-callback"].includes(subdomain)) {
        return null; // Base domain
      }
      return subdomain;
    }

    return null; // Base domain
  };

  // Get hidden orgs for current workspace
  // IMPORTANT: Hidden orgs list is per-workspace (each workspace has its own preferences)
  // This allows different filtering preferences for personal vs each org workspace
  const hiddenOrgs = () => {
    const workspace = currentWorkspace() || "personal";
    const cookieName = `hidden_orgs_${workspace}`;
    const cookieValue = getCookie(cookieName);

    if (!cookieValue) return [];

    try {
      return JSON.parse(cookieValue);
    } catch (e) {
      console.error("[Workspace] Failed to parse hidden_orgs cookie:", e);
      return [];
    }
  };

  // Set hidden orgs for current workspace
  // IMPORTANT: Each workspace maintains its own separate hidden orgs list
  // Domain cookies allow preferences to persist across page loads, but each
  // workspace (personal, org1, org2, etc.) has independent preferences
  const setHiddenOrgs = (orgs) => {
    const workspace = currentWorkspace() || "personal";
    const cookieName = `hidden_orgs_${workspace}`;
    const cookieValue = JSON.stringify(orgs);

    // Cookie size limit check (4KB is typical browser limit)
    // Allow some overhead for cookie name and attributes
    const maxCookieSize = 3800; // Conservative limit
    if (cookieValue.length > maxCookieSize) {
      console.error(
        "[Workspace] Hidden orgs list exceeds cookie size limit:",
        cookieValue.length,
        "bytes"
      );
      console.error("[Workspace] Maximum allowed:", maxCookieSize, "bytes");
      console.error("[Workspace] Consider reducing the number of hidden orgs");
      return;
    }

    // Set cookie with domain scope for 1 year (works across all subdomains)
    const expires = new Date();
    expires.setTime(expires.getTime() + 365 * 24 * 60 * 60 * 1000);
    const isSecure = window.location.protocol === "https:";
    const securePart = isSecure ? ";Secure" : "";
    document.cookie = `${cookieName}=${cookieValue};expires=${expires.toUTCString()};path=/;domain=.${BASE_DOMAIN};SameSite=Lax${securePart}`;
  };

  // Toggle org visibility
  const toggleOrgVisibility = (org) => {
    const hidden = hiddenOrgs();
    const index = hidden.indexOf(org);

    if (index === -1) {
      // Hide the org
      hidden.push(org);
    } else {
      // Show the org
      hidden.splice(index, 1);
    }

    setHiddenOrgs(hidden);
    return hidden;
  };

  // Check if org is hidden
  const isOrgHidden = (org) => {
    return hiddenOrgs().includes(org);
  };

  // Switch workspace (redirect to different subdomain, preserving current path)
  const switchWorkspace = (org) => {
    const protocol = window.location.protocol;
    const currentPath = window.location.pathname;
    const currentSearch = window.location.search;
    const currentHash = window.location.hash;

    let newHostname;
    if (org === "" || org === "Personal" || org === null) {
      // Personal workspace - no subdomain
      newHostname = BASE_DOMAIN;
    } else {
      // Org workspace - use org as subdomain
      newHostname = `${org}.${BASE_DOMAIN}`;
    }

    const newURL = `${protocol}//${newHostname}${currentPath}${currentSearch}${currentHash}`;
    window.location.href = newURL;
  };

  // Get username from cookie
  const username = () => {
    return getCookie("username");
  };

  // Cookie helper function
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

  console.log("[Workspace Module] Exporting functions...");
  const workspaceExports = {
    currentWorkspace,
    hiddenOrgs,
    setHiddenOrgs,
    toggleOrgVisibility,
    isOrgHidden,
    switchWorkspace,
    username,
  };
  console.log("[Workspace Module] Exports:", workspaceExports);
  return workspaceExports;
})();
console.log("[Workspace Module] Module loaded, Workspace object:", Workspace);
