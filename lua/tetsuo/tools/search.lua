-- Search tools: file tree listing and grep
local M = {}

function M.list_files(args)
  local path = args.path or "."
  local max_depth = args.max_depth or 3

  local expanded = vim.fn.expand(path)
  if vim.fn.isdirectory(expanded) ~= 1 then
    return { error = "Not a directory: " .. path }
  end

  -- Use find or dir depending on OS, respect .gitignore if possible
  local cmd
  if vim.fn.executable("fd") == 1 then
    cmd = string.format("fd --type f --max-depth %d . %s", max_depth, vim.fn.shellescape(expanded))
  elseif vim.fn.executable("find") == 1 then
    cmd = string.format("find %s -maxdepth %d -type f -not -path '*/.git/*' -not -path '*/node_modules/*'",
      vim.fn.shellescape(expanded), max_depth)
  else
    -- Windows fallback
    cmd = string.format("dir /s /b /a-d %s", vim.fn.shellescape(expanded))
  end

  local output = vim.fn.systemlist(cmd)
  if vim.v.shell_error ~= 0 then
    return { error = "Failed to list files", details = table.concat(output, "\n") }
  end

  -- Truncate if too many files
  local truncated = false
  if #output > 500 then
    output = vim.list_slice(output, 1, 500)
    truncated = true
  end

  return {
    files = output,
    count = #output,
    truncated = truncated,
    path = expanded,
  }
end

function M.grep_files(args)
  local pattern = args.pattern
  local path = args.path or "."
  local max_results = args.max_results or 50

  if not pattern then return { error = "pattern is required" } end

  local expanded = vim.fn.expand(path)

  -- Use rg if available, fall back to grep
  local cmd
  if vim.fn.executable("rg") == 1 then
    cmd = string.format("rg --no-heading --line-number --max-count %d %s %s",
      max_results, vim.fn.shellescape(pattern), vim.fn.shellescape(expanded))
  elseif vim.fn.executable("grep") == 1 then
    cmd = string.format("grep -rn --max-count=%d %s %s",
      max_results, vim.fn.shellescape(pattern), vim.fn.shellescape(expanded))
  else
    return { error = "No search tool available (install ripgrep or grep)" }
  end

  local output = vim.fn.systemlist(cmd)

  -- grep returns exit code 1 for no matches — that's not an error
  if vim.v.shell_error > 1 then
    return { error = "Search failed", details = table.concat(output, "\n") }
  end

  -- Truncate output
  local truncated = false
  if #output > max_results then
    output = vim.list_slice(output, 1, max_results)
    truncated = true
  end

  return {
    matches = output,
    count = #output,
    truncated = truncated,
    pattern = pattern,
    path = expanded,
  }
end

M.definitions = {
  {
    type = "function",
    ["function"] = {
      name = "list_files",
      description = "List files in a directory tree. Useful for understanding project structure. Respects .gitignore when possible.",
      parameters = {
        type = "object",
        properties = {
          path = {
            type = "string",
            description = "Directory path to list (default: current working directory)",
          },
          max_depth = {
            type = "number",
            description = "Maximum directory depth to traverse (default: 3)",
          },
        },
      },
    },
  },
  {
    type = "function",
    ["function"] = {
      name = "grep_files",
      description = "Search for a regex pattern across files in a directory. Returns matching lines with file paths and line numbers.",
      parameters = {
        type = "object",
        properties = {
          pattern = {
            type = "string",
            description = "Regex pattern to search for",
          },
          path = {
            type = "string",
            description = "Directory to search in (default: current working directory)",
          },
          max_results = {
            type = "number",
            description = "Maximum number of results to return (default: 50)",
          },
        },
        required = { "pattern" },
      },
    },
  },
}

return M
