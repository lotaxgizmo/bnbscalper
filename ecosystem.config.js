module.exports = {
    apps: [
      {
        name: "immediateAggregationLive",
        script: "./immediateAggregationLive.js",
        watch: true,
        ignore_watch: ["node_modules", "logs"],
        max_memory_restart: "1G",
      },
    ],
  };
  