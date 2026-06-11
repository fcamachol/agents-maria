module.exports = {
  apps: [{
    name: "maria-monitor",
    script: "dist/index.js",
    env: {
      NODE_ENV: "production",
      PORT: 3100,
      LOG_FILE: "/home/fcamacholombardo/.pm2/logs/maria-cea-sdk-out.log",
      MONITOR_TOKEN: ""
    },
    error_file: "./logs/error.log",
    out_file: "./logs/output.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z"
  }]
};
