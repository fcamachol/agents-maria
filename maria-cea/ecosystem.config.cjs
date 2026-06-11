module.exports = {
  apps: [{
    name: 'maria-cea',
    script: 'dist/index.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 3002,
      CHATWOOT_BASE_URL: 'https://agora.humansoftware.mx',
      CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      SERVER_BASE_URL: 'https://info-cea.cea-info.workers.dev',
      RECIBO_TOKEN_SECRET: process.env.RECIBO_TOKEN_SECRET
    },
    env_production: {
      NODE_ENV: 'production'
    },
    error_file: '/home/fcamacholombardo/logs/maria-cea-error.log',
    out_file: '/home/fcamacholombardo/logs/maria-cea-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
