.PHONY: deploy
deploy:
	./hacks/deploy.sh

.PHONY: test
test:
	node --test assets/workspace.test.js


# BEGIN: lint-install .
# http://github.com/codeGROOVE-dev/lint-install

.PHONY: lint
lint: _lint


LINT_ARCH := $(shell uname -m)
LINT_OS := $(shell uname)
LINT_OS_LOWER := $(shell echo $(LINT_OS) | tr '[:upper:]' '[:lower:]')
LINT_ROOT := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

# shellcheck and hadolint lack arm64 native binaries: rely on x86-64 emulation
ifeq ($(LINT_OS),Darwin)
	ifeq ($(LINT_ARCH),arm64)
		LINT_ARCH=x86_64
	endif
endif

LINTERS :=
FIXERS :=

SHELLCHECK_VERSION ?= v0.10.0
SHELLCHECK_BIN := $(LINT_ROOT)/out/linters/shellcheck-$(SHELLCHECK_VERSION)-$(LINT_ARCH)
$(SHELLCHECK_BIN):
	mkdir -p $(LINT_ROOT)/out/linters
	curl -sSfL -o $@.tar.xz https://github.com/koalaman/shellcheck/releases/download/$(SHELLCHECK_VERSION)/shellcheck-$(SHELLCHECK_VERSION).$(LINT_OS_LOWER).$(LINT_ARCH).tar.xz \
		|| echo "Unable to fetch shellcheck for $(LINT_OS)/$(LINT_ARCH): falling back to locally install"
	test -f $@.tar.xz \
		&& tar -C $(LINT_ROOT)/out/linters -xJf $@.tar.xz \
		&& mv $(LINT_ROOT)/out/linters/shellcheck-$(SHELLCHECK_VERSION)/shellcheck $@ \
		|| printf "#!/usr/bin/env shellcheck\n" > $@
	chmod u+x $@

LINTERS += shellcheck-lint
shellcheck-lint: $(SHELLCHECK_BIN)
	$(SHELLCHECK_BIN) $(shell find . -name "*.sh")

FIXERS += shellcheck-fix
shellcheck-fix: $(SHELLCHECK_BIN)
	$(SHELLCHECK_BIN) $(shell find . -name "*.sh") -f diff | { read -t 1 line || exit 0; { echo "$$line" && cat; } | git apply -p2; }

GOLANGCI_LINT_CONFIG := $(LINT_ROOT)/.golangci.yml
GOLANGCI_LINT_VERSION ?= v2.5.0
GOLANGCI_LINT_BIN := $(LINT_ROOT)/out/linters/golangci-lint-$(GOLANGCI_LINT_VERSION)-$(LINT_ARCH)
$(GOLANGCI_LINT_BIN):
	mkdir -p $(LINT_ROOT)/out/linters
	rm -rf $(LINT_ROOT)/out/linters/golangci-lint-*
	curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(LINT_ROOT)/out/linters $(GOLANGCI_LINT_VERSION)
	mv $(LINT_ROOT)/out/linters/golangci-lint $@

LINTERS += golangci-lint-lint
golangci-lint-lint: $(GOLANGCI_LINT_BIN)
	find . -name go.mod -execdir "$(GOLANGCI_LINT_BIN)" run -c "$(GOLANGCI_LINT_CONFIG)" \;

FIXERS += golangci-lint-fix
golangci-lint-fix: $(GOLANGCI_LINT_BIN)
	find . -name go.mod -execdir "$(GOLANGCI_LINT_BIN)" run -c "$(GOLANGCI_LINT_CONFIG)" --fix \;

YAMLLINT_VERSION ?= 1.37.1
YAMLLINT_ROOT := $(LINT_ROOT)/out/linters/yamllint-$(YAMLLINT_VERSION)
YAMLLINT_BIN := $(YAMLLINT_ROOT)/dist/bin/yamllint
$(YAMLLINT_BIN):
	mkdir -p $(LINT_ROOT)/out/linters
	rm -rf $(LINT_ROOT)/out/linters/yamllint-*
	curl -sSfL https://github.com/adrienverge/yamllint/archive/refs/tags/v$(YAMLLINT_VERSION).tar.gz | tar -C $(LINT_ROOT)/out/linters -zxf -
	cd $(YAMLLINT_ROOT) && pip3 install --target dist . || pip install --target dist .

LINTERS += yamllint-lint
yamllint-lint: $(YAMLLINT_BIN)
	PYTHONPATH=$(YAMLLINT_ROOT)/dist $(YAMLLINT_ROOT)/dist/bin/yamllint .

BIOME_VERSION ?= 2.2.6
BIOME_BIN := $(LINT_ROOT)/out/linters/biome-$(BIOME_VERSION)-$(LINT_ARCH)
BIOME_CONFIG := $(LINT_ROOT)/biome.json

# Map architecture names for Biome downloads
BIOME_ARCH := $(LINT_ARCH)
ifeq ($(LINT_ARCH),x86_64)
	BIOME_ARCH := x64
endif

$(BIOME_BIN):
	mkdir -p $(LINT_ROOT)/out/linters
	rm -rf $(LINT_ROOT)/out/linters/biome-*
	curl -sSfL -o $@ https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40$(BIOME_VERSION)/biome-$(LINT_OS_LOWER)-$(BIOME_ARCH) \
		|| echo "Unable to fetch biome for $(LINT_OS_LOWER)/$(BIOME_ARCH), falling back to local install"
	test -f $@ || printf "#!/usr/bin/env biome\n" > $@
	chmod u+x $@

LINTERS += biome-lint
biome-lint: $(BIOME_BIN)
	$(BIOME_BIN) check --config-path=$(BIOME_CONFIG) .

FIXERS += biome-fix
biome-fix: $(BIOME_BIN)
	$(BIOME_BIN) check --write --config-path=$(BIOME_CONFIG) .

.PHONY: _lint $(LINTERS)
_lint:
	@exit_code=0; \
	for target in $(LINTERS); do \
		$(MAKE) $$target || exit_code=1; \
	done; \
	exit $$exit_code

.PHONY: fix $(FIXERS)
fix:
	@exit_code=0; \
	for target in $(FIXERS); do \
		$(MAKE) $$target || exit_code=1; \
	done; \
	exit $$exit_code

# END: lint-install .
