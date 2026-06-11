module.exports = {
  apps: [{
    name: 'maria-claude-test',
    script: 'dist/index.js',
    cwd: '/home/fcamacholombardo/maria-claude-test',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3003,
      CHATWOOT_BASE_URL: 'https://agora.humansoftware.mx',
      CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      SERVER_BASE_URL: 'https://info-cea.cea-info.workers.dev',
      RECIBO_TOKEN_SECRET: process.env.RECIBO_TOKEN_SECRET
    },
    error_file: '/home/fcamacholombardo/logs/maria-claude-test-error.log',
    out_file: '/home/fcamacholombardo/logs/maria-claude-test-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
