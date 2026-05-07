import { EventEmitter } from "node:events";
import type { EventBus } from "@setra/domain";

export class InMemoryEventBus<TEvent extends { type: string }>
	implements EventBus<TEvent>
{
	private readonly emitter = new EventEmitter();

	publish(event: TEvent): void {
		this.emitter.emit(event.type, event);
		this.emitter.emit("*", event);
	}

	subscribe(
		type: TEvent["type"] | "*",
		handler: (event: TEvent) => void,
	): () => void {
		this.emitter.on(type, handler);
		return () => this.emitter.off(type, handler);
	}
}
