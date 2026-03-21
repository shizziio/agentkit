export const DEFAULT_POLL_INTERVAL = 3000
export const MAX_POLL_INTERVAL = 30000
export const BACKOFF_MULTIPLIER = 1.5
export const MAX_RETRY = 3
export const MAX_CHAIN_LENGTH = 10
export const BUSY_TIMEOUT = 5000
export const LOG_BATCH_SIZE = 50
export const LOG_FLUSH_INTERVAL = 500

export const AGENTKIT_DIR = '_agent_kit'
export const CONFIG_FILENAME = 'agentkit.config.json'
export const DB_FILENAME = 'agentkit.db'
export const DEFAULT_TEAM = 'agentkit'
export const DEFAULT_PROVIDER = 'claude-cli'

export const QUEUE_WARN_THRESHOLD = 4
export const QUEUE_DANGER_THRESHOLD = 8

export const DB_SIZE_WARN_THRESHOLD = 524288000 // 500 * 1024 * 1024 bytes

export const MAX_ACTIVITY_EVENTS = 500
export const ACTIVITY_VISIBLE_ROWS = 20
// BrandHeader (5 rows total: 2 borders, 2 text lines, 1 padding row)
export const DASHBOARD_CHROME_ROWS = 5

export const LOG_FILE_MAX_SIZE = 10 * 1024 * 1024
export const LOG_MAX_BACKUPS = 3

export const APP_NAME = 'AgentKit'
export const APP_VERSION = '1.0.0'
