-- TetsuoCode: Cursor for Vim, Powered by Grok
local config = require("tetsuo.config")
local utils = require("tetsuo.utils")

local M = {}

function M.setup(opts)
  config.setup(opts)

  local cfg = config.get()

  -- Set up highlights
  utils.setup_highlights()

  -- Register keymaps
  local km = cfg.keymaps
  local kopts = { noremap = true, silent = true }

  if km.toggle_chat then
    vim.keymap.set("n", km.toggle_chat, function()
      require("tetsuo.chat").toggle()
    end, vim.tbl_extend("force", kopts, { desc = "TetsuoCode: Toggle chat" }))
  end

  if km.ask then
    vim.keymap.set("n", km.ask, function()
      vim.ui.input({ prompt = "TetsuoCode: " }, function(input)
        if input and input ~= "" then
          require("tetsuo.chat").ask(input)
        end
      end)
    end, vim.tbl_extend("force", kopts, { desc = "TetsuoCode: Ask question" }))
  end

  if km.inline_edit then
    vim.keymap.set("v", km.inline_edit, function()
      -- Exit visual mode first so marks are set
      vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "x", false)
      vim.schedule(function()
        require("tetsuo.inline").edit_selection()
      end)
    end, vim.tbl_extend("force", kopts, { desc = "TetsuoCode: Inline edit selection" }))
  end

  if km.reset then
    vim.keymap.set("n", km.reset, function()
      require("tetsuo.chat").reset()
    end, vim.tbl_extend("force", kopts, { desc = "TetsuoCode: Reset chat" }))
  end

  if km.fix_diagnostics then
    vim.keymap.set("n", km.fix_diagnostics, function()
      local diags = vim.diagnostic.get(0)
      if #diags == 0 then
        utils.notify("No diagnostics in current buffer.")
        return
      end

      local buf_content = table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\n")
      local buf_name = vim.api.nvim_buf_get_name(0)
      local ft = vim.bo.filetype

      local diag_text = {}
      for _, d in ipairs(diags) do
        table.insert(diag_text, string.format(
          "Line %d: [%s] %s",
          d.lnum + 1,
          vim.diagnostic.severity[d.severity] or "?",
          d.message
        ))
      end

      local prompt = string.format(
        "Fix the diagnostics in %s (%s):\n\nDiagnostics:\n%s\n\nFile contents:\n```%s\n%s\n```",
        buf_name, ft, table.concat(diag_text, "\n"), ft, buf_content
      )

      local chat = require("tetsuo.chat")
      if not chat.is_open() then chat.open() end
      chat.send(prompt)
    end, vim.tbl_extend("force", kopts, { desc = "TetsuoCode: Fix diagnostics" }))
  end

  -- Validate API key
  if not cfg.api_key then
    utils.warn("No XAI_API_KEY found. Set it as an environment variable or in setup({ api_key = '...' }).")
  end
end

return M
