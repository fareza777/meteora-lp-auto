process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
process.env.SIGNER_VAULT_KEY = "11".repeat(32);
process.env.DATABASE_PATH = ":memory:";
process.env.SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
process.env.SOLANA_CLUSTER = "mainnet-beta";
process.env.LIVE_TRADING_ENABLED = "false";
process.env.DEV_LOGIN_ENABLED = "false";
process.env.PAPER_STARTING_BALANCE = "25000";
