CREATE TABLE `session_graph_message_copy` (
	`message_id` text PRIMARY KEY NOT NULL,
	`graph_message_id` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`graph_message_id`) REFERENCES `session_graph_message`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `session_graph_message_copy_graph_message_id_idx` ON `session_graph_message_copy` (`graph_message_id`);--> statement-breakpoint
CREATE TABLE `session_graph_message` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `session_graph_turn`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "session_graph_message_role_check" CHECK("session_graph_message"."role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE INDEX `session_graph_message_turn_id_idx` ON `session_graph_message` (`turn_id`);--> statement-breakpoint
CREATE TABLE `session_graph_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
