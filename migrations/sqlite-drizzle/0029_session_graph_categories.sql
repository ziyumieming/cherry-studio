CREATE TABLE `session_graph_category` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `session_graph_category`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "session_graph_category_parent_check" CHECK("session_graph_category"."parent_id" IS NULL OR "session_graph_category"."parent_id" != "session_graph_category"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_graph_category_sibling_name_idx` ON `session_graph_category` (`parent_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_graph_category_root_name_idx` ON `session_graph_category` (`name`) WHERE "session_graph_category"."parent_id" IS NULL;--> statement-breakpoint
CREATE TABLE `session_graph_topic_category` (
	`topic_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`topic_id`, `category_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `session_graph_category`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `session_graph_topic_category_category_id_idx` ON `session_graph_topic_category` (`category_id`);