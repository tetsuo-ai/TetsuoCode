-- Buffer/editor context tools
local M = {}

function M.get_current_buffer(args)
  local bufnr = vim.api.nvim_get_current_buf()
  local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  local name = vim.api.nvim_buf_get_name(bufnr)
  local ft = vim.bo[bufnr].filetype

  local content = table.concat(lines, "\n")
  if #content > 100000 then
    content = content:sub(1, 100000) .. "\n\n... [truncated]"
  end

  return {
    path = name,
    filetype = ft,
    content = content,
    total_lines = #lines,
  }
end

function M.get_diagnostics(args)
  local bufnr = args and args.bufnr or vim.api.nvim_get_current_buf()
  local diags = vim.diagnostic.get(bufnr)
  local results = {}

  for _, d in ipairs(diags) do
    table.insert(results, {
      line = d.lnum + 1,
      col = d.col + 1,
      severity = vim.diagnostic.severity[d.severity] or "UNKNOWN",
      message = d.message,
      source = d.source or "",
    })
  end

  return {
    path = vim.api.nvim_buf_get_name(bufnr),
    diagnostics = results,
    count = #results,
  }
end

function M.list_buffers(args)
  local bufs = vim.api.nvim_list_bufs()
  local results = {}

  for _, b in ipairs(bufs) do
    if vim.api.nvim_buf_is_loaded(b) and vim.bo[b].buflisted then
      table.insert(results, {
        bufnr = b,
        path = vim.api.nvim_buf_get_name(b),
        filetype = vim.bo[b].filetype,
        modified = vim.bo[b].modified,
        lines = vim.api.nvim_buf_line_count(b),
      })
    end
  end

  return { buffers = results, count = #results }
end

M.definitions = {
  {
    type = "function",
    ["function"] = {
      name = "get_current_buffer",
      description = "Get the contents of the user's currently active buffer/file in Neovim.",
      parameters = {
        type = "object",
        properties = {},
      },
    },
  },
  {
    type = "function",
    ["function"] = {
      name = "get_diagnostics",
      description = "Get LSP diagnostics (errors, warnings) for the current buffer.",
      parameters = {
        type = "object",
        properties = {},
      },
    },
  },
  {
    type = "function",
    ["function"] = {
      name = "list_buffers",
      description = "List all open buffers in Neovim with their file paths and types.",
      parameters = {
        type = "object",
        properties = {},
      },
    },
  },
}

return M
