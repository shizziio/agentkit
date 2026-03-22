import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { AGENTKIT_DIR, CONFIG_FILENAME } from '@config/defaults.js'
import type { ProjectConfig } from './ConfigTypes.js'
import type { RuleFile } from './RulesTypes.js'
import { Logger } from './Logger.js'

const logger = Logger.getOrNoop('RulesService')

const RULES_DIR = '_agentkit-output/rules'

export class RulesService {
  private readonly projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  /**
   * Scan _agentkit-output/rules/ for .md files and return with enabled state.
   */
  listRules(): RuleFile[] {
    const rulesDir = join(this.projectRoot, RULES_DIR)
    if (!existsSync(rulesDir)) return []

    const enabled = new Set(this.getEnabledRules())
    let files: string[]
    try {
      files = readdirSync(rulesDir).filter(f => f.endsWith('.md')).sort()
    } catch {
      return []
    }

    return files.map(name => ({
      name,
      enabled: enabled.has(name),
      path: join(rulesDir, name),
    }))
  }

  /**
   * Read enabled rules list from project config.
   */
  getEnabledRules(): string[] {
    const config = this.readConfig()
    return config?.enabledRules ?? []
  }

  /**
   * Write enabled rules list to project config.
   */
  setEnabledRules(names: string[]): void {
    const configPath = join(this.projectRoot, AGENTKIT_DIR, CONFIG_FILENAME)
    const config = this.readConfig()
    if (!config) return

    const updated = { ...config, enabledRules: names.length > 0 ? names : undefined }
    try {
      writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8')
      logger.info('rules: updated enabled rules', { count: names.length })
    } catch (err) {
      logger.error('rules: failed to save config', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Toggle a rule on/off. Returns the new enabled state.
   */
  toggleRule(name: string): boolean {
    const enabled = this.getEnabledRules()
    const index = enabled.indexOf(name)
    if (index >= 0) {
      enabled.splice(index, 1)
      this.setEnabledRules(enabled)
      return false
    } else {
      enabled.push(name)
      this.setEnabledRules(enabled)
      return true
    }
  }

  /**
   * Load and concatenate content of all enabled rule files.
   * Returns empty string if no rules enabled or files missing.
   */
  loadEnabledContent(): string {
    const rules = this.listRules().filter(r => r.enabled)
    if (rules.length === 0) return ''

    const sections: string[] = []
    for (const rule of rules) {
      try {
        const content = readFileSync(rule.path, 'utf-8').trim()
        if (content) {
          sections.push(`### Rule: ${rule.name}\n${content}`)
        }
      } catch {
        logger.warn('rules: failed to read rule file', { name: rule.name })
      }
    }

    return sections.join('\n\n')
  }

  private readConfig(): ProjectConfig | null {
    const configPath = join(this.projectRoot, AGENTKIT_DIR, CONFIG_FILENAME)
    try {
      const raw = readFileSync(configPath, 'utf-8')
      return JSON.parse(raw) as ProjectConfig
    } catch {
      return null
    }
  }
}
