// Robot Army Module for reviewGOOSE
import { $, hide, show } from "./utils.js";

export const Robots = (() => {
  const robotDefinitions = [
    {
      id: "autoassign",
      name: "AutoAssign 2000",
      icon: "🤖",
      description:
        "Finds the best people to review pull requests by looking at who recently worked on the same code. No more wondering who to ask for reviews!",
      config: {
        type: "select",
        label: "Number of reviewers to auto-assign",
        options: [
          { value: "1", label: "1 reviewer" },
          { value: "2", label: "2 reviewers" },
          { value: "3", label: "3 reviewers" },
          { value: "4", label: "4 reviewers" },
        ],
        default: "2",
      },
    },
    {
      id: "autoapprove",
      name: "AutoApprove 2001",
      icon: "✅",
      description:
        "Save engineering focus time by automatically approving trivial changes like minor dependency updates or typo fixes where all of the tests pass. Perfect for routine updates that don't need human review.",
      config: [
        {
          type: "checkboxes",
          label: "Automatically approve PRs from these trusted sources:",
          options: [
            {
              id: "dependabot",
              label: "Dependabot (automated dependency updates)",
              default: true,
            },
            { id: "owners", label: "Project owners", default: false },
            {
              id: "contributors",
              label: "Regular contributors",
              default: false,
            },
          ],
        },
        {
          type: "select",
          label: "Only if changes are smaller than:",
          options: [
            { value: "1", label: "1 line" },
            { value: "2", label: "2 lines" },
            { value: "3", label: "3 lines" },
            { value: "4", label: "4 lines" },
            { value: "5", label: "5 lines" },
            { value: "6", label: "6 lines" },
            { value: "7", label: "7 lines" },
            { value: "8", label: "8 lines" },
          ],
          default: "3",
        },
      ],
    },
    {
      id: "compliancebot",
      name: "ComplianceBot 3000",
      icon: "📋",
      description:
        "Helps meet compliance requirements by tracking when code gets merged without proper review. Essential for audits and security standards like SOC 2.",
      config: {
        type: "text",
        label: "Only monitor repositories tagged with this topic:",
        placeholder: "e.g., soc2-required",
      },
    },
    {
      id: "slackchan",
      name: "SlackChan 4000",
      icon: "📢",
      description:
        "Posts new pull requests to your team's Slack channels. Keep everyone in the loop without manual notifications.",
      config: [
        {
          type: "mappings",
          label: "Connect your GitHub repos to Slack channels:",
          placeholder1: "GitHub project (e.g., myorg/myrepo)",
          placeholder2: "Slack channel (e.g., #dev-reviews)",
        },
        {
          type: "checkbox",
          label: "Only notify after tests pass (reduces noise)",
          default: true,
        },
      ],
    },
    {
      id: "slackdm",
      name: "SlackDM 4001",
      icon: "💬",
      description:
        "Sends personal Slack messages when someone is assigned to review code. No more missed review requests!",
      config: [
        {
          type: "mappings",
          label: "Match GitHub users to their Slack accounts:",
          placeholder1: "GitHub username",
          placeholder2: "Slack user ID or @username",
        },
        {
          type: "checkbox",
          label: "Only notify after tests pass (reduces noise)",
          default: true,
        },
      ],
    },
    {
      id: "reassign",
      name: "ReAssign 5000",
      icon: "🔄",
      description:
        "Prevents reviews from getting stuck by finding new reviewers when the original ones haven't responded. Keeps pull requests moving forward.",
      config: {
        type: "select",
        label: "Find new reviewers after:",
        options: [
          { value: "3", label: "3 days of waiting" },
          { value: "5", label: "5 days of waiting" },
          { value: "7", label: "7 days of waiting" },
          { value: "10", label: "10 days of waiting" },
        ],
        default: "5",
      },
    },
    {
      id: "testbot",
      name: "TestBot 6000",
      icon: "🧪",
      description:
        "Helps developers fix failing tests by providing helpful suggestions and common solutions. Like having a senior engineer guide you through test failures.",
      config: {
        type: "toggle",
        label: "Enable TestBot assistance",
      },
    },
    {
      id: "autoclose",
      name: "AutoClose 9000",
      icon: "🗑️",
      description:
        "Keeps your repository clean by closing abandoned pull requests. Gives warning before closing so nothing important gets lost.",
      config: {
        type: "select",
        label: "Close inactive PRs after:",
        options: [
          { value: "60", label: "60 days of inactivity" },
          { value: "90", label: "90 days of inactivity" },
          { value: "120", label: "120 days of inactivity" },
        ],
        default: "90",
      },
    },
  ];

  let robotConfigs = {};
  let selectedOrg = null;

  // DOM helpers are imported from utils.js

  const showNotificationsPage = async (state, parseURL, githubAPI, updateOrgFilter) => {
    // Check for authentication first
    if (!state.accessToken) {
      const loginPrompt = $("loginPrompt");
      show(loginPrompt);
      hide($("prSections"));
      hide($("statsPage"));
      hide($("settingsPage"));
      hide($("notificationsPage"));
      return;
    }

    hide($("loginPrompt"));
    hide($("prSections"));
    hide($("statsPage"));
    hide($("settingsPage"));
    show($("notificationsPage"));

    document.title = "Notifications - reviewGOOSE";

    // Update org filter dropdown
    await updateOrgFilter(state, parseURL, githubAPI);

    // Update hamburger menu links to reflect URL org
    if (window.App?.updateHamburgerMenuLinks) {
      window.App.updateHamburgerMenuLinks();
    }

    // Set up organization dropdown event listener
    const orgSelect = $("orgSelect");
    if (orgSelect && !orgSelect.hasAttribute("data-listener")) {
      console.log("[DEBUG] Setting up orgSelect listener for notifications page");
      const handleOrgChange = window.App?.handleOrgChange;
      if (handleOrgChange) {
        orgSelect.addEventListener("change", handleOrgChange);
        orgSelect.setAttribute("data-listener", "true");
      } else {
        console.error("[DEBUG] handleOrgChange not found on window.App");
      }
    } else {
      console.log("[DEBUG] orgSelect listener already exists or element not found", {
        orgSelectExists: !!orgSelect,
        hasListener: orgSelect?.hasAttribute("data-listener"),
      });
    }

    // Add click handler for "Configure in Robot Army" button
    const goToRobotArmyBtn = $("goToRobotArmy");
    if (goToRobotArmyBtn) {
      goToRobotArmyBtn.onclick = () => {
        const urlContext = parseURL();
        const org = urlContext?.org || orgSelect?.value;
        if (org && org !== "*") {
          window.location.href = `https://${org}.reviewGOOSE.dev/robots`;
        } else {
          window.location.href = `/robots`;
        }
      };
    }

    // Update Slack configuration link based on workspace
    const updateSlackConfigLink = () => {
      try {
        const slackConfigLink = $("slackConfigLink");
        const slackConfigText = $("slackConfigText");
        if (!slackConfigLink || !slackConfigText) {
          console.log("[Slack Config] Link elements not found");
          return;
        }

        const urlContext = parseURL();
        const workspace = urlContext?.org || orgSelect?.value;

        // Use example config by default
        let configUrl = "https://github.com/codeGROOVE-dev/.codeGROOVE/blob/main/slack.yaml";
        let configText = "Configuration Example";

        // If we have a valid workspace, use workspace-specific config
        if (workspace && workspace !== "" && workspace !== "*") {
          const sanitized = String(workspace).trim();
          // SECURITY: GitHub usernames are alphanumeric + hyphens, 1-39 chars, no leading/trailing hyphens
          const isValid = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(sanitized);
          if (isValid) {
            configUrl = `https://github.com/${encodeURIComponent(sanitized)}/.codeGROOVE/blob/main/slack.yaml`;
            configText = `${sanitized} Configuration`;
            console.log("[Slack Config] Using workspace:", sanitized);
          } else {
            console.warn("[Slack Config] Invalid workspace name:", sanitized);
          }
        }

        slackConfigLink.href = configUrl;
        slackConfigText.textContent = configText;
      } catch (error) {
        console.error("[Slack Config] Error:", error);
      }
    };

    // Update on initial load
    updateSlackConfigLink();

    // Update when workspace changes - avoid duplicate listeners
    if (orgSelect) {
      const workspaceSelect = document.getElementById("workspaceSelect");
      if (workspaceSelect && !workspaceSelect.hasAttribute("data-slack-listener")) {
        workspaceSelect.addEventListener("change", updateSlackConfigLink);
        workspaceSelect.setAttribute("data-slack-listener", "true");
        console.log("[Slack Config] Workspace change listener attached");
      }
    }
  };

  const showSettingsPage = async (
    state,
    setupHamburgerMenu,
    _githubAPI,
    _loadUserOrganizations,
    parseURL
  ) => {
    console.log("[showSettingsPage] Starting with path:", window.location.pathname);
    try {
      // Check for authentication first
      if (!state.accessToken) {
        const loginPrompt = $("loginPrompt");
        show(loginPrompt);
        hide($("prSections"));
        hide($("statsPage"));
        hide($("notificationsPage"));
        hide($("settingsPage"));
        return;
      }

      hide($("loginPrompt"));
      hide($("prSections"));
      hide($("statsPage"));
      hide($("notificationsPage"));

      const settingsPage = $("settingsPage");
      console.log("[showSettingsPage] Settings page element found:", !!settingsPage);
      show(settingsPage);

      const settingsContent = settingsPage?.querySelector(".settings-content");
      if (settingsContent) {
        console.log("[showSettingsPage] settings-content element:", settingsContent);
        show(settingsContent);
      }

      setupHamburgerMenu();

      const urlContext = parseURL();
      if (!urlContext || !urlContext.isSettings) {
        console.error("[showSettingsPage] Invalid robots URL");
        return;
      }

      let org = urlContext.org;
      console.log("[showSettingsPage] Parsed org from URL:", org || "no org");

      // Update hamburger menu links to reflect URL org
      if (window.App?.updateHamburgerMenuLinks) {
        window.App.updateHamburgerMenuLinks();
      }

      // Set up organization dropdown event listener
      const orgSelect = $("orgSelect");
      if (orgSelect && !orgSelect.hasAttribute("data-listener")) {
        console.log("[DEBUG] Setting up orgSelect listener for robots page");
        const handleOrgChange = window.App?.handleOrgChange;
        if (handleOrgChange) {
          orgSelect.addEventListener("change", handleOrgChange);
          orgSelect.setAttribute("data-listener", "true");
        } else {
          console.error("[DEBUG] handleOrgChange not found on window.App");
        }
      } else {
        console.log("[DEBUG] orgSelect listener already exists or element not found", {
          orgSelectExists: !!orgSelect,
          hasListener: orgSelect?.hasAttribute("data-listener"),
        });
      }

      const robotConfig = $("robotConfig");

      console.log("[showSettingsPage] Elements found:", {
        robotConfig: !!robotConfig,
        robotConfigInitiallyHidden: robotConfig?.hasAttribute("hidden"),
      });

      // Check if we're at /robots (no org) or /robots/gh/org
      if (!org) {
        // No org specified - use current user's personal repos
        const personalUsername = urlContext?.username || state.currentUser?.login;
        if (!personalUsername) {
          document.title = "Login Required - Robot Army";
          const settingsTitle = settingsPage?.querySelector(".settings-title");
          const settingsSubtitle = settingsPage?.querySelector(".settings-subtitle");
          if (settingsTitle) {
            settingsTitle.textContent = `🤖 Robot Army Configuration`;
          }
          if (settingsSubtitle) {
            settingsSubtitle.textContent = `Please login to configure automated helpers`;
          }
          if (robotConfig) {
            hide(robotConfig);
          }
          return;
        }

        // Continue with personal username - treat user's repos like an org
        org = personalUsername;
        console.log("[showSettingsPage] Using personal repos for:", org);
      }

      // We have an org (or username for personal repos) selected
      selectedOrg = org;

      document.title = `${org}'s Robot Army`;
      const settingsTitle = settingsPage?.querySelector(".settings-title");
      const settingsSubtitle = settingsPage?.querySelector(".settings-subtitle");
      if (settingsTitle) {
        settingsTitle.textContent = `🤖 ${org}'s Robot Army`;
        console.log("[showSettingsPage] Updated h1 title to:", settingsTitle.textContent);
      }
      if (settingsSubtitle) {
        settingsSubtitle.textContent = `Configure automated helpers to handle repetitive GitHub tasks`;
      }

      // Show robot config
      if (robotConfig) {
        console.log("[showSettingsPage] Showing robot config");
        show(robotConfig);
      }

      const settingsContentDiv = settingsPage?.querySelector(".settings-content");
      if (settingsContentDiv?.hasAttribute("hidden")) {
        console.log("[showSettingsPage] Removing hidden from settings-content");
        settingsContentDiv.removeAttribute("hidden");
      }

      console.log("[showSettingsPage] Current robotConfigs:", Object.keys(robotConfigs));
      if (Object.keys(robotConfigs).length === 0) {
        console.log("[showSettingsPage] Initializing robot configs with defaults");
        robotDefinitions.forEach((robot) => {
          robotConfigs[robot.id] = {
            enabled: false,
            config: {},
          };
        });
        console.log(
          "[showSettingsPage] Initialized configs for",
          robotDefinitions.length,
          "robots"
        );
      }

      const yamlPath = `${selectedOrg}/.github/.github/codegroove.yaml`;
      console.log("[showSettingsPage] Updating YAML path to:", yamlPath);
      const yamlPathEl = $("yamlPath");
      const yamlPathModalEl = $("yamlPathModal");
      if (yamlPathEl) yamlPathEl.textContent = yamlPath;
      if (yamlPathModalEl) yamlPathModalEl.textContent = yamlPath;

      console.log("[showSettingsPage] Calling renderRobotCards...");
      renderRobotCards();

      // Set up search functionality for robots
      const searchInput = $("searchInput");
      if (searchInput) {
        // Remove any existing listeners first
        const newSearchInput = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearchInput, searchInput);

        // Add new listener for robot filtering
        newSearchInput.addEventListener("input", (e) => {
          const searchTerm = e.target.value;
          renderRobotCards(searchTerm);
        });

        // Update placeholder text for robot page
        newSearchInput.placeholder = "Search robots...";
      }

      console.log("[showSettingsPage] Completed setup");
      console.log("[showSettingsPage] Completed successfully");
    } catch (error) {
      console.error("[showSettingsPage] Error:", error);
      console.error("[showSettingsPage] Stack trace:", error.stack);
    }
  };

  const _loadOrganizationsForSettings = async (state, githubAPI, loadUserOrganizations) => {
    const orgSelect = $("orgSelectSettings");
    if (!orgSelect) return;

    try {
      const user = state.currentUser || state.viewingUser;
      if (!user) {
        orgSelect.innerHTML = '<option value="">Please login to view organizations</option>';
        return;
      }

      // Use the shared organization loading function
      const orgs = await loadUserOrganizations(state, githubAPI);

      if (orgs.length === 0) {
        orgSelect.innerHTML = '<option value="">No organizations found</option>';
        return;
      }

      orgSelect.innerHTML = '<option value="">Select an organization</option>';
      orgs.forEach((org) => {
        const option = document.createElement("option");
        option.value = org;
        option.textContent = org;
        orgSelect.appendChild(option);
      });

      orgSelect.addEventListener("change", onOrgSelected);
    } catch (error) {
      console.error("Failed to load organizations:", error);
      orgSelect.innerHTML = '<option value="">Failed to load organizations</option>';
    }
  };

  const onOrgSelected = (e) => {
    selectedOrg = e.target.value;
    if (!selectedOrg || selectedOrg === "*") {
      window.location.href = `/robots`;
    } else {
      window.location.href = `https://${selectedOrg}.reviewGOOSE.dev/robots`;
    }
  };

  const renderRobotCards = (searchTerm = "") => {
    console.log("[renderRobotCards] Starting...");
    const container = $("robotCards");
    if (!container) {
      console.error("[renderRobotCards] ERROR: robotCards container not found");
      return;
    }

    // Filter robots based on search term
    const filteredRobots = searchTerm
      ? robotDefinitions.filter(
          (robot) =>
            robot.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            robot.description.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : robotDefinitions;

    console.log("[renderRobotCards] Found container, rendering", filteredRobots.length, "robots");

    try {
      console.log("[renderRobotCards] Creating robot cards HTML...");
      const cardsHtml = filteredRobots
        .map((robot) => {
          console.log("[renderRobotCards] Creating card for robot:", robot.id);
          return createRobotCard(robot);
        })
        .join("");

      console.log("[renderRobotCards] Setting container innerHTML, length:", cardsHtml.length);
      container.innerHTML = cardsHtml;

      console.log("[renderRobotCards] Adding event listeners...");
      filteredRobots.forEach((robot) => {
        const toggle = $(`toggle-${robot.id}`);
        if (toggle) {
          toggle.addEventListener("change", (e) => {
            onRobotToggle(robot.id, e.target.checked);
          });
        }

        const previewBtn = $(`preview-${robot.id}`);
        if (previewBtn) {
          previewBtn.addEventListener("click", () => showRobotPreview(robot));
        }

        if (robot.id === "slackchan" || robot.id === "slackdm") {
          const addBtn = $(`add-mapping-${robot.id}`);
          if (addBtn) {
            addBtn.addEventListener("click", (e) => {
              e.preventDefault();
              addMapping(robot.id);
            });
          }
        }
      });

      const exportBtn = $("exportConfig");
      if (exportBtn) {
        exportBtn.addEventListener("click", exportConfiguration);
      }
    } catch (error) {
      console.error("Error in renderRobotCards:", error);
    }
  };

  const createRobotCard = (robot) => {
    console.log(`[createRobotCard] Creating card for robot: ${robot.id}`);
    const isEnabled = robotConfigs[robot.id]?.enabled || false;
    console.log(`[createRobotCard] Robot ${robot.id} enabled:`, isEnabled);

    const configHtml = renderRobotConfig(robot);
    console.log(`[createRobotCard] Config HTML length for ${robot.id}:`, configHtml.length);

    return `
      <div class="robot-card ${isEnabled ? "robot-enabled" : ""}">
        <div class="robot-header">
          <div class="robot-main">
            <div class="robot-icon">${robot.icon}</div>
            <div class="robot-info">
              <div class="robot-title-row">
                <h3 class="robot-name">${robot.name}</h3>
                <label class="toggle-switch">
                  <input type="checkbox" id="toggle-${robot.id}" ${isEnabled ? "checked" : ""}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <p class="robot-description">${robot.description}</p>
            </div>
          </div>
        </div>

        <div class="robot-content">
          <div class="robot-config ${isEnabled ? "" : "robot-config-disabled"}">
            ${configHtml}
          </div>
          <div class="robot-actions">
            <button id="preview-${robot.id}" class="btn-preview" title="Dry-run mode: See what actions this bot would take if enabled">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              Preview Actions
            </button>
          </div>
        </div>
      </div>
    `;
  };

  const renderRobotConfig = (robot) => {
    if (!robot.config) return "";

    const configs = Array.isArray(robot.config) ? robot.config : [robot.config];

    return configs
      .map((config) => {
        switch (config.type) {
          case "select":
            return `
            <div class="robot-option">
              <label>${config.label}</label>
              <select id="config-${robot.id}-select">
                ${config.options
                  .map(
                    (opt) =>
                      `<option value="${opt.value}" ${opt.value === config.default ? "selected" : ""}>${opt.label}</option>`
                  )
                  .join("")}
              </select>
            </div>
          `;

          case "checkboxes":
            return `
            <div class="robot-option">
              <label>${config.label}</label>
              <div class="robot-checkbox-group">
                ${config.options
                  .map(
                    (opt) => `
                  <div class="robot-checkbox">
                    <input type="checkbox" id="config-${robot.id}-${opt.id}" ${opt.default ? "checked" : ""}>
                    <label for="config-${robot.id}-${opt.id}">${opt.label}</label>
                  </div>
                `
                  )
                  .join("")}
              </div>
            </div>
          `;

          case "checkbox":
            return `
            <div class="robot-option">
              <div class="robot-checkbox">
                <input type="checkbox" id="config-${robot.id}-checkbox" ${config.default ? "checked" : ""}>
                <label for="config-${robot.id}-checkbox">${config.label}</label>
              </div>
            </div>
          `;

          case "text":
            return `
            <div class="robot-option">
              <label>${config.label}</label>
              <input type="text" id="config-${robot.id}-text" placeholder="${config.placeholder || ""}">
            </div>
          `;

          case "mappings":
            return `
            <div class="robot-option">
              <label>${config.label}</label>
              <div id="mappings-${robot.id}" class="robot-mappings">
                <!-- Mappings will be added here -->
              </div>
              <a href="#" id="add-mapping-${robot.id}" class="add-mapping">
                Add mapping
              </a>
            </div>
          `;

          case "toggle":
            return "";

          default:
            return "";
        }
      })
      .join("");
  };

  const onRobotToggle = (robotId, enabled) => {
    console.log(`[onRobotToggle] Robot ${robotId} toggled to:`, enabled);

    if (!robotConfigs[robotId]) {
      robotConfigs[robotId] = {};
    }
    robotConfigs[robotId].enabled = enabled;
    console.log(`[onRobotToggle] Updated config for ${robotId}:`, robotConfigs[robotId]);

    const card = document.querySelector(`#toggle-${robotId}`).closest(".robot-card");
    const config = card.querySelector(".robot-config");

    if (enabled) {
      card.classList.add("robot-enabled");
      config.classList.remove("robot-config-disabled");
    } else {
      card.classList.remove("robot-enabled");
      config.classList.add("robot-config-disabled");
    }
  };

  const addMapping = (robotId) => {
    const container = $(`mappings-${robotId}`);
    if (!container) return;

    const mappingId = `mapping-${robotId}-${Date.now()}`;
    const robot = robotDefinitions.find((r) => r.id === robotId);
    const config = Array.isArray(robot.config)
      ? robot.config.find((c) => c.type === "mappings")
      : null;

    if (!config) return;

    const mappingDiv = document.createElement("div");
    mappingDiv.className = "robot-mapping";
    mappingDiv.id = mappingId;

    const input1 = document.createElement("input");
    input1.type = "text";
    input1.placeholder = config.placeholder1;

    const input2 = document.createElement("input");
    input2.type = "text";
    input2.placeholder = config.placeholder2;

    const button = document.createElement("button");
    button.setAttribute("aria-label", "Remove mapping");
    button.addEventListener("click", () => removeMapping(mappingId));

    mappingDiv.appendChild(input1);
    mappingDiv.appendChild(input2);
    mappingDiv.appendChild(button);

    container.appendChild(mappingDiv);
  };

  const removeMapping = (mappingId) => {
    const mapping = $(mappingId);
    if (mapping) mapping.remove();
  };

  const showRobotPreview = (robot) => {
    const previewSteps = generatePreviewSteps(robot);
    const message = `
${robot.name} Preview:

${previewSteps.join("\n")}
    `;
    alert(message);
  };

  const generatePreviewSteps = (robot) => {
    switch (robot.id) {
      case "autoassign": {
        const reviewerCount = document.getElementById(`config-${robot.id}-select`)?.value || "2";
        return [
          `1. Analyze changed files in the PR`,
          `2. Find contributors who have recently modified the same files`,
          `3. Calculate expertise score based on commit frequency and recency`,
          `4. Select top ${reviewerCount} reviewer(s) based on expertise`,
          `5. Automatically assign selected reviewer(s) to the PR`,
        ];
      }

      case "autoapprove":
        return [
          `1. Check if PR author matches approval criteria`,
          `2. Calculate total lines changed (additions + deletions)`,
          `3. If criteria met and changes are within limit, add approval`,
          `4. Add comment explaining automatic approval`,
        ];

      case "compliancebot":
        return [
          `1. Monitor for merged pull requests`,
          `2. Check if PR had required approvals`,
          `3. If merged without approval, add "TBR" label`,
          `4. Find suitable reviewers for post-merge review`,
          `5. Notify reviewers and create audit trail`,
        ];

      case "slackchan":
        return [
          `1. Detect new pull request or review request`,
          `2. Match repository to configured Slack channel`,
          `3. Wait for CI tests to pass (if enabled)`,
          `4. Send formatted message to Slack channel`,
          `5. Include PR title, author, and review link`,
        ];

      case "slackdm":
        return [
          `1. Detect when user is assigned as reviewer`,
          `2. Look up user's Slack handle in mapping`,
          `3. Wait for CI tests to pass (if enabled)`,
          `4. Send direct message on Slack`,
          `5. Include PR details and direct review link`,
        ];

      case "reassign": {
        const days = document.getElementById(`config-${robot.id}-select`)?.value || "5";
        return [
          `1. Check age of all open PRs with pending reviews`,
          `2. Identify PRs blocked for more than ${days} days`,
          `3. Remove inactive reviewers`,
          `4. Find and assign new suitable reviewers`,
          `5. Notify both old and new reviewers of the change`,
        ];
      }

      case "testbot":
        return [
          `1. Monitor PRs for failing tests`,
          `2. Analyze test failure patterns`,
          `3. Suggest common fixes based on error type`,
          `4. Add helpful comments with debugging steps`,
          `5. Link to relevant documentation or similar fixes`,
        ];

      case "autoclose": {
        const closeDays = document.getElementById(`config-${robot.id}-select`)?.value || "90";
        return [
          `1. Scan all open pull requests`,
          `2. Check last activity date on each PR`,
          `3. Identify PRs with no activity for ${closeDays} days`,
          `4. Add warning comment 7 days before closing`,
          `5. Close PR and add explanation comment`,
        ];
      }

      default:
        return ["No preview available"];
    }
  };

  const exportConfiguration = () => {
    const config = generateYAMLConfig();
    const yamlContent = $("yamlContent");
    if (yamlContent) {
      yamlContent.textContent = config;
    }
    show($("yamlModal"));
  };

  const generateYAMLConfig = () => {
    const enabledRobots = robotDefinitions.filter((robot) => robotConfigs[robot.id]?.enabled);

    if (enabledRobots.length === 0) {
      return "# No robots enabled\n";
    }

    let yaml = `# CodeGroove Configuration
# Generated by reviewGOOSE Dashboard
# Organization: ${selectedOrg === "*" ? "All Organizations" : selectedOrg}

version: 1
robots:
`;

    enabledRobots.forEach((robot) => {
      yaml += `\n  ${robot.id}:\n`;
      yaml += `    enabled: true\n`;

      const configs = Array.isArray(robot.config) ? robot.config : [robot.config];

      configs.forEach((config) => {
        switch (config.type) {
          case "select": {
            const selectValue = document.getElementById(`config-${robot.id}-select`)?.value;
            if (selectValue) {
              yaml += `    ${robot.id === "autoassign" ? "reviewers" : robot.id === "reassign" ? "days" : robot.id === "autoclose" ? "days" : "value"}: ${selectValue}\n`;
            }
            break;
          }

          case "checkboxes":
            if (config.options) {
              const selected = config.options.filter(
                (opt) => document.getElementById(`config-${robot.id}-${opt.id}`)?.checked
              );
              if (selected.length > 0) {
                yaml += `    approve_authors:\n`;
                selected.forEach((opt) => {
                  yaml += `      - ${opt.id}\n`;
                });
              }
            }
            break;

          case "checkbox": {
            const isChecked = document.getElementById(`config-${robot.id}-checkbox`)?.checked;
            yaml += `    wait_for_tests: ${isChecked}\n`;
            break;
          }

          case "text": {
            const textValue = document.getElementById(`config-${robot.id}-text`)?.value;
            if (textValue) {
              yaml += `    topic_filter: ${textValue}\n`;
            }
            break;
          }

          case "mappings": {
            const mappingsContainer = $(`mappings-${robot.id}`);
            if (mappingsContainer) {
              const mappings = mappingsContainer.querySelectorAll(".robot-mapping");
              if (mappings.length > 0) {
                yaml += `    mappings:\n`;
                mappings.forEach((mapping) => {
                  const inputs = mapping.querySelectorAll("input");
                  if (inputs.length === 2 && inputs[0].value && inputs[1].value) {
                    yaml += `      ${inputs[0].value}: ${inputs[1].value}\n`;
                  }
                });
              }
            }
            break;
          }
        }
      });
    });

    return yaml;
  };

  const closeYAMLModal = () => {
    hide($("yamlModal"));
  };

  const copyYAML = () => {
    const yamlContent = $("yamlContent");
    if (yamlContent) {
      navigator.clipboard.writeText(yamlContent.textContent).then(() => {
        const copyBtn = $("copyYAML");
        if (copyBtn) {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 2000);
        }
      });
    }
  };

  const saveRobotConfig = () => {
    robotDefinitions.forEach((robot) => {
      if (!robotConfigs[robot.id]) {
        robotConfigs[robot.id] = { enabled: false, config: {} };
      }

      const configs = Array.isArray(robot.config) ? robot.config : [robot.config];

      configs.forEach((config) => {
        switch (config.type) {
          case "select": {
            const selectEl = document.getElementById(`config-${robot.id}-select`);
            if (selectEl) {
              robotConfigs[robot.id].config.select = selectEl.value;
            }
            break;
          }

          case "checkboxes":
            robotConfigs[robot.id].config.checkboxes = {};
            config.options.forEach((opt) => {
              const checkEl = document.getElementById(`config-${robot.id}-${opt.id}`);
              if (checkEl) {
                robotConfigs[robot.id].config.checkboxes[opt.id] = checkEl.checked;
              }
            });
            break;

          case "checkbox": {
            const checkEl = document.getElementById(`config-${robot.id}-checkbox`);
            if (checkEl) {
              robotConfigs[robot.id].config.checkbox = checkEl.checked;
            }
            break;
          }

          case "text": {
            const textEl = document.getElementById(`config-${robot.id}-text`);
            if (textEl) {
              robotConfigs[robot.id].config.text = textEl.value;
            }
            break;
          }

          case "mappings": {
            const mappingsContainer = $(`mappings-${robot.id}`);
            if (mappingsContainer) {
              const mappings = [];
              const mappingEls = mappingsContainer.querySelectorAll(".robot-mapping");
              mappingEls.forEach((mapping) => {
                const inputs = mapping.querySelectorAll("input");
                if (inputs.length === 2 && inputs[0].value && inputs[1].value) {
                  mappings.push({
                    from: inputs[0].value,
                    to: inputs[1].value,
                  });
                }
              });
              robotConfigs[robot.id].config.mappings = mappings;
            }
            break;
          }
        }
      });
    });
  };

  const resetRobotConfig = () => {
    robotConfigs = {};
    robotDefinitions.forEach((robot) => {
      robotConfigs[robot.id] = {
        enabled: false,
        config: {},
      };
    });
    renderRobotCards();
  };

  return {
    showNotificationsPage,
    showSettingsPage,
    removeMapping,
    closeYAMLModal,
    copyYAML,
    saveRobotConfig,
    resetRobotConfig,
    robotDefinitions,
    robotConfigs,
  };
})();
