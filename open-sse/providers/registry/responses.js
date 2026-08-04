export default {
  id: "cheapkey",
  priority: 50,
  alias: "cheapkey",
  display: {
    name: "Cheap Key",
    icon: "key",
    color: "#4CAF50",
    textIcon: "CK",
    website: "https://cheapkeyai.shop/",
    notice: {
      apiKeyUrl: "https://cheapkeyai.shop/",
    },
  },
  category: "apikey",
  authType: "apikey",
  pricingTier: "cheap",
  transport: {
    baseUrl: "https://cheapkeyai.shop/v1/chat/completions",
    validateUrl: "https://cheapkeyai.shop/v1/models",
  },
  models: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 SOL" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "grok-4.5", name: "Grok 4.5" },
    { id: "composer-2.5-fast", name: "Composer 2.5 Fast" },
  ],
};
