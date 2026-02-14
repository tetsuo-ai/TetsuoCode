-- Inline code actions: edit selection with AI
local api = require("tetsuo.api")
local config = require("tetsuo.config")
local context = require("tetsuo.context")
local utils = require("tetsuo.utils")

local M = {}

-- State for inline edit preview
local preview_state = {
  buf = nil,
  win = nil,
  original = nil,
  replacement = nil,
  target_buf = nil,
  start_line = nil,
  end_line = nil,
}

-- Apply the inline edit to the target buffer
local function apply_edit()
  if not preview_state.replacement then return end
  if not preview_state.target_buf or not vim.api.nvim_buf_is_valid(preview_state.target_buf) then return end

  local new_lines = vim.split(preview_state.replacement, "\n")
  vim.api.nvim_buf_set_lines(
    preview_state.target_buf,
    preview_state.start_line - 1,
    preview_state.end_line,
    false,
    new_lines
  )
  utils.notify("Edit applied.")
end

-- Close the preview window
local function close_preview()
  if preview_state.win and vim.api.nvim_win_is_valid(preview_state.win) then
    vim.api.nvim_win_close(preview_state.win, true)
  end
  if preview_state.buf and vim.api.nvim_buf_is_valid(preview_state.buf) then
    vim.api.nvim_buf_delete(preview_state.buf, { force = true })
  end
  preview_state.buf = nil
  preview_state.win = nil
end

-- Show the diff preview in a floating window
local function show_preview(original, replacement, ft)
  close_preview()

  preview_state.original = original
  preview_state.replacement = replacement

  -- Create preview buffer
  preview_state.buf = vim.api.nvim_create_buf(false, true)
  vim.bo[preview_state.buf].buftype = "nofile"
  vim.bo[preview_state.buf].filetype = ft

  -- Build preview content
  local lines = {
    "  original",
    "  ──────────────────────────────────",
  }
  for _, l in ipairs(vim.split(original, "\n")) do
    table.insert(lines, "  - " .. l)
  end
  table.insert(lines, "")
  table.insert(lines, "  replacement")
  table.insert(lines, "  ──────────────────────────────────")
  for _, l in ipairs(vim.split(replacement, "\n")) do
    table.insert(lines, "  + " .. l)
  end
  table.insert(lines, "")
  table.insert(lines, "  y: accept  n: reject")

  vim.api.nvim_buf_set_lines(preview_state.buf, 0, -1, false, lines)

  -- Open floating window
  local width = math.min(80, vim.o.columns - 10)
  local height = math.min(#lines + 2, vim.o.lines - 10)
  local row = math.floor((vim.o.lines - height) / 2)
  local col = math.floor((vim.o.columns - width) / 2)

  local cfg = config.get()
  preview_state.win = vim.api.nvim_open_win(preview_state.buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = row,
    col = col,
    style = "minimal",
    border = cfg.ui.border,
    title = " tetsuo: edit ",
    title_pos = "center",
  })

  -- Keymaps for accept/reject
  local kopts = { buffer = preview_state.buf, noremap = true, silent = true }
  vim.keymap.set("n", "y", function()
    apply_edit()
    close_preview()
  end, kopts)

  vim.keymap.set("n", "n", function()
    utils.notify("Edit rejected.")
    close_preview()
  end, kopts)

  vim.keymap.set("n", "q", function()
    close_preview()
  end, kopts)

  vim.keymap.set("n", "<Esc>", function()
    close_preview()
  end, kopts)
end

-- Run inline edit on visual selection
function M.edit_selection()
  -- Get selection
  local selection, start_line, end_line = utils.get_visual_selection()
  if not selection or selection == "" then
    utils.warn("No text selected. Use visual mode to select code first.")
    return
  end

  local bufnr = vim.api.nvim_get_current_buf()
  local ft = vim.bo[bufnr].filetype
  local bufname = vim.api.nvim_buf_get_name(bufnr)

  -- Prompt for instruction
  vim.ui.input({ prompt = "tetsuo > " }, function(instruction)
    if not instruction or instruction == "" then return end

    preview_state.target_buf = bufnr
    preview_state.start_line = start_line
    preview_state.end_line = end_line

    -- Build messages for inline edit
    local messages = {
      {
        role = "system",
        content = "You are TetsuoCode, an inline code editor. The user has selected code and wants you to edit it. "
          .. "Return ONLY the replacement code. No markdown fences, no explanation, no preamble. "
          .. "Just the raw code that should replace the selection.",
      },
      {
        role = "user",
        content = string.format(
          "File: %s (filetype: %s)\n\nSelected code (lines %d-%d):\n```\n%s\n```\n\nInstruction: %s\n\nReturn only the replacement code:",
          bufname, ft, start_line, end_line, selection, instruction
        ),
      },
    }

    -- Stream the replacement
    local replacement = ""

    utils.notify("Generating edit...")

    api.stream_chat({
      messages = messages,

      on_chunk = function(content)
        replacement = replacement .. content
      end,

      on_done = function()
        -- Strip any accidental markdown fences
        replacement = replacement:gsub("^```%w*\n", ""):gsub("\n```%s*$", "")
        replacement = vim.fn.trim(replacement)

        if replacement == "" then
          utils.warn("No replacement generated.")
          return
        end

        show_preview(selection, replacement, ft)
      end,

      on_error = function(err)
        utils.error("Inline edit failed: " .. tostring(err))
      end,
    })
  end)
end

return M
