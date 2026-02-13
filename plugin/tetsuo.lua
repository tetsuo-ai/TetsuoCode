-- TetsuoCode: Cursor for Vim, Powered by Grok
-- Plugin entrypoint: registers commands

if vim.g.loaded_tetsuo then
  return
end
vim.g.loaded_tetsuo = true

-- User commands
vim.api.nvim_create_user_command("Tetsuo", function()
  require("tetsuo.chat").toggle()
end, { desc = "Toggle TetsuoCode chat panel" })

vim.api.nvim_create_user_command("TetsuoAsk", function(opts)
  local prompt = opts.args
  if prompt == "" then
    vim.ui.input({ prompt = "TetsuoCode: " }, function(input)
      if input and input ~= "" then
        require("tetsuo.chat").ask(input)
      end
    end)
  else
    require("tetsuo.chat").ask(prompt)
  end
end, { nargs = "?", desc = "Ask TetsuoCode a question" })

vim.api.nvim_create_user_command("TetsuoInline", function()
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "x", false)
  vim.schedule(function()
    require("tetsuo.inline").edit_selection()
  end)
end, { range = true, desc = "TetsuoCode inline edit on selection" })

vim.api.nvim_create_user_command("TetsuoClose", function()
  require("tetsuo.chat").close()
end, { desc = "Close TetsuoCode chat panel" })

vim.api.nvim_create_user_command("TetsuoReset", function()
  require("tetsuo.chat").reset()
end, { desc = "Reset TetsuoCode conversation" })
