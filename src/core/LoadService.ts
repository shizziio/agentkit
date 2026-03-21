import { eq, and, sql } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import { epics, stories } from '@core/db/schema.js';
import { LoadError } from '@core/Errors.js';
import type { ParsedContent } from '@core/ParserTypes.js';
import type {
  ComparisonResult,
  EpicComparison,
  StoryComparison,
  LoadResult,
  ILoadService,
} from '@core/LoadTypes.js';
import { Logger } from '@core/Logger.js';
import { validateDAG, checkDanglingRefs } from '@core/DagValidator.js';

const logger = Logger.getOrNoop('LoadService');

export class LoadService implements ILoadService {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  normalizePath(rawPath: string): string {
    let result = rawPath.trim();
    if (
      (result.startsWith("'") && result.endsWith("'")) ||
      (result.startsWith('"') && result.endsWith('"'))
    ) {
      result = result.slice(1, -1);
    }
    result = result.replace(/\\ /g, ' ');
    if (result.length === 0) {
      throw new LoadError('File path cannot be empty');
    }
    return result;
  }

  compareWithDatabase(
    projectId: number,
    parsed: ParsedContent,
  ): ComparisonResult {
    const epicComparisons: EpicComparison[] = [];
    let newEpics = 0, updatedEpics = 0, skippedEpics = 0;
    let newStories = 0, updatedStories = 0, skippedStories = 0;

    for (const parsedEpic of parsed.epics) {
      const existing = this.db
        .select()
        .from(epics)
        .where(and(eq(epics.projectId, projectId), eq(epics.epicKey, parsedEpic.key)))
        .get();

      const storyComparisons: StoryComparison[] = [];

      if (!existing) {
        newEpics++;
        for (const parsedStory of parsedEpic.stories) {
          newStories++;
          storyComparisons.push({
            status: 'new',
            storyKey: parsedStory.key,
            title: parsedStory.title,
            parsedStory,
            newHash: parsedStory.contentHash,
            newContent: parsedStory.content,
          });
        }
        epicComparisons.push({
          status: 'new',
          epicKey: parsedEpic.key,
          title: parsedEpic.title,
          parsedEpic,
          newHash: parsedEpic.contentHash,
          storyComparisons,
        });
      } else {
        for (const parsedStory of parsedEpic.stories) {
          const existingStory = this.db
            .select()
            .from(stories)
            .where(and(eq(stories.epicId, existing.id), eq(stories.storyKey, parsedStory.key)))
            .get();

          if (!existingStory) {
            newStories++;
            storyComparisons.push({
              status: 'new',
              storyKey: parsedStory.key,
              title: parsedStory.title,
              parsedStory,
              newHash: parsedStory.contentHash,
              newContent: parsedStory.content,
            });
          } else if (existingStory.contentHash !== parsedStory.contentHash) {
            updatedStories++;
            storyComparisons.push({
              status: 'updated',
              storyKey: parsedStory.key,
              title: parsedStory.title,
              parsedStory,
              existingId: existingStory.id,
              oldHash: existingStory.contentHash ?? undefined,
              newHash: parsedStory.contentHash,
              oldContent: existingStory.content ?? undefined,
              newContent: parsedStory.content,
            });
          } else {
            skippedStories++;
            logger.debug('load: skipped story', { storyKey: parsedStory.key });
            storyComparisons.push({
              status: 'skipped',
              storyKey: parsedStory.key,
              title: parsedStory.title,
              parsedStory,
              existingId: existingStory.id,
              oldHash: existingStory.contentHash ?? undefined,
              newHash: parsedStory.contentHash,
              newContent: parsedStory.content,
            });
          }
        }

        if (existing.contentHash !== parsedEpic.contentHash) {
          updatedEpics++;
          epicComparisons.push({
            status: 'updated',
            epicKey: parsedEpic.key,
            title: parsedEpic.title,
            parsedEpic,
            existingId: existing.id,
            oldHash: existing.contentHash ?? undefined,
            newHash: parsedEpic.contentHash,
            storyComparisons,
          });
        } else {
          skippedEpics++;
          epicComparisons.push({
            status: 'skipped',
            epicKey: parsedEpic.key,
            title: parsedEpic.title,
            parsedEpic,
            existingId: existing.id,
            oldHash: existing.contentHash ?? undefined,
            newHash: parsedEpic.contentHash,
            storyComparisons,
          });
        }
      }
    }

    return {
      epics: epicComparisons,
      summary: {
        newEpics,
        updatedEpics,
        skippedEpics,
        newStories,
        updatedStories,
        skippedStories,
      },
    };
  }

