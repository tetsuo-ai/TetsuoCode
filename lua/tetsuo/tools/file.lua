-- File operations: read, write, edit
local utils = require("tetsuo.utils")

local M = {}

function M.read_file(args)
  local path = args.path
  if not path then return { error = "path is required" } end

  local expanded = vim.fn.expand(path)
  if vim.fn.filereadable(expanded) ~= 1 then
    return { error = "File not found: " .. path }
  end

  local lines = vim.fn.readfile(expanded)
  local content = table.concat(lines, "\n")

  -- Truncate very large files
  if #content > 100000 then
    content = content:sub(1, 100000) .. "\n\n... [truncated, file is " .. #content .. " bytes]"
  end

  return { content = content, path = expanded, lines = #lines }
end

function M.write_file(args)
  local path = args.path
  local content = args.content
  if not path then return { error = "path is required" } end
  if not content then return { error = "content is required" } end

  local expanded = vim.fn.expand(path)

  -- Ensure parent directory exists
  local dir = vim.fn.fnamemodify(expanded, ":h")
  if vim.fn.isdirectory(dir) ~= 1 then
    vim.fn.mkdir(dir, "p")
  end

  local lines = vim.split(content, "\n")
  vim.fn.writefile(lines, expanded)

  -- If the file is open in a buffer, reload it
  local bufnr = vim.fn.bufnr(expanded)
  if bufnr ~= -1 then
    vim.schedule(function()
      vim.api.nvim_buf_call(bufnr, function()
        vim.cmd("edit!")
      end)
    end)
  end

  return { success = true, path = expanded, bytes = #content }
end

function M.edit_file(args)
  local path = args.path
  local old_string = args.old_string
  local new_string = args.new_string
  if not path then return { error = "path is required" } end
  if not old_string then return { error = "old_string is required" } end
  if not new_string then return { error = "new_string is required" } end

  local expanded = vim.fn.expand(path)
  if vim.fn.filereadable(expanded) ~= 1 then
    return { error = "File not found: " .. path }
  end

  local lines = vim.fn.readfile(expanded)
  local content = table.concat(lines, "\n")

  -- Check that old_string exists
  local start_idx = content:find(old_string, 1, true)
  if not start_idx then
    return { error = "old_string not found in file. Make sure it matches exactly." }
  end

  -- Check uniqueness
  local second = content:find(old_string, start_idx + 1, true)
  if second then
    return { error = "old_string appears multiple times. Provide more context to make it unique." }
  end

  -- Replace
  local new_content = content:sub(1, start_idx - 1) .. new_string .. content:sub(start_idx + #old_string)

  local new_lines = vim.split(new_content, "\n")
  vim.fn.writefile(new_lines, expanded)

  -- Reload buffer if open
  local bufnr = vim.fn.bufnr(expanded)
  if bufnr ~= -1 then
    vim.schedule(function()
      vim.api.nvim_buf_call(bufnr, function()
        vim.cmd("edit!")
      end)
    end)
  end

  return { success = true, path = expanded }
end

-- Tool definitions for the API
M.definitions = {
  {
    type = "function",
    ["function"] = {
      name = "read_file",
      description = "Read the contents of a file at the given path.",
      parameters = {
        type = "object",
        properties = {
          path = {
            type = "string",
            description = "Absolute or relative path to the file",
          },
        },
        required = { "path" },
      },
    },
  },
  {
    type = "function",
    ["function"] = {
      name = "write_file",
      description = "Write content to a file, creating it if it doesn't exist. Overwrites existing content.",
      parameters = {
        type = "object",
        properties = {
          path = {
            type = "string",
            description = "Path to the file to write",
          },
          content = {
            type = "string",
            description = "The full content to write to the file",
          },
        },
        required = { "path", "content" },
      },
    },
  },
  {
    type = "function",
    ["function"] = {
      name = "edit_file",
      description = "Edit a file by replacing an exact string match with new content. The old_string must appear exactly once in the file.",
      parameters = {
        type = "object",
        properties = {
          path = {
            type = "string",
            description = "Path to the file to edit",
          },
          old_string = {
            type = "string",
            description = "The exact string to find and replace (must be unique in the file)",
          },
          new_string = {
            type = "string",
            description = "The string to replace it with",
          },
        },
        required = { "path", "old_string", "new_string" },
      },
    },
  },
}

return M
