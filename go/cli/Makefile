VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-s -w -X main.version=$(VERSION)"
BIN_DIR := ../../bin
GO_CLI := ./cmd/setra

.PHONY: all build clean test install cross

all: build

build:
	@echo "Building setra CLI..."
	go build $(LDFLAGS) -o $(BIN_DIR)/setra $(GO_CLI)
	@echo "✓ Built $(BIN_DIR)/setra ($(shell du -h $(BIN_DIR)/setra | cut -f1))"

install: build
	@echo "Installing setra to /usr/local/bin..."
	cp $(BIN_DIR)/setra /usr/local/bin/setra
	@echo "✓ Installed"

test:
	go test ./... -v

clean:
	rm -rf $(BIN_DIR)/setra*

# Cross-compilation targets
cross: cross-darwin cross-linux cross-windows

cross-darwin:
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o $(BIN_DIR)/setra-darwin-arm64 $(GO_CLI)
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o $(BIN_DIR)/setra-darwin-amd64 $(GO_CLI)
	@echo "✓ Built macOS binaries"

cross-linux:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(BIN_DIR)/setra-linux-amd64 $(GO_CLI)
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o $(BIN_DIR)/setra-linux-arm64 $(GO_CLI)
	@echo "✓ Built Linux binaries"

cross-windows:
	GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o $(BIN_DIR)/setra-windows-amd64.exe $(GO_CLI)
	@echo "✓ Built Windows binary"

checksums:
	cd $(BIN_DIR) && sha256sum setra-* > checksums.txt 2>/dev/null || shasum -a 256 setra-* > checksums.txt
	@echo "✓ Generated checksums"
