# Collaboration threat model

Untrusted callers and model outputs must not acquire file/shell access, change host model credentials, reset shared budgets through project aliases, transmit credentials in context, or bypass generation policy through a legacy tool. Prompt-injected requests must not authorize their own R3 approval or raise a spending cap.

Trusted boundaries: the local operator controls state files, configured project roots and optional MCP management token. HTTP authentication remains in the existing transport. Policy changes over MCP require a separate management token; CLI is a local operator interface. Unknown billing outcomes retain reservations. Ledger entries contain metadata and usage, never prompts, snippets, output, credentials or management tokens.

The server accepts caller-provided text/images; it does not read repository files. Text secret screening is defense in depth, not a complete DLP system. Operators remain responsible for classification of opaque images and content without detectable secrets. Root checks use real paths and reject traversal/UNC/symlink escapes. Neither a path label nor an acceptance criterion grants execution rights.

Deferred: tray/dashboard, worktrees, patch application, DAG execution and persistent conversations. These need separate authorization and threat review before implementation.
