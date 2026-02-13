-- Context gathering: attach editor state to messages
local config = require("tetsuo.config")

local M = {}

-- Gather current context for the system message
function M.gather()
  local parts = {}

  -- Current file info
  local bufnr = vim.api.nvim_get_current_buf()
  local name = vim.api.nvim_buf_get_name(bufnr)
  local ft = vim.bo[bufnr].filetype
  local line = vim.api.nvim_win_get_cursor(0)[1]
  local total_lines = vim.api.nvim_buf_line_count(bufnr)

  if name ~= "" then
    table.insert(parts, string.format("Current file: %s (filetype: %s, line %d/%d)", name, ft, line, total_lines))
  end

  -- Working directory
  local cwd = vim.fn.getcwd()
  table.insert(parts, "Working directory: " .. cwd)

  -- Git branch
  local branch = vim.fn.system("git rev-parse --abbrev-ref HEAD 2>/dev/null"):gsub("%s+$", "")
  if vim.v.shell_error == 0 and branch ~= "" then
    table.insert(parts, "Git branch: " .. branch)
  end

  -- LSP diagnostics summary
  local diags = vim.diagnostic.get(bufnr)
  if #diags > 0 then
    local errors = 0
    local warnings = 0
    for _, d in ipairs(diags) do
      if d.severity == vim.diagnostic.severity.ERROR then
        errors = errors + 1
      elseif d.severity == vim.diagnostic.severity.WARN then
        warnings = warnings + 1
      end
    end
    if errors > 0 or warnings > 0 then
      table.insert(parts, string.format("Diagnostics: %d errors, %d warnings", errors, warnings))
    end
  end

  return table.concat(parts, "\n")
end

-- Build the system message with context
function M.build_system_message()
  local cfg = config.get()
  local context = M.gather()
  local content = cfg.system_prompt .. "\n\n## Current Editor Context\n" .. context

  return {
    role = "system",
    content = content,
  }
end

-- Attach visual selection context to a user message
function M.enrich_message(message, selection, sel_start, sel_end)
  if selection and selection ~= "" then
    local bufname = vim.api.nvim_buf_get_name(0)
    local ft = vim.bo.filetype
    message = message .. string.format(
      "\n\nSelected code from %s (lines %d-%d, filetype: %s):\n```%s\n%s\n```",
      bufname, sel_start, sel_end, ft, ft, selection
    )
  end
  return message
end

return M
