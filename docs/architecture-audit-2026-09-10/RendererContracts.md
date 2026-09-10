# RendererContracts architecture audit

The project layout constructs the live ProjectHostProvider action value. Project renderers read that context; ProjectManagerContentRouter only consumes repoPath, tabs, activeTab, and projectQuickActions. Separate ProjectHostActions preserves all 14 callbacks at their owner while removing the unused router arguments. Both editor and project dispatchers forward tab and isActive; no renderer consumes paneId. TabBar's independent paneId remains live and unchanged.

Covered layers: 1 compilation; 2 dead paths and deduplication; 3 names and comments; 4 router inputs versus host actions; 5 existing renderer defaults preserved; 6 context ownership; 7 explicit minimal contracts; 8 no serialization or wire changes; 9 both editor and project dispatcher entry points; 10 dispatch and renderer prop symmetry. Rust/IPC and provider initialization are outside this change.

Retained pools, context callback closures, specialized chat/git rendering, and active/hidden policies are unchanged. The router regression no longer bypasses its prop contract with a cast. Run the scoped router and retained-pool tests, frontend typecheck, changed-file lint, and type-aware lint; see PR Verification for exact results.
