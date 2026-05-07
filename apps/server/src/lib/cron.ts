/**
 * Minimal cron expression matcher for 5-field cron: min hour dom month dow.
 * Supports wildcards, specific values, ranges (1-5), step values, and lists (1,3,5).
 */

function range(min: number, max: number): number[] {
	const values: number[] = [];
	for (let value = min; value <= max; value++) values.push(value);
	return values;
}

export function parseCronField(
	field: string,
	min: number,
	max: number,
): number[] {
	if (field === "*") return range(min, max);

	const values = new Set<number>();
	for (const part of field.split(",")) {
		if (!part) continue;
		if (part.includes("/")) {
			const [rangeStr, stepStr] = part.split("/");
			const step = Number.parseInt(stepStr ?? "", 10);
			if (!Number.isInteger(step) || step <= 0) return [];
			const [start, end] =
				rangeStr === "*"
					? [min, max]
					: (rangeStr ?? "")
							.split("-")
							.map((value) => Number.parseInt(value, 10));
			if (
				!Number.isInteger(start) ||
				!Number.isInteger(end) ||
				start! < min ||
				end! > max ||
				start! > end!
			) {
				return [];
			}
			for (let value = start!; value <= end!; value += step) values.add(value);
			continue;
		}
		if (part.includes("-")) {
			const [start, end] = part
				.split("-")
				.map((value) => Number.parseInt(value, 10));
			if (
				!Number.isInteger(start) ||
				!Number.isInteger(end) ||
				start! < min ||
				end! > max ||
				start! > end!
			) {
				return [];
			}
			for (let value = start!; value <= end!; value++) values.add(value);
			continue;
		}
		const value = Number.parseInt(part, 10);
		if (!Number.isInteger(value) || value < min || value > max) return [];
		values.add(value);
	}

	return [...values].sort((left, right) => left - right);
}

export function cronMatches(
	expression: string,
	date: Date = new Date(),
): boolean {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) return false;

	const [minField, hourField, domField, monthField, dowField] = parts;
	const minute = date.getMinutes();
	const hour = date.getHours();
	const dom = date.getDate();
	const month = date.getMonth() + 1;
	const dow = date.getDay();

	return (
		parseCronField(minField ?? "", 0, 59).includes(minute) &&
		parseCronField(hourField ?? "", 0, 23).includes(hour) &&
		parseCronField(domField ?? "", 1, 31).includes(dom) &&
		parseCronField(monthField ?? "", 1, 12).includes(month) &&
		parseCronField(dowField ?? "", 0, 6).includes(dow)
	);
}

export function nextCronOccurrence(
	expression: string,
	afterDate: Date = new Date(),
): Date | null {
	if (expression.trim().split(/\s+/).length !== 5) return null;
	const cursor = new Date(afterDate);
	cursor.setSeconds(0, 0);
	cursor.setMinutes(cursor.getMinutes() + 1);
	for (let i = 0; i < 60 * 24 * 366; i++) {
		if (cronMatches(expression, cursor)) return new Date(cursor);
		cursor.setMinutes(cursor.getMinutes() + 1);
	}
	return null;
}

/** Human-readable description of a cron expression */
export function describeCron(expression: string): string {
	const presets: Record<string, string> = {
		"* * * * *": "Every minute",
		"*/5 * * * *": "Every 5 minutes",
		"*/15 * * * *": "Every 15 minutes",
		"*/30 * * * *": "Every 30 minutes",
		"0 * * * *": "Every hour",
		"0 */2 * * *": "Every 2 hours",
		"0 */6 * * *": "Every 6 hours",
		"0 0 * * *": "Daily at midnight",
		"0 9 * * *": "Daily at 9 AM",
		"0 9 * * 1-5": "Weekdays at 9 AM",
		"0 0 * * 1": "Weekly on Monday",
	};
	return presets[expression] ?? `Cron: ${expression}`;
}