  saveToDatabase(
    projectId: number,
    comparison: ComparisonResult,
    sourceFile: string,
  ): LoadResult {
    logger.info('load: starting', { sourceFile });
    let insertedEpics = 0, updatedEpics = 0;
    let insertedStories = 0, updatedStories = 0;
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    // Collect story dep nodes for validation
    const depNodes = comparison.epics.flatMap((e) =>
      e.storyComparisons.map((s) => ({
        key: s.parsedStory.key,
        dependsOn: s.parsedStory.dependsOn ?? [],
      })),
    );

    // Warn on dangling refs (non-blocking)
    checkDanglingRefs(depNodes, logger);

    // Validate story DAG — throw before any DB writes if cycle detected
    const dagResult = validateDAG(depNodes);
    if (!dagResult.valid) {
      throw new LoadError(
        'Story dependency cycle detected: ' + (dagResult.cycle ?? []).join(' → '),
      );
    }

    // Validate epic DAG — cross-epic dependency cycles
    const epicDepNodes = comparison.epics.map((e) => ({
      key: e.parsedEpic.key,
      dependsOn: e.parsedEpic.dependsOn ?? [],
    }));
    const epicDagResult = validateDAG(epicDepNodes);
    if (!epicDagResult.valid) {
      throw new LoadError(
        'Epic dependency cycle detected: ' + (epicDagResult.cycle ?? []).join(' → '),
      );
    }

    try {
      this.db.transaction((tx) => {
        for (const epicComp of comparison.epics) {
          let epicId: number;

          if (epicComp.status === 'new') {
            const epicDepsJson =
              epicComp.parsedEpic.dependsOn?.length
                ? JSON.stringify(epicComp.parsedEpic.dependsOn)
                : null;
            const inserted = tx
              .insert(epics)
              .values({
                projectId,
                epicKey: epicComp.parsedEpic.key,
                title: epicComp.parsedEpic.title,
                description: epicComp.parsedEpic.description,
                contentHash: epicComp.newHash,
                sourceFile,
                orderIndex: epicComp.parsedEpic.orderIndex,
                dependsOn: epicDepsJson,
                team: epicComp.parsedEpic.team ?? null,
              })
              .returning({ id: epics.id })
              .get();
            epicId = inserted.id;
            insertedEpics++;
          } else if (epicComp.status === 'updated') {
            epicId = epicComp.existingId!;
            const epicDepsJson =
              epicComp.parsedEpic.dependsOn?.length
                ? JSON.stringify(epicComp.parsedEpic.dependsOn)
                : null;
            tx.update(epics)
              .set({
                title: epicComp.parsedEpic.title,
                description: epicComp.parsedEpic.description,
                contentHash: epicComp.newHash,
                sourceFile,
                orderIndex: epicComp.parsedEpic.orderIndex,
                dependsOn: epicDepsJson,
                team: epicComp.parsedEpic.team ?? null,
                updatedAt: now,
                version: sql`${epics.version} + 1`,
              })
              .where(eq(epics.id, epicId))
              .run();
            updatedEpics++;
          } else {
            epicId = epicComp.existingId!;
          }

          for (const storyComp of epicComp.storyComparisons) {
            const depsJson =
              storyComp.parsedStory.dependsOn?.length
                ? JSON.stringify(storyComp.parsedStory.dependsOn)
                : null;

            if (storyComp.status === 'new') {
              tx.insert(stories)
                .values({
                  epicId,
                  storyKey: storyComp.parsedStory.key,
                  title: storyComp.parsedStory.title,
                  content: storyComp.parsedStory.content,
                  contentHash: storyComp.newHash,
                  orderIndex: storyComp.parsedStory.orderIndex,
                  dependsOn: depsJson,
                })
                .run();
              insertedStories++;
            } else if (storyComp.status === 'updated') {
              tx.update(stories)
                .set({
                  title: storyComp.parsedStory.title,
                  content: storyComp.parsedStory.content,
                  contentHash: storyComp.newHash,
                  orderIndex: storyComp.parsedStory.orderIndex,
                  dependsOn: depsJson,
                  updatedAt: now,
                  version: sql`${stories.version} + 1`,
                })
                .where(eq(stories.id, storyComp.existingId!))
                .run();
              updatedStories++;
            }
          }
        }
      });

      logger.info('load: complete', { insertedEpics, updatedEpics, insertedStories, updatedStories });
      return { insertedEpics, updatedEpics, insertedStories, updatedStories };
    } catch (err: unknown) {
      logger.error('load: db write failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
