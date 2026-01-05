import { Auth } from "./auth.js";
import { Changelog } from "./changelog.js";
import { Leaderboard } from "./leaderboard.js";
import { Robots } from "./robots.js";
import { Stats } from "./stats.js";
import { User } from "./user.js";
// Ready To Review - Modern ES6+ Application
import { $, clearChildren, el, hide, show, showToast } from "./utils.js";
import { Workspace } from "./workspace.js";

const App = (() => {
  // State Management
  const state = {
    currentUser: null,
    viewingUser: null,
    accessToken: null, // Will be loaded async in init()
    organizations: [],
    pullRequests: {
      incoming: [],
      outgoing: [],
    },
    isDemoMode: false,
  };

  // Parse URL to get viewing context
  const parseURL = () => {
    let path = window.location.pathname;

    // Remove trailing slash to normalize paths
    path = path.replace(/\/$/, "");

    // Get org from subdomain (workspace)
    const workspace = Workspace.currentWorkspace();

    // Check for changelog page patterns: /changelog or /changelog/username
    if (path === "/changelog") {
      return {
        org: workspace,
        username: null,
        isChangelog: true,
      };
    }
    const changelogMatch = path.match(/^\/changelog\/([^/]+)$/);
    if (changelogMatch) {
      const [, username] = changelogMatch;
      return {
        org: workspace,
        username: username,
        isChangelog: true,
      };
    }

    // Check for leaderboard page: /leaderboard
    if (path === "/leaderboard") {
      return {
        org: workspace,
        username: state.currentUser?.login,
        isLeaderboard: true,
      };
    }

    // Check for robot page: /robots
    if (path === "/robots") {
      return {
        org: workspace,
        username: state.currentUser?.login,
        isSettings: true,
      };
    }

    // Check for stats page: /stats
    if (path === "/stats") {
      return {
        org: workspace,
        username: state.viewingUser?.login || state.currentUser?.login,
        isStats: true,
      };
    }

    // Check for notifications page: /notifications
    if (path === "/notifications") {
      return {
        org: workspace,
        username: state.currentUser?.login,
        isNotifications: true,
      };
    }

    // Check for user dashboard pattern: /u/username
    const userMatch = path.match(/^\/u\/([^/]+)$/);
    if (userMatch) {
      const [, username] = userMatch;
      return {
        org: workspace,
        username: username,
        isStats: false,
      };
    }

    return null;
  };

  // DOM Helpers are imported from utils.js

  // UI Functions - direct manipulation
  const showMainContent = () => {
    $("loginPrompt")?.setAttribute("hidden", "");
    $("prSections")?.removeAttribute("hidden");
  };

  const showMainContentWithLoading = () => {
    $("loginPrompt")?.setAttribute("hidden", "");
    $("prSections")?.removeAttribute("hidden");

    // Show loading screen immediately
    const loadingOverlay = $("prLoadingOverlay");
    const incomingSection = $("incomingPRs")?.parentElement;
    const outgoingSection = $("outgoingPRs")?.parentElement;

    if (loadingOverlay) {
      show(loadingOverlay);
      // Hide PR sections while loading
      if (incomingSection) hide(incomingSection);
      if (outgoingSection) hide(outgoingSection);
    }
  };

  const showLoginPrompt = () => {
    $("loginPrompt")?.removeAttribute("hidden");
    $("prSections")?.setAttribute("hidden", "");
    $("emptyState")?.setAttribute("hidden", "");
  };

  // Hamburger Menu Functions
  let hamburgersSetup = false;

  // Setup workspace selector in hamburger menu
  let workspaceSelectorSetup = false;
  const setupWorkspaceSelector = async () => {
    const workspaceSelect = $("workspaceSelect");
    if (!workspaceSelect) return;

    const currentWorkspace = Workspace.currentWorkspace();

    // Load user's organizations (cached for 1 hour)
    try {
      const orgs = await User.loadUserOrganizations(state, githubAPI);

      // Ensure current workspace is in the list even if user isn't a member
      const allOrgs = [...orgs];
      if (currentWorkspace && !allOrgs.includes(currentWorkspace)) {
        allOrgs.push(currentWorkspace);
        allOrgs.sort();
      }

      // Clear existing options - XSS-safe
      clearChildren(workspaceSelect);
      const defaultOption = el("option", { attrs: { value: "" }, text: "Personal" });
      workspaceSelect.appendChild(defaultOption);

      // Add org options - XSS-safe (textContent)
      allOrgs.forEach((org) => {
        const option = el("option", {
          attrs: { value: org },
          text: org, // XSS-safe
        });
        workspaceSelect.appendChild(option);
      });

      // Set current workspace as selected
      if (currentWorkspace) {
        workspaceSelect.value = currentWorkspace;
      } else {
        workspaceSelect.value = "";
      }

      // Handle workspace changes (only set up listener once)
      if (!workspaceSelectorSetup) {
        workspaceSelect.addEventListener("change", () => {
          const selectedOrg = workspaceSelect.value;
          Workspace.switchWorkspace(selectedOrg);
        });
        workspaceSelectorSetup = true;
      }
    } catch (error) {
      console.error("Failed to load organizations for workspace selector:", error);
    }
  };

  const updateHamburgerMenuLinks = () => {
    const dashboardLink = $("dashboardLink");
    const statsLink = $("statsLink");
    const settingsLink = $("settingsLink");
    const notificationsLink = $("notificationsLink");
    const changelogLink = $("changelogLink");
    const leaderboardLink = $("leaderboardLink");
    const urlContext = parseURL();
    const { username } = urlContext || {};

    const currentUser = state.currentUser || state.viewingUser;
    const defaultUsername = currentUser?.login || "";
    const targetUsername = username || defaultUsername;

    // All links use new format without org in path (org is in subdomain)
    if (dashboardLink && targetUsername) {
      dashboardLink.href = `/u/${targetUsername}`;
    }

    if (statsLink) {
      statsLink.href = "/stats";
    }

    if (settingsLink) {
      settingsLink.href = "/robots";
    }

    if (notificationsLink) {
      notificationsLink.href = "/notifications";
    }

    if (changelogLink) {
      // Always default to org-wide changelog
      changelogLink.href = "/changelog";
    }

    if (leaderboardLink) {
      leaderboardLink.href = "/leaderboard";
    }
  };

  const setupHamburgerMenu = () => {
    if (hamburgersSetup) return;

    const hamburgerBtn = $("hamburgerMenu");
    const slideMenu = $("slideMenu");
    const closeMenuBtn = $("closeMenu");
    const menuBackdrop = $("menuBackdrop");
    const dashboardLink = $("dashboardLink");
    const statsLink = $("statsLink");

    if (!hamburgerBtn || !slideMenu) return;

    const openMenu = () => {
      slideMenu.classList.add("open");
      menuBackdrop.classList.add("show");
      hamburgerBtn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
    };

    const closeMenu = () => {
      slideMenu.classList.remove("open");
      menuBackdrop.classList.remove("show");
      hamburgerBtn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    };

    hamburgerBtn.addEventListener("click", openMenu);
    closeMenuBtn?.addEventListener("click", closeMenu);
    menuBackdrop?.addEventListener("click", closeMenu);

    hamburgersSetup = true;

    // Setup workspace selector asynchronously after hamburger is ready
    setupWorkspaceSelector().catch((error) => {
      console.error("Failed to setup workspace selector:", error);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && slideMenu.classList.contains("open")) {
        closeMenu();
      }
    });

    // Set up initial links
    updateHamburgerMenuLinks();

    // Set active states based on current path
    const path = window.location.pathname;
    if (dashboardLink) {
      if (path === "/" || path.startsWith("/u/")) {
        dashboardLink.classList.add("active");
      }

      dashboardLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = dashboardLink.href;
      });
    }

    if (statsLink) {
      if (path.startsWith("/stats")) {
        statsLink.classList.add("active");
      }

      statsLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = statsLink.href;
      });
    }

    const notificationsLink = $("notificationsLink");
    if (notificationsLink) {
      if (path.startsWith("/notifications")) {
        notificationsLink.classList.add("active");
      }

      notificationsLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = notificationsLink.href;
      });
    }

    const changelogLink = $("changelogLink");
    if (changelogLink) {
      if (path.startsWith("/changelog")) {
        changelogLink.classList.add("active");
      }

      changelogLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = changelogLink.href;
      });
    }

    const leaderboardLink = $("leaderboardLink");
    if (leaderboardLink) {
      if (path.startsWith("/leaderboard")) {
        leaderboardLink.classList.add("active");
      }

      leaderboardLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = leaderboardLink.href;
      });
    }

    const settingsLink = $("settingsLink");
    if (settingsLink) {
      if (path.startsWith("/robots")) {
        settingsLink.classList.add("active");
      }

      settingsLink.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        window.location.href = settingsLink.href;
      });
    }
  };

  // Event handlers
  const handleOrgChange = () => {
    // Org change is now handled via workspace switching (subdomain change)
    // This function is deprecated but kept for compatibility
    console.warn("handleOrgChange called but org filtering is now done via workspace selector");
  };

  const handleSearch = () => {
    User.handleSearch();
  };

  const handleFilterChange = (filterId) => {
    const Workspace = window.Workspace || { currentWorkspace: () => null };
    const checkbox = $(filterId);
    if (!checkbox) return;

    // Save workspace-specific filter state
    const workspace = Workspace.currentWorkspace() || "personal";
    const cookieKey = `${filterId}_${workspace}`;

    setCookie(cookieKey, checkbox.checked, 365);
    User.updatePRSections(state);
  };

  const setCookie = (name, value, days) => {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    // Use domain cookie for cross-subdomain persistence
    const isSecure = window.location.protocol === "https:";
    const securePart = isSecure ? ";Secure" : "";
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;domain=.reviewGOOSE.dev;SameSite=Lax${securePart}`;
  };

  const handlePRAction = async (action, prId) => {
    await User.handlePRAction(action, prId, state, Auth.githubAPI, showToast);
  };

  const handleKeyboardShortcuts = (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const searchInput = $("searchInput");
      if (searchInput) searchInput.focus();
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      const searchInput = $("searchInput");
      if (searchInput) searchInput.focus();
    }
  };

  // Toast notifications are imported from utils.js

  // Auth related functions
  const initiateLogin = () => {
    showGitHubAppModal();
  };

  // Auth delegates - direct references
  const showGitHubAppModal = Auth.showGitHubAppModal;
  const closeGitHubAppModal = Auth.closeGitHubAppModal;
  const proceedWithOAuth = Auth.proceedWithOAuth;
  const initiatePATLogin = Auth.initiatePATLogin;
  const closePATModal = Auth.closePATModal;
  const submitPAT = Auth.submitPAT;
  const logout = Auth.logout;

  // Load current user
  const loadCurrentUser = async () => {
    state.currentUser = await Auth.loadCurrentUser();
    // Store username and login timestamp in cookies
    if (state.currentUser && state.currentUser.login) {
      // Only set if not already set (preserve original timestamp)
      const existingUsername = getCookie("username");
      if (!existingUsername) {
        const timestamp = Date.now().toString();
        setCookie("username", state.currentUser.login, 365);
        setCookie("login_ts", timestamp, 365);
      }
    }
  };

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

  // GitHub API wrapper that uses Auth module
  const githubAPI = async (endpoint, options = {}) => {
    try {
      const response = await Auth.githubAPI(endpoint, options);

      if (!response.ok) {
        if (response.status === 403) {
          const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
          const rateLimitReset = response.headers.get("X-RateLimit-Reset");

          if (rateLimitRemaining === "0") {
            const resetTime = new Date(Number.parseInt(rateLimitReset, 10) * 1000);
            const now = new Date();
            const minutesUntilReset = Math.ceil((resetTime - now) / 60000);

            const error = new Error(
              `GitHub API rate limit exceeded. Resets in ${minutesUntilReset} minutes.`
            );
            error.isRateLimit = true;
            error.resetTime = resetTime;
            error.minutesUntilReset = minutesUntilReset;
            throw error;
          }
        }

        let errorMessage = `API Error: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.message) {
            errorMessage = `GitHub error: ${errorData.message}`;
          } else if (
            errorData.errors &&
            Array.isArray(errorData.errors) &&
            errorData.errors.length > 0
          ) {
            const firstError = errorData.errors[0];
            if (firstError.message) {
              errorMessage = `GitHub error: ${firstError.message}`;
            }
          }
        } catch (_e) {
          // Use default message
        }

        throw new Error(errorMessage);
      }

      return response.json();
    } catch (error) {
      // Show toast notification for API errors
      if (error.isRateLimit) {
        showToast(`Rate limit exceeded. Try again in ${error.minutesUntilReset} minutes.`, "error");
      } else if (error.message.includes("secondary rate limit")) {
        showToast("GitHub API limit reached. Please wait a few minutes.", "error");
      } else if (!error.message.includes("401")) {
        // Don't show toast for auth errors as they're handled elsewhere
        showToast(error.message, "error");
      }
      throw error;
    }
  };

  // Demo Mode
  const initializeDemoMode = () => {
    // biome-ignore lint/correctness/noUndeclaredVariables: DEMO_DATA loaded as global from demo-data.js
    if (typeof DEMO_DATA === "undefined") {
      console.error("Demo data not loaded");
      return;
    }

    state.isDemoMode = true;
    // biome-ignore lint/correctness/noUndeclaredVariables: DEMO_DATA loaded as global from demo-data.js
    state.currentUser = DEMO_DATA.user;
    // biome-ignore lint/correctness/noUndeclaredVariables: DEMO_DATA loaded as global from demo-data.js
    state.viewingUser = DEMO_DATA.user;
    // biome-ignore lint/correctness/noUndeclaredVariables: DEMO_DATA loaded as global from demo-data.js
    state.pullRequests = DEMO_DATA.pullRequests;

    const allPRs = [...state.pullRequests.incoming, ...state.pullRequests.outgoing];

    allPRs.forEach((pr) => {
      pr.age_days = Math.floor((Date.now() - new Date(pr.created_at)) / 86400000);

      const labelNames = (pr.labels || []).map((l) => l.name);

      const unblockAction = {};
      if (labelNames.includes("blocked on you")) {
        unblockAction[state.currentUser.login] = {
          kind: "review",
          critical: true,
          reason: "Requested changes need to be addressed",
          ready_to_notify: true,
        };
      }

      const checks = {
        total: 5,
        passing: labelNames.includes("tests passing") ? 5 : 3,
        failing: labelNames.includes("tests failing") ? 2 : 0,
        pending: 0,
        waiting: 0,
        ignored: 0,
      };

      const sizeMap = {
        "size/XS": "XS",
        "size/S": "S",
        "size/M": "M",
        "size/L": "L",
        "size/XL": "XL",
      };
      let size = "M";
      for (const [label, sizeValue] of Object.entries(sizeMap)) {
        if (labelNames.includes(label)) {
          size = sizeValue;
          break;
        }
      }

      pr.turnData = {
        analysis: {
          next_action: unblockAction,
          last_activity: {
            kind: "comment",
            actor: pr.user.login,
            message: "Latest activity on this PR",
            timestamp: pr.updated_at,
          },
          checks: checks,
          unresolved_comments: labelNames.includes("unresolved comments") ? 3 : 0,
          size: size,
          ready_to_merge: labelNames.includes("ready") && !labelNames.includes("blocked on you"),
          merge_conflict: labelNames.includes("merge conflict"),
          approved: labelNames.includes("approved"),
          tags: [],
        },
        pull_request: {
          draft: pr.draft || false,
          updated_at: pr.updated_at,
        },
        timestamp: new Date().toISOString(),
        commit: "demo-version",
      };

      pr.prState = pr.turnData.analysis;
      pr.status_tags = User.getStatusTags(pr);
    });

    const urlContext = parseURL();
    if (!urlContext || !urlContext.username) {
      // biome-ignore lint/correctness/noUndeclaredVariables: DEMO_DATA loaded as global from demo-data.js
      window.location.href = `/u/${DEMO_DATA.user.login}?demo=true`;
      return;
    }

    User.updateUserDisplay(state, initiateLogin, logout);
    User.updateOrgFilter(state, parseURL, githubAPI);
    showMainContentWithLoading();

    // Simulate loading for demo mode
    setTimeout(() => {
      User.updatePRSections(state);
      const loadingOverlay = $("prLoadingOverlay");
      const incomingSection = $("incomingPRs")?.parentElement;
      const outgoingSection = $("outgoingPRs")?.parentElement;

      if (loadingOverlay) {
        hide(loadingOverlay);
        if (incomingSection) show(incomingSection);
        if (outgoingSection) show(outgoingSection);
      }
    }, 300);
  };

  // Footer Management
  const initializeFooter = () => {
    const footer = document.querySelector(".dashboard-footer");
    const closeBtn = document.getElementById("footerCloseBtn");

    // Check localStorage for footer state
    const footerHidden = localStorage.getItem("footerHidden") === "true";
    if (footerHidden && footer) {
      footer.classList.add("hidden");
    }

    // Add close button event listener
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        if (footer) {
          footer.classList.add("hidden");
          localStorage.setItem("footerHidden", "true");
        }
      });
    }
  };

  // Manage search input visibility based on current page
  const updateSearchInputVisibility = () => {
    const searchInput = $("searchInput");
    const path = window.location.pathname;

    // Show search input only on PR view and robot army pages
    if (
      path === "/" ||
      path.startsWith("/u/") ||
      path === "/robots" ||
      path.match(/^\/robots\/gh\/[^/]+$/)
    ) {
      show(searchInput);
    } else {
      hide(searchInput);
    }
  };

  // Initialize
  const init = async () => {
    // Load access token first (async now due to encryption)
    state.accessToken = await Auth.getStoredToken();

    const urlParams = new URLSearchParams(window.location.search);
    const demo = urlParams.get("demo");
    const urlContext = parseURL();

    // Hide demo button if visiting a custom workspace (not base domain)
    const workspace = Workspace.currentWorkspace();
    if (workspace) {
      const demoButton = document.getElementById("demoButton");
      if (demoButton) {
        demoButton.style.display = "none";
      }
    }

    // Initialize footer
    initializeFooter();

    // Handle stats page routing
    if (urlContext && urlContext.isStats) {
      updateSearchInputVisibility();
      await Stats.showStatsPage(
        state,
        githubAPI,
        loadCurrentUser,
        () => User.updateUserDisplay(state, initiateLogin, logout),
        setupHamburgerMenu,
        () => User.updateOrgFilter(state, parseURL, githubAPI),
        handleOrgChange,
        handleSearch,
        parseURL,
        User.loadUserOrganizations
      );
      return;
    }

    // Handle changelog page routing
    if (urlContext && urlContext.isChangelog) {
      updateSearchInputVisibility();
      const token = await Auth.getStoredToken();
      if (token) {
        try {
          await loadCurrentUser();
          User.updateUserDisplay(state, initiateLogin, logout);
          setupHamburgerMenu();
          await User.updateOrgFilter(state, parseURL, githubAPI);

          // No redirect - /changelog stays on org-wide view

          // Setup org dropdown handler
          const orgSelect = $("orgSelect");
          if (orgSelect) {
            orgSelect.addEventListener("change", handleOrgChange);
          }
        } catch (error) {
          console.error("Failed to load user for changelog:", error);
        }
      }
      await Changelog.showChangelogPage(state, githubAPI, parseURL);
      return;
    }

    // Handle leaderboard page routing
    if (urlContext && urlContext.isLeaderboard) {
      updateSearchInputVisibility();
      await Leaderboard.showLeaderboardPage(
        state,
        githubAPI,
        loadCurrentUser,
        () => User.updateUserDisplay(state, initiateLogin, logout),
        setupHamburgerMenu,
        () => User.updateOrgFilter(state, parseURL, githubAPI),
        handleOrgChange,
        handleSearch,
        parseURL,
        User.loadUserOrganizations
      );
      return;
    }
    // Handle notifications page routing
    const path = window.location.pathname;
    if (path === "/notifications" || path.match(/^\/notifications\/gh\/[^/]+$/)) {
      updateSearchInputVisibility();
      const token = await Auth.getStoredToken();
      if (token) {
        try {
          await loadCurrentUser();
          User.updateUserDisplay(state, initiateLogin, logout);
          setupHamburgerMenu();
        } catch (error) {
          console.error("Failed to load user for notifications:", error);
        }
      }
      await Robots.showNotificationsPage(state, parseURL, githubAPI, User.updateOrgFilter);
      return;
    }

    // Handle robots page routing
    if (path === "/robots" || path.match(/^\/robots\/gh\/[^/]+$/)) {
      updateSearchInputVisibility();
      const token = await Auth.getStoredToken();
      if (!token) {
        showToast("Please login to configure Robot Army", "error");
        window.location.href = "/";
        return;
      }

      if (!state.currentUser) {
        try {
          await loadCurrentUser();
        } catch (error) {
          console.error("Failed to load user:", error);
          showToast("Failed to load user data", "error");
          window.location.href = "/";
          return;
        }
      }

      User.updateUserDisplay(state, initiateLogin, logout);

      // Always update org filter to ensure dropdown is populated
      await User.updateOrgFilter(state, parseURL, githubAPI);

      await Robots.showSettingsPage(
        state,
        setupHamburgerMenu,
        githubAPI,
        User.loadUserOrganizations,
        parseURL
      );
      return;
    }

    // Setup event listeners
    const loginBtn = $("loginBtn");
    if (loginBtn) loginBtn.addEventListener("click", initiateLogin);

    setupHamburgerMenu();

    const urlRedirect = urlParams.get("redirect");
    const searchInput = $("searchInput");

    searchInput?.addEventListener("input", handleSearch);
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        searchInput.value = "";
        handleSearch();
        searchInput.blur();
      }
    });

    // Set up global stale filter
    const globalStaleFilter = $("globalFilterStale");
    globalStaleFilter?.addEventListener("change", () => handleFilterChange("globalFilterStale"));

    document.addEventListener("keydown", handleKeyboardShortcuts);
    document.addEventListener("click", async (e) => {
      if (!e.target.matches(".pr-action-btn")) return;

      e.preventDefault();
      const { action, prId } = e.target.dataset;
      await handlePRAction(action, prId);
    });

    // Modal event listeners
    const githubAppLoginBtn = $("githubAppLoginBtn");
    const patLoginBtn = $("patLoginBtn");
    const githubAppModalBackdrop = $("githubAppModalBackdrop");
    const closeGitHubAppModalBtn = $("closeGitHubAppModalBtn");
    const cancelGitHubAppBtn = $("cancelGitHubAppBtn");
    const proceedWithOAuthBtn = $("proceedWithOAuthBtn");
    const patModalBackdrop = $("patModalBackdrop");
    const closePATModalBtn = $("closePATModalBtn");
    const submitPATBtn = $("submitPATBtn");
    const yamlModalBackdrop = $("yamlModalBackdrop");
    const closeYAMLModalBtn = $("closeYAMLModalBtn");
    const copyYamlBtn = $("copyYaml");

    if (githubAppLoginBtn) githubAppLoginBtn.addEventListener("click", showGitHubAppModal);
    if (patLoginBtn) patLoginBtn.addEventListener("click", initiatePATLogin);
    if (githubAppModalBackdrop)
      githubAppModalBackdrop.addEventListener("click", closeGitHubAppModal);
    if (closeGitHubAppModalBtn)
      closeGitHubAppModalBtn.addEventListener("click", closeGitHubAppModal);
    if (cancelGitHubAppBtn) cancelGitHubAppBtn.addEventListener("click", closeGitHubAppModal);
    if (proceedWithOAuthBtn) proceedWithOAuthBtn.addEventListener("click", proceedWithOAuth);
    if (patModalBackdrop) patModalBackdrop.addEventListener("click", closePATModal);
    if (closePATModalBtn) closePATModalBtn.addEventListener("click", closePATModal);
    if (submitPATBtn) submitPATBtn.addEventListener("click", submitPAT);
    if (yamlModalBackdrop) yamlModalBackdrop.addEventListener("click", closeYAMLModal);
    if (closeYAMLModalBtn) closeYAMLModalBtn.addEventListener("click", closeYAMLModal);
    if (copyYamlBtn) copyYamlBtn.addEventListener("click", copyYAML);

    if ($("patInput")) {
      $("patInput").addEventListener("keypress", (e) => {
        if (e.key === "Enter") submitPAT();
      });
    }

    // Handle OAuth callback
    if (window.location.pathname === "/oauth/callback") {
      await Auth.handleOAuthCallback();
      return;
    }

    // Demo mode - only if explicitly requested
    if (demo === "true") {
      updateSearchInputVisibility();
      initializeDemoMode();
      return;
    }

    // Handle OAuth callback with auth code
    console.log("[App.init] Checking for OAuth auth code...");
    const authCodeExchanged = await Auth.handleAuthCodeCallback();

    // Re-check for authentication token (it might have been set after module load or auth code exchange)
    state.accessToken = await Auth.getStoredToken();
    console.log("[App.init] Checked for access token:", state.accessToken ? "found" : "not found");

    // If we just exchanged an auth code successfully, reload to start with fresh state
    if (authCodeExchanged) {
      console.log("[App.init] Auth code exchanged successfully, reloading page...");
      window.location.reload();
      return;
    }

    // Check for authentication
    if (!state.accessToken) {
      updateSearchInputVisibility();
      if (
        urlContext &&
        urlContext.username &&
        !urlContext.isStats &&
        !urlContext.isSettings &&
        !urlContext.isNotifications
      ) {
        // User trying to access a user dashboard without auth - require login
        try {
          // Skip API call if it's the demo user
          if (urlContext.username === "demo") {
            showLoginPrompt();
            return;
          }
          // Load the viewing user's basic info to show in UI
          state.viewingUser = await githubAPI(`/users/${urlContext.username}`);
          User.updateUserDisplay(state, initiateLogin, logout);
        } catch (error) {
          console.error("Failed to load user:", error);
          const errorMessage = error.message.includes("rate limit")
            ? "GitHub API rate limit exceeded. Please try again later or login for higher limits."
            : `Failed to load user ${urlContext.username}`;
          showToast(errorMessage, "error");
        }
        // Show login prompt - user must authenticate to view PRs
        showLoginPrompt();
        return;
      }
      // Default: show login prompt
      showLoginPrompt();
      return;
    }

    // Authenticated flow
    try {
      updateSearchInputVisibility();
      await loadCurrentUser();

      // Initialize workspace defaults after user is loaded
      Workspace.initializeDefaults();

      // If at root URL, redirect to user's page
      if (!urlContext && state.currentUser) {
        window.location.href = `/u/${state.currentUser.login}`;
        return;
      }

      if (urlContext && urlContext.username && urlContext.username !== state.currentUser.login) {
        try {
          state.viewingUser = await githubAPI(`/users/${urlContext.username}`);
        } catch (error) {
          console.error("Error loading viewing user:", error);
          const errorMessage = error.message || "Failed to load user";
          showToast(errorMessage, "error");
        }
      }

      User.updateUserDisplay(state, initiateLogin, logout);
      await User.updateOrgFilter(state, parseURL, githubAPI);

      // Only load PRs if we're on the PR dashboard page
      if (
        !urlContext ||
        (!urlContext.isStats && !urlContext.isSettings && !urlContext.isNotifications)
      ) {
        showMainContentWithLoading();
        await User.loadPullRequests(state, githubAPI, state.isDemoMode);
        // Update org filter again after PRs are loaded to include PR organizations
        await User.updateOrgFilter(state, parseURL, githubAPI);

        // Update workspace selector after all data is loaded
        await setupWorkspaceSelector().catch((error) => {
          console.error("Failed to update workspace selector after PR load:", error);
        });

        // Reset search input placeholder for PR view
        const searchInput = $("searchInput");
        if (searchInput) {
          searchInput.placeholder = "Search PRs...";
        }
      }

      showMainContent();

      if (urlRedirect) {
        window.history.replaceState({}, "", urlRedirect);
      }
    } catch (error) {
      console.error("Initialization error:", error);
      showToast("Failed to initialize. Please try again.", "error");
      showLoginPrompt();
    }
  };

  // YAML modal functions
  const closeYAMLModal = () => {
    Robots.closeYAMLModal();
  };

  const copyYAML = () => {
    Robots.copyYAML();
    try {
      showToast("Configuration copied to clipboard!", "success");
    } catch (_error) {
      showToast("Failed to copy to clipboard", "error");
    }
  };

  // Debug function to check modal state
  const debugModals = () => {
    const githubModal = document.getElementById("githubAppModal");
    const patModal = document.getElementById("patModal");

    return {
      github: {
        exists: !!githubModal,
        hidden: githubModal?.hasAttribute("hidden"),
        display: githubModal?.style.display,
        computedDisplay: githubModal ? window.getComputedStyle(githubModal).display : "N/A",
      },
      pat: {
        exists: !!patModal,
        hidden: patModal?.hasAttribute("hidden"),
        display: patModal?.style.display,
        computedDisplay: patModal ? window.getComputedStyle(patModal).display : "N/A",
      },
    };
  };

  // Public API
  return {
    state,
    init,
    logout,
    initiateLogin: () => (window.initiateLogin = initiateLogin),
    showGitHubAppModal,
    closeGitHubAppModal,
    proceedWithOAuth,
    initiatePATLogin,
    closePATModal,
    submitPAT,
    removeMapping: Robots.removeMapping,
    closeYAMLModal,
    copyYAML,
    debugModals, // Expose debug function
    updateHamburgerMenuLinks, // Expose for stats page
    handleOrgChange, // Expose for robots and notifications pages
  };
})();

// Expose global functions for onclick handlers immediately
window.App = App;

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", App.init);
} else {
  App.init();
}
