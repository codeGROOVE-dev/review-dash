// Workspace module tests
// Run with: node --test assets/workspace.test.js

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

// Mock DOM environment
class MockDocument {
  constructor() {
    this.cookieStore = {};
  }

  get cookie() {
    return Object.entries(this.cookieStore)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  set cookie(cookieString) {
    const match = cookieString.match(/^([^=]+)=([^;]*)/);
    if (match) {
      const [, name, value] = match;
      this.cookieStore[name] = value;
    }
  }

  clearCookies() {
    this.cookieStore = {};
  }
}

class MockWindow {
  constructor(hostname) {
    this.location = {
      hostname,
      protocol: "https:",
    };
  }
}

// Setup global mocks
let mockDocument;
let mockWindow;

function setupMocks(hostname = "reviewGOOSE.dev") {
  mockDocument = new MockDocument();
  mockWindow = new MockWindow(hostname);
  global.document = mockDocument;
  global.window = mockWindow;
}

function cleanupMocks() {
  delete global.document;
  delete global.window;
}

// Create workspace module factory for testing
function createWorkspaceModule() {
  const BASE_DOMAIN = "reviewGOOSE.dev";

  const currentWorkspace = () => {
    const hostname = window.location.hostname;

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("localhost:") ||
      hostname.startsWith("127.0.0.1:")
    ) {
      return null;
    }

    const parts = hostname.split(".");

    if (parts.length >= 3) {
      const subdomain = parts[0];
      if (["www", "dash", "api", "login", "auth-callback"].includes(subdomain)) {
        return null;
      }
      return subdomain;
    }

    return null;
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

  const setHiddenOrgs = (orgs) => {
    const workspace = currentWorkspace() || "personal";
    const cookieName = `hidden_orgs_${workspace}`;
    const cookieValue = JSON.stringify(orgs);

    const maxCookieSize = 3800;
    if (cookieValue.length > maxCookieSize) {
      console.error(
        "[Workspace] Hidden orgs list exceeds cookie size limit:",
        cookieValue.length,
        "bytes"
      );
      return;
    }

    const expires = new Date();
    expires.setTime(expires.getTime() + 365 * 24 * 60 * 60 * 1000);
    const isSecure = window.location.protocol === "https:";
    const securePart = isSecure ? ";Secure" : "";
    document.cookie = `${cookieName}=${cookieValue};expires=${expires.toUTCString()};path=/;domain=.${BASE_DOMAIN};SameSite=Lax${securePart}`;
  };

  const toggleOrgVisibility = (org) => {
    const hidden = hiddenOrgs();
    const index = hidden.indexOf(org);

    if (index === -1) {
      hidden.push(org);
    } else {
      hidden.splice(index, 1);
    }

    setHiddenOrgs(hidden);
    return hidden;
  };

  const isOrgHidden = (org) => {
    return hiddenOrgs().includes(org);
  };

  const initializeDefaults = () => {
    const workspace = currentWorkspace();
    const username = getCookie("username");

    if (!workspace || !username) return;

    const cookieName = `hidden_orgs_${workspace}`;
    const existingCookie = getCookie(cookieName);

    if (existingCookie === null) {
      console.log(`[Workspace] Initializing defaults for org workspace: ${workspace}`);
      console.log(`[Workspace] Hiding personal account: ${username}`);
      setHiddenOrgs([username]);
    }
  };

  return {
    currentWorkspace,
    hiddenOrgs,
    setHiddenOrgs,
    toggleOrgVisibility,
    isOrgHidden,
    initializeDefaults,
  };
}

// Tests
describe("Workspace Module", () => {
  let Workspace;

  beforeEach(() => {
    setupMocks();
    Workspace = createWorkspaceModule();
  });

  afterEach(() => {
    cleanupMocks();
  });

  describe("currentWorkspace()", () => {
    it("should return null for base domain", () => {
      setupMocks("reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      assert.strictEqual(Workspace.currentWorkspace(), null);
    });

    it("should return null for www subdomain", () => {
      setupMocks("www.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      assert.strictEqual(Workspace.currentWorkspace(), null);
    });

    it("should return org name for org subdomain", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      assert.strictEqual(Workspace.currentWorkspace(), "myorg");
    });

    it("should return null for localhost", () => {
      setupMocks("localhost");
      Workspace = createWorkspaceModule();
      assert.strictEqual(Workspace.currentWorkspace(), null);
    });
  });

  describe("hiddenOrgs()", () => {
    it("should return empty array when no cookie exists", () => {
      assert.deepStrictEqual(Workspace.hiddenOrgs(), []);
    });

    it("should return orgs from cookie for personal workspace", () => {
      setupMocks("reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      document.cookie = 'hidden_orgs_personal=["testuser","testorg"]';
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser", "testorg"]);
    });

    it("should return orgs from cookie for org workspace", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      document.cookie = 'hidden_orgs_myorg=["testuser"]';
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser"]);
    });
  });

  describe("setHiddenOrgs()", () => {
    it("should set cookie for personal workspace", () => {
      setupMocks("reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      Workspace.setHiddenOrgs(["testuser"]);
      assert.ok(document.cookie.includes("hidden_orgs_personal"));
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser"]);
    });

    it("should set cookie for org workspace", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      Workspace.setHiddenOrgs(["testuser", "anotherorg"]);
      assert.ok(document.cookie.includes("hidden_orgs_myorg"));
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser", "anotherorg"]);
    });

    it("should handle empty array", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      Workspace.setHiddenOrgs([]);
      assert.deepStrictEqual(Workspace.hiddenOrgs(), []);
    });
  });

  describe("toggleOrgVisibility()", () => {
    it("should add org to hidden list when not present", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      const result = Workspace.toggleOrgVisibility("testuser");
      assert.deepStrictEqual(result, ["testuser"]);
      assert.ok(Workspace.isOrgHidden("testuser"));
    });

    it("should remove org from hidden list when present", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      Workspace.setHiddenOrgs(["testuser", "anotherorg"]);
      const result = Workspace.toggleOrgVisibility("testuser");
      assert.deepStrictEqual(result, ["anotherorg"]);
      assert.ok(!Workspace.isOrgHidden("testuser"));
    });

    it("should toggle multiple times correctly", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();

      Workspace.toggleOrgVisibility("testuser");
      assert.ok(Workspace.isOrgHidden("testuser"));

      Workspace.toggleOrgVisibility("testuser");
      assert.ok(!Workspace.isOrgHidden("testuser"));

      Workspace.toggleOrgVisibility("testuser");
      assert.ok(Workspace.isOrgHidden("testuser"));
    });
  });

  describe("initializeDefaults()", () => {
    it("should hide personal account in org workspace on first visit", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      document.cookie = "username=testuser";

      Workspace.initializeDefaults();

      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser"]);
      assert.ok(Workspace.isOrgHidden("testuser"));
    });

    it("should not set defaults if cookie already exists", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      document.cookie = "username=testuser";
      document.cookie = 'hidden_orgs_myorg=["someorg"]';

      Workspace.initializeDefaults();

      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["someorg"]);
    });

    it("should not set defaults in personal workspace", () => {
      setupMocks("reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      document.cookie = "username=testuser";

      Workspace.initializeDefaults();

      assert.deepStrictEqual(Workspace.hiddenOrgs(), []);
    });

    it("should not set defaults if username cookie missing", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();

      Workspace.initializeDefaults();

      assert.deepStrictEqual(Workspace.hiddenOrgs(), []);
    });

    it("should handle different org workspaces independently", () => {
      // All workspaces share the same cookie store (domain cookies)
      // but use different cookie names
      const sharedCookieStore = new MockDocument();

      // Setup org1 workspace
      setupMocks("org1.reviewGOOSE.dev");
      global.document = sharedCookieStore; // Use shared cookie store
      Workspace = createWorkspaceModule();
      sharedCookieStore.cookie = "username=testuser";
      Workspace.initializeDefaults();
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser"]);
      assert.ok(sharedCookieStore.cookie.includes("hidden_orgs_org1"));

      // Setup org2 workspace - uses same cookie store
      mockWindow = new MockWindow("org2.reviewGOOSE.dev");
      global.window = mockWindow;
      Workspace = createWorkspaceModule();
      Workspace.initializeDefaults();
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser"]);
      assert.ok(sharedCookieStore.cookie.includes("hidden_orgs_org2"));

      // Verify org1 still has its settings
      mockWindow = new MockWindow("org1.reviewGOOSE.dev");
      global.window = mockWindow;
      Workspace = createWorkspaceModule();
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser"]);

      // Toggle in org1 shouldn't affect org2
      Workspace.toggleOrgVisibility("testuser");
      assert.deepStrictEqual(Workspace.hiddenOrgs(), []);

      // Switch to org2 - should still have testuser hidden
      mockWindow = new MockWindow("org2.reviewGOOSE.dev");
      global.window = mockWindow;
      Workspace = createWorkspaceModule();
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser"]);
    });
  });

  describe("Integration: Full workflow", () => {
    it("should allow user to override defaults by toggling", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      document.cookie = "username=testuser";

      // Initialize defaults - personal account hidden
      Workspace.initializeDefaults();
      assert.ok(Workspace.isOrgHidden("testuser"));

      // User toggles to show personal account
      Workspace.toggleOrgVisibility("testuser");
      assert.ok(!Workspace.isOrgHidden("testuser"));

      // User hides an org
      Workspace.toggleOrgVisibility("someorg");
      assert.ok(Workspace.isOrgHidden("someorg"));
      assert.ok(!Workspace.isOrgHidden("testuser"));
    });

    it("should maintain preferences across reloads", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();
      document.cookie = "username=testuser";

      // First visit - defaults applied
      Workspace.initializeDefaults();
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["testuser"]);

      // User makes changes
      Workspace.toggleOrgVisibility("testuser"); // Show personal
      Workspace.toggleOrgVisibility("anotherorg"); // Hide org
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["anotherorg"]);

      // Simulate reload - reinitialize workspace module
      const WorkspaceReloaded = createWorkspaceModule();

      // Defaults should NOT override existing preferences
      WorkspaceReloaded.initializeDefaults();
      assert.deepStrictEqual(WorkspaceReloaded.hiddenOrgs(), ["anotherorg"]);
    });

    it("should handle repeated toggles correctly (idempotency test)", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();

      // Start with some orgs hidden
      Workspace.setHiddenOrgs(["org1", "org2", "org3"]);
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["org1", "org2", "org3"]);

      // Toggle org2 off (show it)
      Workspace.toggleOrgVisibility("org2");
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["org1", "org3"]);
      assert.ok(!Workspace.isOrgHidden("org2"));

      // Toggle org2 on again (hide it)
      Workspace.toggleOrgVisibility("org2");
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["org1", "org3", "org2"]);
      assert.ok(Workspace.isOrgHidden("org2"));

      // Toggle org2 off again
      Workspace.toggleOrgVisibility("org2");
      assert.deepStrictEqual(Workspace.hiddenOrgs(), ["org1", "org3"]);
      assert.ok(!Workspace.isOrgHidden("org2"));

      // Verify other orgs unchanged
      assert.ok(Workspace.isOrgHidden("org1"));
      assert.ok(Workspace.isOrgHidden("org3"));
    });

    it("should not duplicate orgs when toggled multiple times rapidly", () => {
      setupMocks("myorg.reviewGOOSE.dev");
      Workspace = createWorkspaceModule();

      // Simulate rapid clicking - toggle same org many times
      for (let i = 0; i < 10; i++) {
        Workspace.toggleOrgVisibility("testorg");
      }

      // After 10 toggles (even number), should be back to visible (not hidden)
      assert.ok(!Workspace.isOrgHidden("testorg"));
      // And should only appear once in hidden list (or not at all)
      const hidden = Workspace.hiddenOrgs();
      const count = hidden.filter((org) => org === "testorg").length;
      assert.strictEqual(count, 0, "testorg should not be in hidden list");

      // Toggle once more (odd number total = 11)
      Workspace.toggleOrgVisibility("testorg");
      assert.ok(Workspace.isOrgHidden("testorg"));
      const hiddenAgain = Workspace.hiddenOrgs();
      const countAgain = hiddenAgain.filter((org) => org === "testorg").length;
      assert.strictEqual(countAgain, 1, "testorg should appear exactly once in hidden list");
    });
  });
});
