local M = {}

-- Highlight groups for tetsuocode
function M.setup_highlights()
  local hl = vim.api.nvim_set_hl
  hl(0, "TetsuoUser", { fg = "#e0e0e0", bold = true })
  hl(0, "TetsuoAssistant", { fg = "#ffffff", bold = true })
  hl(0, "TetsuoSystem", { fg = "#707070", italic = true })
  hl(0, "TetsuoTool", { fg = "#999999" })
  hl(0, "TetsuoBorder", { fg = "#404040" })
  hl(0, "TetsuoSpinner", { fg = "#808080" })
  hl(0, "TetsuoSeparator", { fg = "#2a2a2a" })
  hl(0, "TetsuoDim", { fg = "#555555" })
  hl(0, "TetsuoAccent", { fg = "#cccccc", bold = true })
end

-- Spinner state
local spinner_state = {
  timer = nil,
  idx = 0,
  buf = nil,
  line = nil,
}

function M.start_spinner(buf, line)
  local config = require("tetsuo.config").get()
  local frames = config.ui.icons.spinner
  spinner_state.buf = buf
  spinner_state.line = line
  spinner_state.idx = 0

  if spinner_state.timer then
    M.stop_spinner()
  end

  spinner_state.timer = vim.uv.new_timer()
  spinner_state.timer:start(0, 80, vim.schedule_wrap(function()
    if not vim.api.nvim_buf_is_valid(spinner_state.buf) then
      M.stop_spinner()
      return
    end
    spinner_state.idx = (spinner_state.idx % #frames) + 1
    local frame = frames[spinner_state.idx]
    pcall(vim.api.nvim_buf_set_lines, spinner_state.buf, spinner_state.line, spinner_state.line + 1, false,
      { "  " .. frame })
  end))
end

function M.stop_spinner()
  if spinner_state.timer then
    spinner_state.timer:stop()
    spinner_state.timer:close()
    spinner_state.timer = nil
  end
end

-- Format a separator line
function M.separator(label, width)
  width = width or 50
  local pad = width - #label - 4
  if pad < 2 then pad = 2 end
  return "  " .. label .. " " .. string.rep("─", pad)
end

function M.separator_end(width)
  width = width or 50
  return string.rep("─", width)
end

-- Wrap text to width
function M.wrap_text(text, width)
  local lines = {}
  for line in text:gmatch("[^\n]*") do
    if #line <= width then
      table.insert(lines, line)
    else
      local current = ""
      for word in line:gmatch("%S+") do
        if #current + #word + 1 > width then
          table.insert(lines, current)
          current = word
        else
          current = current == "" and word or (current .. " " .. word)
        end
      end
      if current ~= "" then
        table.insert(lines, current)
      end
    end
  end
  return lines
end

-- Notify helper
function M.notify(msg, level)
  vim.notify("[tetsuo] " .. msg, level or vim.log.levels.INFO)
end

function M.error(msg)
  M.notify(msg, vim.log.levels.ERROR)
end

function M.warn(msg)
  M.notify(msg, vim.log.levels.WARN)
end

-- JSON encode/decode wrappers
function M.json_encode(val)
  return vim.json.encode(val)
end

function M.json_decode(str)
  local ok, result = pcall(vim.json.decode, str)
  if ok then
    return result
  end
  return nil
end

-- Get visual selection text
function M.get_visual_selection()
  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")
  local start_line = start_pos[2]
  local end_line = end_pos[2]

  if start_line == 0 or end_line == 0 then
    return nil, nil, nil
  end

  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  return table.concat(lines, "\n"), start_line, end_line
end

return M
