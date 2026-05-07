# Formula/setra.rb — Homebrew formula for setra CLI
# Install:
#   brew tap nitikeshq/setra
#   brew install setra
#
# Or directly:
#   brew install --formula https://raw.githubusercontent.com/nitikeshq/setra/main/Formula/setra.rb

class Setra < Formula
  desc "Run AI coding agents anywhere, remember everything"
  homepage "https://setra.sh"
  version "0.1.0"
  license "MIT"

  # NOTE: Update these SHA256 hashes after each GitHub Release is published.
  # Run: shasum -a 256 setra-0.1.0-darwin-arm64.tar.gz
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/nitikeshq/setra/releases/download/v#{version}/setra-#{version}-darwin-arm64.tar.gz"
      sha256 "REPLACE_WITH_REAL_SHA256_DARWIN_ARM64"
    else
      url "https://github.com/nitikeshq/setra/releases/download/v#{version}/setra-#{version}-darwin-x64.tar.gz"
      sha256 "REPLACE_WITH_REAL_SHA256_DARWIN_X64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/nitikeshq/setra/releases/download/v#{version}/setra-#{version}-linux-arm64.tar.gz"
      sha256 "REPLACE_WITH_REAL_SHA256_LINUX_ARM64"
    else
      url "https://github.com/nitikeshq/setra/releases/download/v#{version}/setra-#{version}-linux-x64.tar.gz"
      sha256 "REPLACE_WITH_REAL_SHA256_LINUX_X64"
    end
  end

  def install
    bin.install "setra"
    # Install shell completions if present in tarball
    bash_completion.install "completions/setra.bash" => "setra" if File.exist?("completions/setra.bash")
    zsh_completion.install "completions/_setra" if File.exist?("completions/_setra")
    fish_completion.install "completions/setra.fish" if File.exist?("completions/setra.fish")
    # Install man page if present
    man1.install "man/setra.1" if File.exist?("man/setra.1")
  end

  def caveats
    <<~EOS
      setra has been installed. To get started:

        setra tui           — launch the interactive TUI
        setra run           — run an AI agent on the current repo
        setra --help        — show all commands

      Docs:   https://setra.sh/docs
      GitHub: https://github.com/nitikeshq/setra
    EOS
  end

  test do
    assert_match "setra", shell_output("#{bin}/setra --version")
  end
end
