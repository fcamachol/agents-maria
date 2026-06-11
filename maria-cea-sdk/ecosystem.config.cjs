module.exports = {
  apps: [{
    name: "maria-cea-sdk",
    script: "dist/index.js",
    env: {
      NODE_ENV: "production",
      PORT: 3004
    },
    error_file: "./logs/error.log",
    out_file: "./logs/output.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z"
  }]
};
