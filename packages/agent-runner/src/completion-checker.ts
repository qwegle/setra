export interface CompletionCheckResult {
	isComplete: boolean;
	reason: string;
	nextSteps?: string[];
	confidence: number;
}

export const COMPLETION_CHECK_PROMPT = `You are a task completion checker. Given the original task and the work done so far, determine if the task is COMPLETE or needs MORE WORK.

Respond in JSON format:
{
  "isComplete": true/false,
  "reason": "brief explanation",
  "nextSteps": ["step1", "step2"] (only if incomplete),
  "confidence": 0.0-1.0
}

Rules:
- A task is complete when ALL explicit requirements are met
- If tests were requested and they pass, it's likely complete
- If the user asked for multiple things, ALL must be done
- Don't be overly strict — "good enough" with all features present counts
- confidence > 0.8 means you're quite sure`;

export function parseCompletionResponse(
	response: string,
): CompletionCheckResult {
	try {
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]) as Partial<CompletionCheckResult>;
			return {
				isComplete: Boolean(parsed.isComplete),
				reason: String(parsed.reason ?? ""),
				...(Array.isArray(parsed.nextSteps)
					? { nextSteps: parsed.nextSteps }
					: {}),
				confidence:
					typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
			};
		}
	} catch {
		// Fall through to default.
	}

	const lower = response.toLowerCase();
	const isComplete =
		lower.includes("complete") &&
		!lower.includes("not complete") &&
		!lower.includes("incomplete");
	return {
		isComplete,
		reason: response.slice(0, 200),
		confidence: 0.3,
	};
}

export function shouldContinue(
	result: CompletionCheckResult,
	threshold = 0.7,
): boolean {
	if (result.isComplete && result.confidence >= threshold) {
		return false;
	}
	if (!result.isComplete) {
		return true;
	}
	return false;
}
