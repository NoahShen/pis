"use strict";

module.exports = {
  apps: [
    {
      name: "pis",
      script: "dist/server.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      watch: false,
      pmx: false,
      vizion: false,
      wait_ready: false,
      kill_timeout: 6000,
      autorestart: true,
    },
  ],
};
