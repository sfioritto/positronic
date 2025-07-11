#!/bin/bash

# Claude Code notification hook
# Runs when Claude is waiting for user input

/usr/local/bin/terminal-notifier \
  -title "Claude Code" \
  -message "Claude is waiting for your input" \
  -sound "default" \
  -activate "com.apple.Terminal"