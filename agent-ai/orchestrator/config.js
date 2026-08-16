// 9Router UAT endpoint + key. Override via env N9ROUTER_BASE_URL / N9ROUTER_API_KEY.
const BASE_URL = process.env.N9ROUTER_BASE_URL || 'http://192.168.1.33:20130';
const API_KEY = process.env.N9ROUTER_API_KEY || 'sk-a9199bb7b055a6d0-j03vej-95a27b54';

// Agent -> 9Router combo (doc §3). Only verified CLIs: claude, codex, gemini.
const AGENT_COMBO = {
  claude: '1-reasoning', // architect (read-only)
  codex: '1-coding-max', // backend
  gemini: '2-reasoning', // research (read-only)
};

module.exports = { BASE_URL, API_KEY, AGENT_COMBO };