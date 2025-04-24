{
  "$schema": "https://raw.githubusercontent.com/cloudflare/wrangler/main/config-schema.json",
  "name": "positronic-dev-{{projectName}}",
  "main": "src/index.ts",
  "compatibility_date": "2024-04-05",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": [
        "WorkflowRunnerDO",
        "MonitorDO"
      ]
    }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "WORKFLOW_RUNNER_DO", "class_name": "WorkflowRunnerDO" },
      { "name": "MONITOR_DO", "class_name": "MonitorDO" }
    ]
  },
  "vars": {
  }
}