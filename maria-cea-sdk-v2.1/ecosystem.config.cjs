module.exports = {
  apps: [
    {
      // TEXT / WhatsApp channel (same entry as v2; not deployed until the
      // v2 -> v2.1 text cutover. Kept here so v2.1 is the one canonical repo).
      name: "maria-cea-v21-text",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        PORT: 3014
      },
      error_file: "./logs/text-error.log",
      out_file: "./logs/text-output.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    },
    {
      // VOICE channel (ElevenLabs). Side-by-side: runs on its own port alongside
      // the live maria-voz:3003 until cutover. Shares core/ + Redis session hub.
      name: "maria-cea-v21-voice",
      script: "dist/voice/server.js",
      env: {
        NODE_ENV: "production",
        // 3004 is taken on gcp-cea; 3017 is free (next in the maria-cea-sdk family).
        // NOTE: open this port in the GCP firewall so ElevenLabs can reach it
        // (the old maria-voz uses 34.122.65.54:3003).
        VOICE_PORT: 3017
      },
      error_file: "./logs/voice-error.log",
      out_file: "./logs/voice-output.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    }
  ]
};
