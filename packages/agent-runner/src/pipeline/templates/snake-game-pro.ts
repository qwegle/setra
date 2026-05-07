import { Pipeline, type PipelineConfig } from "../base-graph.js";
import { LlmNode } from "../nodes/index.js";

interface SnakeGameTemplateNode {
	id: string;
	type: "llm";
	role: "ceo" | "cto" | "dev";
	prompt: string;
	dependsOn?: string[];
}

export const snakeGameProTemplate: {
	name: string;
	description: string;
	nodes: SnakeGameTemplateNode[];
} = {
	name: "snake-game-pro",
	description:
		"Production-quality snake game with Phaser.js, multiple skins, sound effects, particles, mobile controls, and leaderboard",
	nodes: [
		{
			id: "game-design",
			type: "llm",
			role: "ceo",
			prompt: `Create a Game Design Document for a professional snake game:
        
        ## Required Features:
        1. **Visuals**: 
           - 4 snake skins: Classic Green, Neon Glow, Fire, Ice
           - Animated food items (pulse/rotate/sparkle)
           - Particle effects on eat (burst) and death (explosion)
           - Grid background with subtle animation
           - Smooth bezier snake movement (not choppy grid)
        
        2. **Audio**:
           - Background ambient music (loopable, 8-bit style)
           - Eat sound (satisfying crunch)
           - Death sound (dramatic)
           - Level up sound
           - Use Howler.js for audio management
        
        3. **Game Modes**:
           - Classic: standard snake
           - Timed: 60-second challenge, eat as much as possible
           - Maze: walls/obstacles that change each level
        
        4. **Features**:
           - High score with localStorage persistence
           - 5 difficulty levels (snake speed 100ms → 40ms)
           - Power-ups: Speed Boost (2s), Shield (1 hit), Double Points (5s), Slow Motion (3s)
           - Mobile: swipe controls + on-screen d-pad
           - Desktop: arrow keys + WASD
           - Pause/Resume (ESC or tap pause button)
           - Game Over screen: score, high score, retry, share
           - Responsive: works 320px → 4K
        
        5. **Tech Stack**:
           - Phaser 3 (game framework)
           - TypeScript
           - Howler.js (audio)
           - Vite (build tool)
           - Single HTML deploy (all assets inlined or CDN)
        
        6. **Landing Page**:
           - Professional hero section
           - Game embedded in center
           - Feature highlights below
           - "Built by Setra AI Agents" badge
        
        Output a structured GDD with all specifications.`,
		},
		{
			id: "architecture",
			type: "llm",
			role: "cto",
			dependsOn: ["game-design"],
			prompt:
				"Based on the Game Design Document, create the technical architecture: file structure, class diagram (Mermaid), state machine for game states, Phaser scene hierarchy. Include performance targets: 60fps, <100ms input latency, <5MB total bundle.",
		},
		{
			id: "implementation",
			type: "llm",
			role: "dev",
			dependsOn: ["architecture"],
			prompt:
				"Implement the full snake game based on the GDD and architecture. Use Phaser 3 + TypeScript + Vite. Create ALL files needed for a complete, running game. Include: all 4 snake skins as procedural graphics, particle systems, audio integration with Howler.js, mobile touch controls, leaderboard with localStorage. Make it production-quality.",
		},
		{
			id: "review",
			type: "llm",
			role: "cto",
			dependsOn: ["implementation"],
			prompt:
				"Review the snake game code for: 60fps performance (no memory leaks, efficient collision detection), mobile compatibility, accessibility, code quality. Produce a structured review report. Check: requestAnimationFrame usage, proper Phaser lifecycle, asset cleanup on scene change.",
		},
		{
			id: "landing-page",
			type: "llm",
			role: "dev",
			dependsOn: ["implementation"],
			prompt:
				"Create a stunning landing page that embeds the snake game. Dark theme, gradient background, feature highlights, responsive. Include meta tags for social sharing. The page should look like a professional indie game landing page.",
		},
	],
};

const NODE_OUTPUT_KEYS: Record<string, string> = {
	"game-design": "game_design",
	architecture: "architecture",
	implementation: "implementation",
	review: "review",
	"landing-page": "landing_page",
};

const NODE_CONTEXT_KEYS: Record<string, string[]> = {
	architecture: ["game_design"],
	implementation: ["game_design", "architecture"],
	review: ["game_design", "architecture", "implementation"],
	"landing-page": ["game_design", "implementation"],
};

const CONTEXT_LABELS: Record<string, string> = {
	game_design: "Game Design Document",
	architecture: "Technical Architecture",
	implementation: "Implementation Output",
	review: "Review Report",
	landing_page: "Landing Page",
};

function buildPromptTemplate(node: SnakeGameTemplateNode): string {
	const contextKeys = NODE_CONTEXT_KEYS[node.id] ?? [];
	const contextSections = contextKeys.map(
		(key) => `\n\n${CONTEXT_LABELS[key] ?? key}:\n{{${key}}}`,
	);
	return `${node.prompt}${contextSections.join("")}`;
}

export const snakeGameProPipelineConfig: PipelineConfig = {
	name: snakeGameProTemplate.name,
	description: snakeGameProTemplate.description,
	entryPoint: snakeGameProTemplate.nodes[0]!.id,
	nodes: snakeGameProTemplate.nodes.map(
		(node) =>
			new LlmNode({
				name: node.id,
				inputs: [...(NODE_CONTEXT_KEYS[node.id] ?? []), "__llmCall"].join(
					" & ",
				),
				outputs: [NODE_OUTPUT_KEYS[node.id] ?? node.id.replace(/-/g, "_")],
				nodeConfig: {
					outputKey: NODE_OUTPUT_KEYS[node.id] ?? node.id.replace(/-/g, "_"),
					promptTemplate: buildPromptTemplate(node),
				},
			}),
	),
	edges: snakeGameProTemplate.nodes.flatMap((node) =>
		(node.dependsOn ?? []).map((dependency) => ({
			from: dependency,
			to: node.id,
		})),
	),
};

export function createSnakeGameProPipeline(): Pipeline {
	return new Pipeline(snakeGameProPipelineConfig);
}
