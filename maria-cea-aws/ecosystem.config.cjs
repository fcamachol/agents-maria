module.exports = {
  apps: [{
    name: 'maria-cea-aws',
    script: 'dist/index.js',
    cwd: '/home/fcamacholombardo/maria-cea-aws',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3004,
      CHATWOOT_BASE_URL: 'https://agora.ceaqueretaro.gob.mx',
      CHATWOOT_API_TOKEN: 'Gee5gfvSjUxfaLg8mH7aARNx',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      SERVER_BASE_URL: 'https://info-cea.cea-info.workers.dev',
      RECIBO_TOKEN_SECRET: 'ce983fa48ee73949da8b06dc8b0ca2d8e3f5d3457707da6af4ac8bb66672dce9'
    },
    error_file: '/home/fcamacholombardo/logs/maria-cea-aws-error.log',
    out_file: '/home/fcamacholombardo/logs/maria-cea-aws-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
