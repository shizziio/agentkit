import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { AGENTKIT_DIR } from '@config/defaults.js'
import type { SetupStep, ReadinessResult, SetupStatus } from './ReadinessTypes.js'

const REQUIRED_DOCS = [
  'docs/architecture.md',
  'docs/architecture-rules.md',
  'docs/project-context.md',
]

export class ReadinessChecker {
  private readonly projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  check(): ReadinessResult {
    const steps: SetupStep[] = [
      this.checkProjectDocs(),
      this.checkTeamConfig(),
      this.checkEpicPlans(),
    ]

    const allReady = steps.every(s => s.status !== 'missing')
    return { allReady, steps }
  }

  private resolveResourcePath(relativePath: string): string {
    // Try local _agent_kit/resources/ first, then project root
    const localPath = join(this.projectRoot, AGENTKIT_DIR, 'resources', relativePath)
    if (existsSync(localPath)) return localPath
    return localPath // Return local path even if missing — InteractiveSession will handle
  }

  private checkProjectDocs(): SetupStep {
    const found = REQUIRED_DOCS.filter(doc =>
      existsSync(join(this.projectRoot, doc)),
    )
    const total = REQUIRED_DOCS.length

    let status: SetupStatus
    if (found.length === total) {
      status = 'ready'
    } else if (found.length > 0) {
      status = 'partial'
    } else {
      status = 'missing'
    }

    return {
      id: 'project-docs',
      label: 'Project Documentation',
      status,
      detail: `${found.length}/${total} required docs found`,
      provider: {
        promptFiles: [
          this.resolveResourcePath('agents/tech-writer.md'),
          this.resolveResourcePath('workflows/document-project.md'),
        ],
        description: 'Spawn AI agent to scan codebase and generate project docs',
      },
    }
  }

  private checkTeamConfig(): SetupStep {
    const teamsDir = join(this.projectRoot, AGENTKIT_DIR, 'teams')
    if (!existsSync(teamsDir)) {
      return {
        id: 'team-config',
        label: 'Team Configuration',
        status: 'missing',
        detail: 'No teams directory found',
        blockedBy: ['project-docs'],
        provider: {
          promptFiles: [
            this.resolveResourcePath('workflows/create-team.md'),
          ],
          description: 'Spawn AI agent to create and configure a pipeline team',
        },
      }
    }

    let teamDirs: string[] = []
    try {
      teamDirs = readdirSync(teamsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
    } catch {
      // ignore
    }

    if (teamDirs.length === 0) {
      return {
        id: 'team-config',
        label: 'Team Configuration',
        status: 'missing',
        detail: 'No teams configured',
        blockedBy: ['project-docs'],
        provider: {
          promptFiles: [
            this.resolveResourcePath('workflows/create-team.md'),
          ],
          description: 'Spawn AI agent to create and configure a pipeline team',
        },
      }
    }

    // Check if any team has prompt files
    const hasPrompts = teamDirs.some(team => {
      const promptsDir = join(teamsDir, team, 'prompts')
      if (!existsSync(promptsDir)) return false
      try {
        return readdirSync(promptsDir).some(f => f.endsWith('.md'))
      } catch {
        return false
      }
    })

    return {
      id: 'team-config',
      label: 'Team Configuration',
      status: hasPrompts ? 'ready' : 'partial',
      detail: hasPrompts
        ? `${teamDirs.length} team(s) configured`
        : 'Team exists but no prompts found',
      blockedBy: ['project-docs'],
      provider: {
        promptFiles: [
          this.resolveResourcePath('workflows/create-team.md'),
        ],
        description: 'Spawn AI agent to create and configure a pipeline team',
      },
    }
  }

  private checkEpicPlans(): SetupStep {
    const planningDir = join(this.projectRoot, '_agentkit-output', 'planning')
    let epicDirs: string[] = []

    if (existsSync(planningDir)) {
      try {
        epicDirs = readdirSync(planningDir, { withFileTypes: true })
          .filter(d => d.isDirectory() && /^epic-\d+$/.test(d.name))
          .map(d => d.name)
      } catch {
        // ignore
      }
    }

    if (epicDirs.length === 0) {
      return {
        id: 'epic-plans',
        label: 'Epic Plans',
        status: 'missing',
        detail: 'No epics planned',
        blockedBy: ['project-docs', 'team-config'],
        provider: {
          promptFiles: [
            this.resolveResourcePath('agents/architect.md'),
            this.resolveResourcePath('workflows/planning.md'),
          ],
          description: 'Spawn AI agent to design and plan epics & stories',
        },
      }
    }

    return {
      id: 'epic-plans',
      label: 'Epic Plans',
      status: 'ready',
      detail: `${epicDirs.length} epic(s) planned`,
      blockedBy: ['project-docs', 'team-config'],
      provider: {
        promptFiles: [
          this.resolveResourcePath('agents/architect.md'),
          this.resolveResourcePath('workflows/planning.md'),
        ],
        description: 'Spawn AI agent to design and plan epics & stories',
      },
    }
  }
}
