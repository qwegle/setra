export interface CompanyTemplate {
	id: string;
	name: string;
	description: string;
	category:
		| "engineering"
		| "gtm"
		| "research"
		| "governance"
		| "support"
		| "custom";
	leadSlug: string;
	members: Array<{
		slug: string;
		name: string;
		role: string;
		model: "auto" | string;
		expertise: string[];
		personality: string;
		permissionMode: "auto" | "plan" | "review";
		maxTurns: number;
		costBudgetUsd?: number;
		worktreeIsolation: boolean;
	}>;
	totalCostBudgetUsd: number;
	preSeededSkills: Array<{ name: string; trigger: string; content: string }>;
	tags: string[];
}

export const COMPANY_TEMPLATES: CompanyTemplate[] = [
	{
		id: "starter",
		name: "Starter Team",
		description: "CEO + Engineer + GTM Lead — perfect for solo founders",
		category: "engineering",
		leadSlug: "ceo",
		members: [
			{
				slug: "ceo",
				name: "CEO",
				role: "Coordinator & Strategist",
				model: "claude-sonnet-4",
				expertise: ["strategy", "coordination", "planning"],
				personality:
					"Strategic coordinator who breaks tasks into clear subtasks and delegates effectively",
				permissionMode: "plan",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "engineer",
				name: "Engineer",
				role: "Full-Stack Engineer",
				model: "claude-sonnet-4",
				expertise: ["full-stack", "architecture", "debugging"],
				personality: "Pragmatic engineer who writes clean, tested code",
				permissionMode: "auto",
				maxTurns: 25,
				costBudgetUsd: 2,
				worktreeIsolation: true,
			},
			{
				slug: "gtm-lead",
				name: "GTM Lead",
				role: "Go-To-Market Lead",
				model: "claude-sonnet-4",
				expertise: ["marketing", "positioning", "growth"],
				personality: "Growth-focused strategist who connects product to market",
				permissionMode: "plan",
				maxTurns: 15,
				costBudgetUsd: 1,
				worktreeIsolation: false,
			},
		],
		totalCostBudgetUsd: 5,
		preSeededSkills: [],
		tags: ["starter", "engineering", "gtm"],
	},
	{
		id: "founding-team",
		name: "Full Founding Team",
		description:
			"8-agent full founding team covering engineering, product, and design",
		category: "engineering",
		leadSlug: "ceo",
		members: [
			{
				slug: "ceo",
				name: "CEO",
				role: "CEO & Coordinator",
				model: "claude-sonnet-4",
				expertise: ["strategy", "coordination", "prioritisation"],
				personality:
					"Strategic CEO who coordinates the founding team and keeps everything aligned",
				permissionMode: "plan",
				maxTurns: 30,
				costBudgetUsd: 3,
				worktreeIsolation: false,
			},
			{
				slug: "pm",
				name: "Product Manager",
				role: "Product Manager",
				model: "claude-sonnet-4",
				expertise: [
					"product strategy",
					"user stories",
					"roadmap",
					"prioritisation",
				],
				personality:
					"User-obsessed PM who translates customer needs into crisp specs",
				permissionMode: "plan",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "frontend",
				name: "Frontend Engineer",
				role: "Frontend Engineer",
				model: "claude-sonnet-4",
				expertise: ["React", "TypeScript", "CSS", "UI", "accessibility"],
				personality:
					"Detail-oriented frontend engineer who builds pixel-perfect, accessible UIs",
				permissionMode: "auto",
				maxTurns: 25,
				costBudgetUsd: 2,
				worktreeIsolation: true,
			},
			{
				slug: "backend",
				name: "Backend Engineer",
				role: "Backend Engineer",
				model: "claude-sonnet-4",
				expertise: ["Node.js", "databases", "APIs", "performance", "scaling"],
				personality:
					"Pragmatic backend engineer who builds reliable, scalable services",
				permissionMode: "auto",
				maxTurns: 25,
				costBudgetUsd: 2,
				worktreeIsolation: true,
			},
			{
				slug: "ai-engineer",
				name: "AI Engineer",
				role: "AI/ML Engineer",
				model: "claude-sonnet-4",
				expertise: [
					"LLM integration",
					"embeddings",
					"RAG",
					"fine-tuning",
					"evals",
				],
				personality: "Hands-on AI engineer who ships production ML features",
				permissionMode: "auto",
				maxTurns: 25,
				costBudgetUsd: 2,
				worktreeIsolation: true,
			},
			{
				slug: "qa",
				name: "QA Engineer",
				role: "QA Engineer",
				model: "claude-haiku-3-5",
				expertise: ["testing", "automation", "coverage", "regression"],
				personality: "Thorough tester who catches bugs before users do",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "designer",
				name: "Designer",
				role: "Product Designer",
				model: "claude-haiku-3-5",
				expertise: ["UX", "wireframes", "design systems", "prototyping"],
				personality: "User-centred designer who creates intuitive experiences",
				permissionMode: "plan",
				maxTurns: 15,
				costBudgetUsd: 1,
				worktreeIsolation: false,
			},
			{
				slug: "devops",
				name: "DevOps Engineer",
				role: "DevOps & Infrastructure",
				model: "claude-sonnet-4",
				expertise: ["CI/CD", "Docker", "Kubernetes", "monitoring", "security"],
				personality:
					"Reliability-focused DevOps engineer who keeps production running",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
		],
		totalCostBudgetUsd: 20,
		preSeededSkills: [],
		tags: ["founding", "full-team", "engineering"],
	},
	{
		id: "gtm-sales",
		name: "GTM & Sales Machine",
		description: "Full GTM and sales pipeline team — ICP to closed-won",
		category: "gtm",
		leadSlug: "gtm-lead",
		members: [
			{
				slug: "gtm-lead",
				name: "Arjun",
				role: "GTM Lead",
				model: "claude-sonnet-4",
				expertise: ["ICP definition", "positioning", "pipeline", "revenue ops"],
				personality:
					"Revenue-focused lead who owns the full GTM motion from ICP to closed-won",
				permissionMode: "plan",
				maxTurns: 25,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "sdr",
				name: "Priya",
				role: "Sales Development Rep",
				model: "claude-haiku-4",
				expertise: [
					"outbound emails",
					"lead qualification",
					"prospecting",
					"sequencing",
				],
				personality:
					"High-volume outbound specialist who personalises at scale",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "content",
				name: "Kavya",
				role: "Content Strategist",
				model: "claude-haiku-4",
				expertise: [
					"blog posts",
					"landing pages",
					"LinkedIn",
					"SEO",
					"demand gen",
				],
				personality:
					"Content strategist who turns positioning into pipeline-driving assets",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "crm",
				name: "Rahul",
				role: "CRM Operations",
				model: "claude-haiku-4",
				expertise: [
					"HubSpot",
					"Salesforce",
					"data hygiene",
					"deal tracking",
					"revenue ops",
				],
				personality:
					"Data-driven ops specialist who keeps the CRM clean and pipeline flowing",
				permissionMode: "auto",
				maxTurns: 15,
				costBudgetUsd: 1,
				worktreeIsolation: false,
			},
			{
				slug: "ae",
				name: "Meera",
				role: "Account Executive",
				model: "claude-sonnet-4",
				expertise: [
					"demo prep",
					"proposal writing",
					"negotiation",
					"closing",
					"objection handling",
				],
				personality:
					"Consultative seller who closes deals through value-led conversations",
				permissionMode: "plan",
				maxTurns: 20,
				costBudgetUsd: 3,
				worktreeIsolation: false,
			},
		],
		totalCostBudgetUsd: 10,
		preSeededSkills: [
			{
				name: "lead-qualify",
				trigger: "qualify",
				content:
					"Qualify this lead: research the company, score against ICP (firmographics: size 10-500 employees, tech-forward, budget signals present), review CRM connection for prior touches, output SCORE/10 with detailed reasoning and recommended next action.",
			},
			{
				name: "outbound-email",
				trigger: "outbound",
				content:
					"Write a 3-email outbound sequence for this prospect. Make it personalised and value-led — no spray-and-pray. Include: (1) first touch with specific company research hook, (2) follow-up with a relevant case study or insight, (3) final breakup email. Write compelling subject lines that get opens.",
			},
			{
				name: "sales-funnel-report",
				trigger: "funnel-report",
				content:
					"Analyse our pipeline. Pull data from the CRM, then show: total deals by stage, average days in each stage, conversion rates between stages, revenue forecast (weighted and unweighted), top 3 deals at risk with recommended actions, and overall pipeline health score.",
			},
			{
				name: "competitor-brief",
				trigger: "competitor",
				content:
					"Research this competitor. Cover: pricing and packaging, positioning and messaging, ICP and customer profile, key weaknesses we can exploit, and a battle card with 5 talking points for our sales team.",
			},
			{
				name: "proposal-draft",
				trigger: "proposal",
				content:
					"Draft a proposal for this deal. Structure: executive summary, problem statement, our solution, ROI calculation with specific numbers, implementation timeline, pricing options, and clear next steps with owner and date.",
			},
		],
		tags: ["gtm", "sales", "revenue", "outbound", "crm"],
	},
	{
		id: "code-review",
		name: "Code Review Squad",
		description: "Tech lead + security + QA + docs for thorough code reviews",
		category: "engineering",
		leadSlug: "tech-lead",
		members: [
			{
				slug: "tech-lead",
				name: "Aditya",
				role: "Tech Lead",
				model: "claude-opus-4",
				expertise: ["architecture", "design patterns", "technical decisions"],
				personality:
					"Experienced architect who ensures code quality and sound design",
				permissionMode: "plan",
				maxTurns: 25,
				costBudgetUsd: 4,
				worktreeIsolation: false,
			},
			{
				slug: "security",
				name: "Sanjana",
				role: "Security Engineer",
				model: "claude-sonnet-4",
				expertise: ["security", "OWASP", "vulnerabilities", "pen testing"],
				personality:
					"Security-first reviewer who catches vulnerabilities before production",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "qa",
				name: "Rohan",
				role: "QA Engineer",
				model: "claude-haiku-4",
				expertise: [
					"test coverage",
					"regression",
					"test automation",
					"edge cases",
				],
				personality:
					"Thorough tester who finds edge cases and ensures coverage",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "docs",
				name: "Ishaan",
				role: "Documentation Engineer",
				model: "claude-haiku-4",
				expertise: ["inline docs", "README", "API docs", "technical writing"],
				personality: "Clear technical writer who makes code understandable",
				permissionMode: "auto",
				maxTurns: 15,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
		],
		totalCostBudgetUsd: 10,
		preSeededSkills: [],
		tags: ["code-review", "quality", "security", "engineering"],
	},
	{
		id: "governance-onprem",
		name: "Governance / On-Premise Team",
		description:
			"All local models — no cloud API keys needed. For air-gapped and government deployments.",
		category: "governance",
		leadSlug: "ciso",
		members: [
			{
				slug: "ciso",
				name: "Vikram",
				role: "Security Officer",
				model: "ollama:qwen2.5-coder:7b",
				expertise: [
					"security policy",
					"risk management",
					"compliance frameworks",
					"infrastructure security",
				],
				personality:
					"Methodical security officer who ensures all systems meet the highest security standards",
				permissionMode: "plan",
				maxTurns: 20,
				costBudgetUsd: 0,
				worktreeIsolation: false,
			},
			{
				slug: "auditor",
				name: "Ananya",
				role: "Compliance Auditor",
				model: "ollama:phi4",
				expertise: [
					"compliance",
					"audit",
					"regulatory requirements",
					"documentation",
				],
				personality:
					"Detail-oriented auditor who verifies technical implementations against standards",
				permissionMode: "plan",
				maxTurns: 20,
				costBudgetUsd: 0,
				worktreeIsolation: false,
			},
			{
				slug: "sysadmin",
				name: "Karthik",
				role: "System Administrator",
				model: "ollama:qwen2.5-coder:7b",
				expertise: [
					"infrastructure",
					"system administration",
					"networking",
					"on-premise deployment",
				],
				personality:
					"Pragmatic sysadmin who keeps systems running securely and efficiently",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 0,
				worktreeIsolation: false,
			},
			{
				slug: "analyst",
				name: "Divya",
				role: "Data Analyst",
				model: "ollama:phi4",
				expertise: [
					"data analysis",
					"reporting",
					"SQL",
					"governance metrics",
					"dashboards",
				],
				personality:
					"Thorough analyst who turns raw data into clear governance reports",
				permissionMode: "auto",
				maxTurns: 15,
				costBudgetUsd: 0,
				worktreeIsolation: false,
			},
		],
		totalCostBudgetUsd: 0,
		preSeededSkills: [
			{
				name: "policy-review",
				trigger: "policy-review",
				content:
					"Review this policy document for compliance gaps, ambiguities, and risks. Cross-reference against applicable regulations. Output: summary, compliance gaps found, recommended amendments, risk rating.",
			},
			{
				name: "compliance-check",
				trigger: "compliance-check",
				content:
					"Perform a compliance check on this system/process. Identify: what regulations apply, current compliance status, gaps, remediation steps with priority, and estimated effort to resolve.",
			},
			{
				name: "audit-report",
				trigger: "audit-report",
				content:
					"Generate a formal audit report for this system or process. Include: scope, methodology, findings (critical/high/medium/low), evidence collected, recommendations, and management response template.",
			},
		],
		tags: [
			"governance",
			"compliance",
			"on-premise",
			"local-only",
			"air-gap",
			"government",
		],
	},
	{
		id: "support-team",
		name: "Customer Support Team",
		description:
			"L1, L2, KB writer, and support lead for full customer support coverage",
		category: "support",
		leadSlug: "support-lead",
		members: [
			{
				slug: "support-lead",
				name: "Support Lead",
				role: "Support Lead & Escalation Manager",
				model: "claude-sonnet-4",
				expertise: [
					"escalation management",
					"customer success",
					"support operations",
				],
				personality:
					"Empathetic leader who ensures every customer issue is resolved",
				permissionMode: "plan",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "l1",
				name: "L1 Support",
				role: "Tier-1 Support Specialist",
				model: "claude-haiku-3-5",
				expertise: [
					"FAQ",
					"first response",
					"ticket triage",
					"basic troubleshooting",
				],
				personality:
					"Fast, friendly first responder who resolves common issues quickly",
				permissionMode: "auto",
				maxTurns: 15,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "l2",
				name: "L2 Technical",
				role: "Tier-2 Technical Specialist",
				model: "claude-sonnet-4",
				expertise: [
					"deep technical issues",
					"debugging",
					"API issues",
					"integrations",
				],
				personality:
					"Deep technical expert who resolves complex issues with precision",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
			{
				slug: "kb-writer",
				name: "KB Writer",
				role: "Knowledge Base Author",
				model: "claude-haiku-3-5",
				expertise: ["KB articles", "documentation", "FAQs", "how-to guides"],
				personality:
					"Clear writer who turns support insights into reusable KB articles",
				permissionMode: "auto",
				maxTurns: 15,
				costBudgetUsd: 2,
				worktreeIsolation: false,
			},
		],
		totalCostBudgetUsd: 8,
		preSeededSkills: [],
		tags: ["support", "customer-success", "helpdesk"],
	},
	{
		id: "research",
		name: "Research & Analysis Team",
		description:
			"Research lead, data analyst, literature reviewer, and report writer",
		category: "research",
		leadSlug: "research-lead",
		members: [
			{
				slug: "research-lead",
				name: "Research Lead",
				role: "Principal Researcher",
				model: "claude-opus-4",
				expertise: [
					"research design",
					"hypothesis formation",
					"synthesis",
					"strategy",
				],
				personality:
					"Rigorous researcher who designs studies and synthesises findings",
				permissionMode: "plan",
				maxTurns: 25,
				costBudgetUsd: 6,
				worktreeIsolation: false,
			},
			{
				slug: "data-analyst",
				name: "Data Analyst",
				role: "Data Analyst",
				model: "claude-sonnet-4",
				expertise: [
					"data analysis",
					"statistics",
					"visualisation",
					"SQL",
					"Python",
				],
				personality:
					"Quantitative analyst who turns data into actionable insights",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 3,
				worktreeIsolation: false,
			},
			{
				slug: "lit-reviewer",
				name: "Literature Reviewer",
				role: "Literature Reviewer",
				model: "claude-sonnet-4",
				expertise: [
					"literature review",
					"academic papers",
					"citation analysis",
					"summarisation",
				],
				personality:
					"Thorough reviewer who synthesises academic and industry research",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 3,
				worktreeIsolation: false,
			},
			{
				slug: "report-writer",
				name: "Report Writer",
				role: "Research Report Author",
				model: "claude-haiku-3-5",
				expertise: [
					"report writing",
					"executive summaries",
					"data storytelling",
					"visualisation",
				],
				personality: "Compelling writer who presents research findings clearly",
				permissionMode: "auto",
				maxTurns: 15,
				costBudgetUsd: 3,
				worktreeIsolation: false,
			},
		],
		totalCostBudgetUsd: 15,
		preSeededSkills: [],
		tags: ["research", "analysis", "data"],
	},
	{
		id: "game-studio",
		name: "Game Engineering Team",
		description:
			"Gameplay, systems, and performance team for game feature delivery",
		category: "engineering",
		leadSlug: "game-lead",
		members: [
			{
				slug: "game-lead",
				name: "Aarav",
				role: "Game Engineering Lead",
				model: "claude-sonnet-4",
				expertise: [
					"game architecture",
					"feature planning",
					"team coordination",
					"engine decisions",
				],
				personality:
					"Leads game feature delivery with clear technical direction and scope control",
				permissionMode: "plan",
				maxTurns: 25,
				costBudgetUsd: 3,
				worktreeIsolation: false,
			},
			{
				slug: "gameplay",
				name: "Neel",
				role: "Gameplay Engineer",
				model: "claude-sonnet-4",
				expertise: [
					"gameplay loops",
					"combat systems",
					"state machines",
					"input handling",
				],
				personality:
					"Builds robust gameplay systems with strong edge-case handling",
				permissionMode: "auto",
				maxTurns: 22,
				costBudgetUsd: 2,
				worktreeIsolation: true,
			},
			{
				slug: "performance",
				name: "Ritika",
				role: "Performance Engineer",
				model: "claude-haiku-4",
				expertise: [
					"rendering performance",
					"memory profiling",
					"frame-time optimization",
				],
				personality:
					"Obsessed with stable frame times and production-ready performance",
				permissionMode: "auto",
				maxTurns: 18,
				costBudgetUsd: 1,
				worktreeIsolation: true,
			},
		],
		totalCostBudgetUsd: 8,
		preSeededSkills: [],
		tags: ["game", "gamedev", "engineering", "performance"],
	},
	{
		id: "model-lab",
		name: "Model Creation Team",
		description:
			"Model creator, evaluator, and MLOps flow for custom AI model pipelines",
		category: "research",
		leadSlug: "model-creator",
		members: [
			{
				slug: "model-creator",
				name: "Ira",
				role: "Model Creator",
				model: "claude-opus-4",
				expertise: [
					"fine-tuning strategy",
					"dataset design",
					"training pipelines",
					"alignment",
				],
				personality:
					"Designs practical model training plans with measurable outcomes",
				permissionMode: "plan",
				maxTurns: 24,
				costBudgetUsd: 5,
				worktreeIsolation: false,
			},
			{
				slug: "eval-engineer",
				name: "Yuvraj",
				role: "Evaluation Engineer",
				model: "claude-sonnet-4",
				expertise: [
					"benchmarking",
					"eval sets",
					"statistical analysis",
					"regression checks",
				],
				personality:
					"Builds reliable eval suites to compare and gate model releases",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 3,
				worktreeIsolation: true,
			},
			{
				slug: "mlops",
				name: "Tanvi",
				role: "MLOps Engineer",
				model: "claude-sonnet-4",
				expertise: [
					"training infra",
					"deployment",
					"monitoring",
					"model serving",
				],
				personality:
					"Keeps model pipelines reproducible, scalable, and observable",
				permissionMode: "auto",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: true,
			},
		],
		totalCostBudgetUsd: 12,
		preSeededSkills: [],
		tags: ["ai", "ml", "model-training", "evaluation", "mlops"],
	},
	{
		id: "web3-protocol",
		name: "Web3 & Blockchain Team",
		description:
			"Protocol design, smart contracts, and security-focused Web3 delivery",
		category: "engineering",
		leadSlug: "web3-lead",
		members: [
			{
				slug: "web3-lead",
				name: "Dev",
				role: "Blockchain Architect",
				model: "claude-opus-4",
				expertise: [
					"protocol design",
					"tokenomics",
					"system architecture",
					"chain strategy",
				],
				personality:
					"Designs secure Web3 architectures and reviews protocol tradeoffs",
				permissionMode: "plan",
				maxTurns: 24,
				costBudgetUsd: 5,
				worktreeIsolation: false,
			},
			{
				slug: "solidity",
				name: "Nisha",
				role: "Smart Contract Engineer",
				model: "claude-sonnet-4",
				expertise: ["solidity", "hardhat", "foundry", "defi contracts"],
				personality:
					"Builds contracts with a strong focus on testability and safety",
				permissionMode: "auto",
				maxTurns: 22,
				costBudgetUsd: 3,
				worktreeIsolation: true,
			},
			{
				slug: "web3-security",
				name: "Kabir",
				role: "Blockchain Security Engineer",
				model: "claude-sonnet-4",
				expertise: [
					"reentrancy",
					"oracle risk",
					"flash-loan vectors",
					"formal checks",
				],
				personality:
					"Finds protocol and contract vulnerabilities before production",
				permissionMode: "review",
				maxTurns: 20,
				costBudgetUsd: 2,
				worktreeIsolation: true,
			},
			{
				slug: "onchain-analyst",
				name: "Sia",
				role: "On-chain Analyst",
				model: "claude-haiku-4",
				expertise: [
					"on-chain analytics",
					"wallet behavior",
					"token flow",
					"risk signals",
				],
				personality:
					"Converts chain data into actionable protocol and growth insights",
				permissionMode: "auto",
				maxTurns: 16,
				costBudgetUsd: 1,
				worktreeIsolation: false,
			},
		],
		totalCostBudgetUsd: 12,
		preSeededSkills: [],
		tags: ["web3", "blockchain", "defi", "smart-contracts", "security"],
	},
	{
		id: "mobile-expo",
		name: "Mobile App Team (Expo First)",
		description:
			"Hybrid mobile delivery with Expo/React Native, plus guidance for native fallback",
		category: "engineering",
		leadSlug: "mobile-lead",
		members: [
			{
				slug: "mobile-lead",
				name: "Reyansh",
				role: "Mobile Lead",
				model: "claude-sonnet-4",
				expertise: [
					"mobile architecture",
					"expo-router",
					"release planning",
					"cross-platform UX",
				],
				personality:
					"Leads mobile delivery with Expo-first architecture and production discipline",
				permissionMode: "plan",
				maxTurns: 22,
				costBudgetUsd: 3,
				worktreeIsolation: false,
			},
			{
				slug: "expo-engineer",
				name: "Anvi",
				role: "Expo React Native Engineer",
				model: "claude-sonnet-4",
				expertise: [
					"expo",
					"react-native",
					"ios+android parity",
					"native module integration",
				],
				personality:
					"Builds maintainable cross-platform features quickly with Expo",
				permissionMode: "auto",
				maxTurns: 22,
				costBudgetUsd: 3,
				worktreeIsolation: true,
			},
			{
				slug: "mobile-qa",
				name: "Vihaan",
				role: "Mobile QA Engineer",
				model: "claude-haiku-4",
				expertise: [
					"device testing",
					"regression checks",
					"app store readiness",
					"accessibility",
				],
				personality:
					"Ensures mobile features are reliable across devices and OS versions",
				permissionMode: "auto",
				maxTurns: 16,
				costBudgetUsd: 1,
				worktreeIsolation: false,
			},
		],
		totalCostBudgetUsd: 9,
		preSeededSkills: [],
		tags: ["mobile", "expo", "react-native", "hybrid", "ios", "android"],
	},
];

export function getTemplate(id: string): CompanyTemplate | undefined {
	return COMPANY_TEMPLATES.find((t) => t.id === id);
}
