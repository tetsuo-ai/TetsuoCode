-- Tool registry and execution engine
local config = require("tetsuo.config")
local utils = require("tetsuo.utils")
local file_tools = require("tetsuo.tools.file")
local bash_tools = require("tetsuo.tools.bash")
local buffer_tools = require("tetsuo.tools.buffer")
local search_tools = require("tetsuo.tools.search")

local M = {}

-- Tools that require user confirmation
local CONFIRM_WRITE_TOOLS = { write_file = true, edit_file = true }
local CONFIRM_BASH_TOOLS = { run_command = true }

-- Map tool names to their handler functions
local handlers = {
  read_file = file_tools.read_file,
  write_file = file_tools.write_file,
  edit_file = file_tools.edit_file,
  run_command = bash_tools.run_command,
  get_current_buffer = buffer_tools.get_current_buffer,
  get_diagnostics = buffer_tools.get_diagnostics,
  list_buffers = buffer_tools.list_buffers,
  list_files = search_tools.list_files,
  grep_files = search_tools.grep_files,
}

-- Get all tool definitions for the API
function M.get_definitions()
  local cfg = config.get()
  if not cfg.tools.enabled then return {} end

  local defs = {}
  for _, d in ipairs(file_tools.definitions) do table.insert(defs, d) end
  for _, d in ipairs(bash_tools.definitions) do table.insert(defs, d) end
  for _, d in ipairs(buffer_tools.definitions) do table.insert(defs, d) end
  for _, d in ipairs(search_tools.definitions) do table.insert(defs, d) end
  return defs
end

-- Check if a tool requires confirmation, return true if user approves (or no confirm needed)
local function check_confirmation(name, args)
  local cfg = config.get()

  if CONFIRM_WRITE_TOOLS[name] and cfg.tools.confirm_writes then
    local path = args.path or "unknown"
    local choice = vim.fn.confirm(
      string.format("[TetsuoCode] Allow %s on %s?", name, path),
      "&Yes\n&No\n&Always", 2
    )
    if choice == 3 then
      -- "Always" — disable confirm for rest of session
      cfg.tools.confirm_writes = false
      return true
    end
    return choice == 1
  end

  if CONFIRM_BASH_TOOLS[name] and cfg.tools.confirm_bash then
    local cmd = args.command or "unknown"
    if #cmd > 80 then cmd = cmd:sub(1, 80) .. "..." end
    local choice = vim.fn.confirm(
      string.format("[TetsuoCode] Run command?\n%s", cmd),
      "&Yes\n&No\n&Always", 2
    )
    if choice == 3 then
      cfg.tools.confirm_bash = false
      return true
    end
    return choice == 1
  end

  return true
end

-- Execute a single tool call
function M.execute(name, arguments)
  local handler = handlers[name]
  if not handler then
    return { error = "Unknown tool: " .. name }
  end

  -- Parse arguments if string
  local args = arguments
  if type(args) == "string" then
    args = utils.json_decode(args) or {}
  end

  -- Check user confirmation
  if not check_confirmation(name, args) then
    return { error = "User denied " .. name .. " execution." }
  end

  -- Execute with pcall for safety
  local ok, result = pcall(handler, args)
  if not ok then
    return { error = "Tool execution failed: " .. tostring(result) }
  end

  return result
end

-- Execute a batch of tool calls and return results as messages
function M.execute_tool_calls(tool_calls, on_status)
  local results = {}

  for _, tc in ipairs(tool_calls) do
    local name = tc["function"].name
    local args_str = tc["function"].arguments

    if on_status then
      on_status("Running tool: " .. name)
    end

    local args = utils.json_decode(args_str) or {}
    local result = M.execute(name, args)
    local result_str = utils.json_encode(result)

    table.insert(results, {
      role = "tool",
      tool_call_id = tc.id,
      content = result_str,
    })
  end

  return results
end

return M
