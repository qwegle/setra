import type { Skill } from "./types.js";

export const BUILTIN_SKILLS: Skill[] = [
	{
		id: "code-review",
		name: "Code Review",
		description: "Review code for correctness, security, and performance",
		aliases: ["cr", "review"],
		modelHint: "claude-opus-4",
		inputSchema: {
			scope: "string — files or directories to review",
			severity: "low | medium | high — minimum severity to report",
		},
		tags: ["quality", "security"],
		template: `Please perform a thorough code review.
Severity filter: $severity (report issues at or above this level).
Scope: $scope

Focus on:
- Correctness: logic errors, edge cases, off-by-ones
- Security: injection, auth bypass, secrets in code, unsafe deserialization
- Performance: N+1 queries, unnecessary allocations, blocking calls
- Test coverage: missing or weak assertions

Return findings sorted by severity (critical → high → medium → low).
For each finding include: file:line, severity, description, suggested fix.`,
		source: "builtin",
	},
	{
		id: "write-tests",
		name: "Write Tests",
		description: "Generate comprehensive tests for the given target",
		aliases: ["tests", "test-gen"],
		modelHint: "claude-sonnet-4",
		inputSchema: {
			target: "string — file, function, or module to test",
			framework: "string — test framework (jest, vitest, pytest, etc.)",
		},
		tags: ["testing", "quality"],
		template: `Generate comprehensive tests for: $target
Test framework: $framework

Requirements:
- Cover the happy path, edge cases, and error conditions
- Test boundary values and null/undefined inputs
- Mock external dependencies appropriately
- Use descriptive test names that document behavior
- Aim for >90% branch coverage
- Include setup/teardown where needed`,
		source: "builtin",
	},
	{
		id: "explain",
		name: "Explain Code",
		description: "Explain how a piece of code works in plain language",
		aliases: ["explain", "what-does"],
		modelHint: "claude-haiku-4",
		inputSchema: {
			code: "string — the code snippet or file path to explain",
			audience: "beginner | intermediate | expert — target audience",
		},
		tags: ["documentation", "learning"],
		template: `Explain the following code clearly for a $audience audience:

$code

Include:
- What the code does at a high level
- How it works step by step
- Any non-obvious design decisions
- Potential gotchas or caveats
Keep the explanation concise and practical.`,
		source: "builtin",
	},
	{
		id: "refactor",
		name: "Refactor",
		description: "Refactor code with safeguards to preserve behavior",
		aliases: ["refactor", "clean"],
		modelHint: "claude-sonnet-4",
		inputSchema: {
			scope: "string — files or modules to refactor",
			constraints:
				"string — constraints to follow (e.g. no new deps, keep public API)",
		},
		tags: ["quality", "maintenance"],
		template: `Refactor the following code: $scope

Constraints: $constraints

Approach:
1. First, identify code smells: duplication, long functions, poor naming, tight coupling
2. Propose a refactor plan — list changes before making them
3. Apply changes incrementally, preserving all existing behavior
4. Ensure tests still pass after each step
5. Document any behavior changes or API differences

Do NOT introduce new external dependencies unless explicitly allowed.`,
		source: "builtin",
	},
	{
		id: "write-docs",
		name: "Write Docs",
		description: "Generate documentation for code or APIs",
		aliases: ["docs", "document"],
		modelHint: "claude-haiku-4",
		inputSchema: {
			target: "string — file, module, or API to document",
			format: "markdown | jsdoc | docstring | readme — output format",
		},
		tags: ["documentation"],
		template: `Generate documentation for: $target
Output format: $format

Include:
- Overview and purpose
- Parameters / props / arguments with types and descriptions
- Return values and their types
- Usage examples with realistic inputs
- Error conditions and edge cases
- Any important caveats or limitations`,
		source: "builtin",
	},
	{
		id: "debug",
		name: "Debug",
		description: "Find and fix the root cause of a bug",
		aliases: ["debug", "fix"],
		modelHint: "claude-sonnet-4",
		inputSchema: {
			error: "string — error message, stack trace, or description of the bug",
			context: "string — relevant code, logs, or environment details",
		},
		tags: ["debugging"],
		template: `Debug the following issue:

Error / symptom:
$error

Context:
$context

Steps:
1. Identify the most likely root cause based on the error and context
2. Explain why the bug occurs
3. Propose a minimal fix
4. Check if the fix could introduce regressions
5. Suggest a test case that would catch this bug in the future`,
		source: "builtin",
	},
	{
		id: "api-design",
		name: "API Design",
		description: "Design a clean REST or GraphQL API",
		aliases: ["api", "api-design"],
		modelHint: "claude-opus-4",
		inputSchema: {
			resource: "string — the resource or domain to design an API for",
			style: "REST | GraphQL | tRPC — API style",
		},
		tags: ["architecture", "api"],
		template: `Design a $style API for: $resource

Deliverables:
- Resource model with all fields, types, and relationships
- Endpoint definitions (method, path/operation, request shape, response shape)
- Authentication and authorization model
- Error response format
- Pagination strategy (if applicable)
- Versioning approach

For REST: follow RESTful conventions (nouns, HTTP verbs, status codes).
For GraphQL: define types, queries, mutations, and subscriptions.
For tRPC: define router structure with input/output schemas.`,
		source: "builtin",
	},
	{
		id: "security-audit",
		name: "Security Audit",
		description: "Audit code for security vulnerabilities",
		aliases: ["audit", "sec"],
		modelHint: "claude-opus-4",
		inputSchema: {
			scope: "string — files, modules, or features to audit",
			owasp: 'string — OWASP Top 10 categories to focus on (or "all")',
		},
		tags: ["security", "quality"],
		template: `Perform a security audit on: $scope
OWASP focus: $owasp

Check for:
- Injection vulnerabilities (SQL, command, LDAP, XPath)
- Broken authentication and session management
- Sensitive data exposure (secrets, PII in logs/responses)
- XML External Entities (XXE)
- Broken access control and privilege escalation
- Security misconfiguration
- Cross-site scripting (XSS) and CSRF
- Insecure deserialization
- Using components with known vulnerabilities
- Insufficient logging and monitoring

For each vulnerability: severity (critical/high/medium/low), location, description, CWE reference, remediation.`,
		source: "builtin",
	},

	// ─── Game Engineering ──────────────────────────────────────────────────────

	{
		id: "game-dev",
		name: "Game Development",
		description: "Design and implement game mechanics, systems, and features",
		aliases: ["game", "gamedev", "unity", "unreal", "godot"],
		modelHint: "claude-sonnet-4",
		inputSchema: {
			feature: "string — the game feature or system to build",
			engine: "Unity | Unreal | Godot | custom — game engine",
			language: "C# | C++ | GDScript | TypeScript — primary language",
		},
		tags: ["gamedev", "engineering"],
		template: `Design and implement this game feature: $feature
Engine: $engine | Language: $language

Approach:
1. Break the feature into subsystems (input, physics, state, render, audio, networking)
2. Define data structures and component interfaces first
3. Implement core logic — keep it engine-agnostic where possible
4. Handle edge cases: null refs, missing assets, scene transitions, pause/resume state
5. Write unit tests for pure logic; identify what requires integration or playtesting
6. Note performance considerations: GC pressure, draw calls, frame budget, memory pooling

Output: working implementation with inline comments on non-obvious decisions.`,
		source: "builtin",
	},

	// ─── AI / Model Creation ────────────────────────────────────────────────────

	{
		id: "model-creator",
		name: "AI Model Creator",
		description:
			"Design fine-tuning datasets, training configs, and model pipelines",
		aliases: ["fine-tune", "finetune", "train-model", "ml"],
		modelHint: "claude-opus-4",
		inputSchema: {
			base_model:
				"string — base model to fine-tune (e.g. llama3.1:8b, mistral:7b)",
			task: "string — the task or domain to specialise for",
			data_source: "string — description of available training data",
			format: "instruction | chat | completion — training format",
		},
		tags: ["ml", "fine-tuning", "model-training"],
		template: `Create a fine-tuning plan for: $task
Base model: $base_model | Format: $format
Available data: $data_source

Deliverables:
1. Dataset design — schema, diversity requirements, size estimate, quality criteria
2. Data generation strategy — synthetic augmentation if real data is insufficient
3. Training config — learning rate, batch size, epochs, warm-up schedule, LoRA vs full fine-tune
4. Evaluation plan — benchmark sets, metrics (perplexity, accuracy, BLEU, human eval)
5. Overfitting guards — validation split, early stopping, regularisation
6. Deployment checklist — quantisation (GGUF/AWQ/GPTQ), inference server choice, latency budget

Flag data quality issues, licensing constraints, and safety considerations.`,
		source: "builtin",
	},

	{
		id: "model-eval",
		name: "Model Evaluation",
		description:
			"Design evaluation benchmarks and run structured model comparisons",
		aliases: ["eval", "benchmark", "evals", "llm-eval"],
		modelHint: "claude-sonnet-4",
		inputSchema: {
			models: "string — comma-separated list of models to compare",
			task: "string — the task or capability to evaluate",
			metric: "accuracy | f1 | bleu | human-rating | custom — primary metric",
		},
		tags: ["ml", "evaluation", "benchmarks"],
		template: `Design an evaluation benchmark for: $task
Models: $models | Primary metric: $metric

Deliverables:
1. Test set design — sample count, distribution, difficulty tiers, edge cases
2. Prompt template — identical framing across all models
3. Scoring rubric — exact criteria per score level
4. Baseline — simple heuristic or zero-shot reference for comparison
5. Automated scoring script (if metric is programmatic)
6. Human evaluation guide (if subjective)
7. Statistical analysis plan — confidence intervals, significance tests
8. Results table: model, score, latency (p50/p95), cost per 1k evals

Flag dataset contamination risks and known benchmark saturation issues.`,
		source: "builtin",
	},

	// ─── Web3 / Blockchain ─────────────────────────────────────────────────────

	{
		id: "web3-dev",
		name: "Web3 Development",
		description:
			"Design and implement smart contracts, DeFi protocols, and Web3 integrations",
		aliases: ["web3", "blockchain", "solidity", "defi", "nft"],
		modelHint: "claude-opus-4",
		inputSchema: {
			contract: "string — the contract or protocol to build",
			chain:
				"Ethereum | Polygon | Solana | Base | Arbitrum | custom — target chain",
			standard:
				'string — relevant standards (ERC-20, ERC-721, ERC-1155, or "none")',
		},
		tags: ["web3", "blockchain", "solidity", "security"],
		template: `Implement this Web3 component: $contract
Chain: $chain | Standard: $standard

Steps:
1. Define the contract interface — functions, events, custom errors, state variables
2. Implement business logic with security-first mindset
3. Apply security patterns: checks-effects-interactions, reentrancy guards, role-based access control
4. Audit for common vulnerabilities: reentrancy, overflow, front-running, oracle manipulation, flash loan surfaces
5. Write comprehensive tests (Hardhat/Foundry): happy path, edge cases, attack simulations
6. Gas optimisation: storage slot packing, calldata vs memory, batch operations
7. Deployment plan: proxy pattern if upgradeable, initialiser guards, multisig ownership

Include NatSpec documentation on all public functions.`,
		source: "builtin",
	},

	{
		id: "smart-contract-audit",
		name: "Smart Contract Audit",
		description:
			"Audit smart contracts for security vulnerabilities and logic flaws",
		aliases: ["contract-audit", "solidity-audit", "defi-audit"],
		modelHint: "claude-opus-4",
		inputSchema: {
			contract: "string — path to the contract file(s) or inline Solidity",
			scope: 'string — specific functions or modules to focus on (or "full")',
		},
		tags: ["security", "web3", "audit"],
		template: `Audit this smart contract: $contract
Scope: $scope

Check for:
- Reentrancy (classic, cross-function, cross-contract, read-only)
- Integer overflow / underflow (even on Solidity >=0.8.x with custom math libs)
- Access control flaws and privilege escalation
- Front-running and sandwich attack vectors
- Oracle manipulation and price manipulation
- Flash loan attack surfaces
- Incorrect or missing event emission
- Denial of service (gas griefing, block gas limit)
- Unsafe delegatecall and low-level calls
- Upgradeable proxy storage collisions
- Signature replay and cross-chain replay attacks

For each finding: severity (Critical/High/Medium/Low/Informational), location, description,
proof-of-concept, recommended fix, and a test case that demonstrates the issue.

End with an overall security score and deployment recommendation.`,
		source: "builtin",
	},

	// ─── Mobile Development ────────────────────────────────────────────────────

	{
		id: "mobile-expo",
		name: "Mobile App Development",
		description: "Build cross-platform mobile apps with Expo and React Native",
		aliases: ["mobile", "expo", "react-native", "rn"],
		modelHint: "claude-sonnet-4",
		inputSchema: {
			feature: "string — the screen, component, or feature to build",
			platform: "ios | android | both — target platform(s)",
			navigation: "expo-router | react-navigation | none — navigation approach",
		},
		tags: ["mobile", "expo", "react-native", "cross-platform"],
		template: `Build this Expo/React Native feature: $feature
Platform: $platform | Navigation: $navigation

Guidelines:
- Use Expo SDK APIs first (expo-camera, expo-location, expo-notifications, etc.)
  before reaching for bare React Native equivalents
- TypeScript strict mode throughout; no implicit any
- Expo Router file-based routing when navigation is expo-router
- Responsive layouts with flexbox; test on multiple screen densities
- Handle platform differences via Platform.OS — keep iOS/Android divergence minimal
- State management: React hooks for local state, Zustand or TanStack Query for server state
- Accessibility: accessibilityLabel and accessibilityRole on all interactive elements
- Performance: FlatList for lists, React.memo where justified, avoid anonymous render functions

Note on native development: setra agents produce reliable output for Expo/React Native.
For Kotlin-only (Android) or Swift-only (iOS) native development, agents can assist
but iteration is slower and output requires more human review — native mobile requires
deeper platform knowledge that setra is still training on.

Deliver working component code with comments on Expo-specific decisions.`,
		source: "builtin",
	},
];
