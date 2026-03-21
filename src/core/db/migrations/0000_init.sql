-- AgentKit v0.0.1 — Initial schema (consolidated from migrations 0000-0006)

CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_name` text NOT NULL,
	`owner` text,
	`active_team` text DEFAULT 'agentkit' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_project_name_unique` ON `projects` (`project_name`);
--> statement-breakpoint
CREATE TABLE `epics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`epic_key` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`content_hash` text,
	`source_file` text,
	`order_index` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_epics_project_epic` ON `epics` (`project_id`,`epic_key`);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`epic_id` integer NOT NULL,
	`story_key` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`content` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`content_hash` text,
	`order_index` integer NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`session_info` text,
	`depends_on` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stories_epic_story` ON `stories` (`epic_id`,`story_key`);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` integer NOT NULL,
	`parent_id` integer,
	`team` text DEFAULT 'agentkit' NOT NULL,
	`stage_name` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`prompt` text,
	`input` text,
	`output` text,
	`worker_model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`attempt` integer DEFAULT 1 NOT NULL,
	`session_name` text,
	`superseded` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`duration_ms` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_stage_status` ON `tasks` (`stage_name`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_team_stage_status` ON `tasks` (`team`,`stage_name`,`status`);
--> statement-breakpoint
CREATE TABLE `task_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`event_data` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_task_logs_task_sequence` ON `task_logs` (`task_id`,`sequence`);
