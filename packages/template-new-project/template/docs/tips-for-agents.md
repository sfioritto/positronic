# Tips for AI Agents

This document contains helpful tips and patterns for AI agents working with Positronic projects.

## Running the Development Server

When you need to run a development server, use the `--log-file` option to capture server output:

### 1. Start the server with logging

```bash
# Start server with random port and capture output to a log file
PID=$(px server --port 38291 --log-file ./server-38291.log &)

# The command outputs the process ID as the first line
# Store this PID for later use
```

### 2. Run commands using your server port

```bash
# Set the port environment variable for subsequent commands
export POSITRONIC_SERVER_PORT=38291

# Now all px commands will use your server
px brain list
px brain run my-brain
```

### 3. Check server logs when needed

```bash
# View the entire log file
cat ./server-38291.log

# Follow the log file for real-time updates
tail -f ./server-38291.log

# View last 50 lines
tail -n 50 ./server-38291.log
```

### 4. Stop the server when done

```bash
# Use the PID you captured earlier
kill $PID
```

### Important Notes
- The log file must not already exist (prevents accidental overwrites)
- Each server instance should use a unique port and log file
- Always clean up by killing the server process when done
- The log file contains timestamped entries with [INFO], [ERROR], and [WARN] prefixes