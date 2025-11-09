# Automated Tests

## Running Tests

```bash
make test
```

Or directly with Node.js:

```bash
node --test assets/workspace.test.js
```

## Test Coverage

### `workspace.test.js`
Tests for the workspace module (`assets/workspace.js`):

- **currentWorkspace()**: Validates workspace detection from subdomain
  - Base domain returns `null`
  - Reserved subdomains (www, api, etc.) return `null`
  - Org subdomains return the org name
  - Localhost returns `null`

- **hiddenOrgs()**: Validates reading hidden organizations from cookies
  - Returns empty array when no preferences exist
  - Reads from workspace-specific cookies
  - Handles both personal and org workspaces

- **setHiddenOrgs()**: Validates setting hidden organizations
  - Creates workspace-specific cookies
  - Handles empty arrays
  - Works for both personal and org workspaces

- **toggleOrgVisibility()**: Validates toggling org visibility
  - Adds org when not present
  - Removes org when present
  - Works correctly across multiple toggles

- **initializeDefaults()**: Validates default behavior for org workspaces
  - Hides personal account PRs by default in org workspaces
  - Does NOT set defaults in personal workspace
  - Does NOT override existing preferences
  - Requires username cookie to be set
  - Maintains independent preferences per workspace

- **Integration tests**: Validates full workflow scenarios
  - Users can override defaults by toggling
  - Preferences persist across page reloads
  - Repeated toggles work correctly (idempotency)
  - No duplicate orgs from rapid clicking (regression test)

## Test Framework

Tests use Node.js built-in test runner (available in Node.js 18+). No external dependencies required.

The tests create a mock DOM environment with:
- `MockDocument`: Simulates `document` with cookie storage
- `MockWindow`: Simulates `window` with location/hostname

This allows testing browser-specific code in a Node.js environment.
