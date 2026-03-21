import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const iso8601Now = sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`;

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectName: text("project_name").notNull().unique(),
  owner: text("owner"),
  activeTeam: text("active_team").notNull().default("agentkit"),
  createdAt: text("created_at").notNull().default(iso8601Now),
  updatedAt: text("updated_at").notNull().default(iso8601Now),
  version: integer("version").notNull().default(1),
});

export const epics = sqliteTable(
  "epics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    epicKey: text("epic_key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    contentHash: text("content_hash"),
    sourceFile: text("source_file"),
    orderIndex: integer("order_index").notNull(),
    dependsOn: text("depends_on"),
    team: text("team"),
    createdAt: text("created_at").notNull().default(iso8601Now),
    updatedAt: text("updated_at").notNull().default(iso8601Now),
    version: integer("version").notNull().default(1),
  },
  (table) => ({
    uniqEpicsProjectEpic: uniqueIndex("uq_epics_project_epic").on(
      table.projectId,
      table.epicKey,
    ),
  }),
);

export const stories = sqliteTable(
  "stories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    epicId: integer("epic_id")
      .notNull()
      .references(() => epics.id, { onDelete: "cascade" }),
    storyKey: text("story_key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    content: text("content"),
    status: text("status").notNull().default("draft"),
    contentHash: text("content_hash"),
    orderIndex: integer("order_index").notNull(),
    createdAt: text("created_at").notNull().default(iso8601Now),
    updatedAt: text("updated_at").notNull().default(iso8601Now),
    priority: integer("priority").notNull().default(0),
    sessionInfo: text("session_info"),
    dependsOn: text("depends_on"),
    waitingStage: text("waiting_stage"),
    version: integer("version").notNull().default(1),
  },
  (table) => ({
    uniqStoriesEpicStory: uniqueIndex("uq_stories_epic_story").on(
      table.epicId,
      table.storyKey,
    ),
  }),
);

export const tasks: any = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storyId: integer("story_id")
      .notNull()
      .references(() => stories.id),
    parentId: integer("parent_id").references((): any => tasks.id),
    team: text("team").notNull().default("agentkit"),
    stageName: text("stage_name").notNull(),
    status: text("status").notNull().default("queued"),
    prompt: text("prompt"),
    input: text("input"),
    output: text("output"),
    workerModel: text("worker_model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    attempt: integer("attempt").notNull().default(1),
    sessionName: text("session_name"),
    superseded: integer("superseded").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    durationMs: integer("duration_ms"),
    createdAt: text("created_at").notNull().default(iso8601Now),
    updatedAt: text("updated_at").notNull().default(iso8601Now),
    version: integer("version").notNull().default(1),
  },
  (table) => ({
    idxTasksStageStatus: index("idx_tasks_stage_status").on(
      table.stageName,
      table.status,
    ),
    idxTasksTeamStageStatus: index("idx_tasks_team_stage_status").on(
      table.team,
      table.stageName,
      table.status,
    ),
  }),
);

export const taskLogs = sqliteTable(
  "task_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    eventData: text("event_data").notNull(),
    createdAt: text("created_at").notNull().default(iso8601Now),
  },
  (table) => ({
    idxTaskLogsTaskSequence: index("idx_task_logs_task_sequence").on(
      table.taskId,
      table.sequence,
    ),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Epic = typeof epics.$inferSelect;
export type NewEpic = typeof epics.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskLog = typeof taskLogs.$inferSelect;
export type NewTaskLog = typeof taskLogs.$inferInsert;
