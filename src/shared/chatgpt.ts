/** Renderer-safe account details only. OAuth credentials stay in main. */
export interface ChatGptAccount {
  id: string
  label: string
  connected: boolean
  planUsageEnabled: boolean
}

export interface ChatGptModel { id: string; label: string }

export interface ChatGptStatus {
  accounts: ChatGptAccount[]
  activeAccountId: string | null
  signingIn: boolean
  models: ChatGptModel[]
  welcomePending: boolean
}

export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage'
