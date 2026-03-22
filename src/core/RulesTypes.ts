export interface RuleFile {
  /** File name (e.g. "no-any-types.md") */
  name: string
  /** Whether the rule is currently enabled */
  enabled: boolean
  /** Absolute path to the rule file */
  path: string
}
