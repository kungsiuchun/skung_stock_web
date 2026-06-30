# Store SPX Agent Calibration Outcomes In D1

Accepted: the SPX Telegram Trading Council stores per-agent SPX level signals and later 15-minute outcomes in D1, instead of keeping calibration only in KV. This is a durable audit choice: KV is fine for same-day memory, but agent calibration needs queryable historical samples, stable weighting, and recap-adjacent inspection without pretending the bot is choosing option contracts or broker execution.
