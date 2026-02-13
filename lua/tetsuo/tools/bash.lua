-- Shell command execution tool
local config = require("tetsuo.config")
local utils = require("tetsuo.utils")

local M = {}

function M.run_command(args)
  local command = args.command
  if not command then return { error = "command is required" } end

  local cfg = config.get()
  local timeout = cfg.tools.bash_timeout

  -- Run synchronously with timeout using system()
  -- We use jobstart for async but for tool calls we need the result
  local stdout = {}
  local stderr = {}
  local done = false
  local exit_code = nil

  local job_id = vim.fn.jobstart(command, {
    on_stdout = function(_, data)
      if data then
        for _, line in ipairs(data) do
          if line ~= "" then table.insert(stdout, line) end
        end
      end
    end,
    on_stderr = function(_, data)
      if data then
        for _, line in ipairs(data) do
          if line ~= "" then table.insert(stderr, line) end
        end
      end
    end,
    on_exit = function(_, code)
      exit_code = code
      done = true
    end,
  })

  if job_id <= 0 then
    return { error = "Failed to start command" }
  end

  -- Wait for completion with timeout
  local waited = 0
  local interval = 50
  while not done and waited < timeout do
    vim.wait(interval, function() return done end)
    waited = waited + interval
  end

  if not done then
    pcall(vim.fn.jobstop, job_id)
    return { error = "Command timed out after " .. (timeout / 1000) .. "s" }
  end

  local out = table.concat(stdout, "\n")
  local err = table.concat(stderr, "\n")

  -- Truncate large output
  if #out > 50000 then
    out = out:sub(1, 50000) .. "\n\n... [truncated, output is " .. #out .. " chars]"
  end

  return {
    stdout = out,
    stderr = err,
    exit_code = exit_code,
  }
end

M.definitions = {
  {
    type = "function",
    ["function"] = {
      name = "run_command",
      description = "Execute a shell command and return its output. Use for running tests, git commands, build tools, etc.",
      parameters = {
        type = "object",
        properties = {
          command = {
            type = "string",
            description = "The shell command to execute",
          },
        },
        required = { "command" },
      },
    },
  },
}

return M
