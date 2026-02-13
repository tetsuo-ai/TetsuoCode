-- Chat UI: vsplit panel with streaming display
local api = require("tetsuo.api")
local config = require("tetsuo.config")
local context = require("tetsuo.context")
local tools = require("tetsuo.tools")
local utils = require("tetsuo.utils")

local M = {}

-- State
local state = {
  buf = nil,        -- chat buffer
  win = nil,        -- chat window
  input_buf = nil,  -- input buffer
  input_win = nil,  -- input window
  messages = {},    -- conversation history
  streaming = false,
  current_response = "",
  response_start_line = 0,
  usage = nil,      -- cumulative token usage
}

-- Check if chat window is open
function M.is_open()
  return state.win and vim.api.nvim_win_is_valid(state.win)
end

-- Create or get the chat buffer
local function ensure_chat_buffer()
  if state.buf and vim.api.nvim_buf_is_valid(state.buf) then
    return state.buf
  end

  state.buf = vim.api.nvim_create_buf(false, true)
  vim.bo[state.buf].buftype = "nofile"
  vim.bo[state.buf].bufhidden = "hide"
  vim.bo[state.buf].swapfile = false
  vim.bo[state.buf].filetype = "markdown"
  vim.api.nvim_buf_set_name(state.buf, "TetsuoCode")

  -- Chat buffer keymaps
  local kopts = { buffer = state.buf, noremap = true, silent = true }
  vim.keymap.set("n", "q", function() M.close() end, kopts)
  vim.keymap.set("n", "i", function() M.focus_input() end, kopts)
  vim.keymap.set("n", "<CR>", function() M.focus_input() end, kopts)
  vim.keymap.set("n", "R", function() M.reset() end, kopts)

  -- Ctrl+C to cancel streaming
  vim.keymap.set("n", "<C-c>", function() M.cancel_stream() end, kopts)

  -- Yank code block under cursor
  vim.keymap.set("n", "yc", function() M.yank_code_block() end, kopts)

  return state.buf
end

-- Create or get the input buffer
local function ensure_input_buffer()
  if state.input_buf and vim.api.nvim_buf_is_valid(state.input_buf) then
    return state.input_buf
  end

  state.input_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[state.input_buf].buftype = "nofile"
  vim.bo[state.input_buf].bufhidden = "hide"
  vim.bo[state.input_buf].swapfile = false
  vim.bo[state.input_buf].filetype = ""

  -- Input buffer keymaps
  local kopts = { buffer = state.input_buf, noremap = true, silent = true }

  -- Submit with Ctrl+Enter or <C-s>
  vim.keymap.set({ "n", "i" }, "<C-s>", function()
    M.submit_input()
  end, kopts)

  vim.keymap.set("n", "<CR>", function()
    M.submit_input()
  end, kopts)

  vim.keymap.set("n", "q", function()
    M.close()
  end, kopts)

  -- Ctrl+C to cancel in input buffer too
  vim.keymap.set({ "n", "i" }, "<C-c>", function()
    M.cancel_stream()
  end, kopts)

  return state.input_buf
end

-- Open the chat panel
function M.open()
  if M.is_open() then
    vim.api.nvim_set_current_win(state.win)
    return
  end

  local cfg = config.get()
  local chat_buf = ensure_chat_buffer()
  local input_buf = ensure_input_buffer()

  -- Save the current window to return to it later
  local prev_win = vim.api.nvim_get_current_win()

  -- Calculate width
  local total_cols = vim.o.columns
  local width = math.floor(total_cols * cfg.ui.width)

  -- Open vsplit on the right
  if cfg.ui.position == "right" then
    vim.cmd("botright " .. width .. "vsplit")
  else
    vim.cmd("topleft " .. width .. "vsplit")
  end

  state.win = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(state.win, chat_buf)

  -- Window options
  vim.wo[state.win].number = false
  vim.wo[state.win].relativenumber = false
  vim.wo[state.win].signcolumn = "no"
  vim.wo[state.win].wrap = true
  vim.wo[state.win].linebreak = true
  vim.wo[state.win].winfixwidth = true
  vim.wo[state.win].statusline = " 鉄 TetsuoCode"

  -- Create input area at the bottom (horizontal split within the chat panel)
  vim.cmd("belowright 3split")
  state.input_win = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(state.input_win, input_buf)
  vim.wo[state.input_win].number = false
  vim.wo[state.input_win].relativenumber = false
  vim.wo[state.input_win].signcolumn = "no"
  vim.wo[state.input_win].winfixheight = true
  vim.wo[state.input_win].statusline = " > Type message (<C-s> send, q close)"

  -- Set placeholder text
  if vim.api.nvim_buf_line_count(input_buf) <= 1 and vim.api.nvim_buf_get_lines(input_buf, 0, 1, false)[1] == "" then
    -- Empty, ready for input
  end

  -- Show welcome if first open
  if vim.api.nvim_buf_line_count(chat_buf) <= 1 then
    local welcome = {
      "╭──────────────────────────────────────╮",
      "│         鉄 TetsuoCode                │",
      "│    Cursor for Vim, Powered by Grok   │",
      "╰──────────────────────────────────────╯",
      "",
      "  i / Enter  → focus input",
      "  <C-s>      → send message",
      "  <C-c>      → cancel response",
      "  yc         → yank code block",
      "  q          → close panel",
      "  R          → reset chat",
      "",
      "  :TetsuoModel   → switch model",
      "  :TetsuoSave    → save conversation",
      "  :TetsuoLoad    → load conversation",
      "",
      "─────────────────────────────────────────",
      "",
    }
    vim.api.nvim_buf_set_lines(chat_buf, 0, -1, false, welcome)
  end

  -- Focus the input
  vim.api.nvim_set_current_win(state.input_win)
  vim.cmd("startinsert")
end

-- Close the chat panel
function M.close()
  api.cancel()
  utils.stop_spinner()

  if state.input_win and vim.api.nvim_win_is_valid(state.input_win) then
    vim.api.nvim_win_close(state.input_win, true)
    state.input_win = nil
  end
  if state.win and vim.api.nvim_win_is_valid(state.win) then
    vim.api.nvim_win_close(state.win, true)
    state.win = nil
  end
end

-- Toggle chat panel
function M.toggle()
  if M.is_open() then
    M.close()
  else
    M.open()
  end
end

-- Focus the input buffer
function M.focus_input()
  if state.input_win and vim.api.nvim_win_is_valid(state.input_win) then
    vim.api.nvim_set_current_win(state.input_win)
    vim.cmd("startinsert!")
  end
end

-- Append lines to the chat buffer
local function append_to_chat(lines)
  if not state.buf or not vim.api.nvim_buf_is_valid(state.buf) then return end
  vim.bo[state.buf].modifiable = true
  local count = vim.api.nvim_buf_line_count(state.buf)
  vim.api.nvim_buf_set_lines(state.buf, count, count, false, lines)
  vim.bo[state.buf].modifiable = false

  -- Auto-scroll chat window
  if state.win and vim.api.nvim_win_is_valid(state.win) then
    local new_count = vim.api.nvim_buf_line_count(state.buf)
    pcall(vim.api.nvim_win_set_cursor, state.win, { new_count, 0 })
  end
end

-- Update the last line(s) of chat (for streaming)
local function update_streaming_lines(text)
  if not state.buf or not vim.api.nvim_buf_is_valid(state.buf) then return end

  state.current_response = state.current_response .. text
  local lines = vim.split(state.current_response, "\n")

  vim.bo[state.buf].modifiable = true
  local buf_lines = vim.api.nvim_buf_line_count(state.buf)
  local start_line = state.response_start_line
  vim.api.nvim_buf_set_lines(state.buf, start_line, buf_lines, false, lines)
  vim.bo[state.buf].modifiable = false

  -- Auto-scroll
  if state.win and vim.api.nvim_win_is_valid(state.win) then
    local new_count = vim.api.nvim_buf_line_count(state.buf)
    pcall(vim.api.nvim_win_set_cursor, state.win, { new_count, 0 })
  end
end

-- Send a message and stream the response
function M.send(message, selection, sel_start, sel_end)
  if api.is_busy() then
    utils.warn("Already processing a request...")
    return
  end

  -- Enrich message with selection context if present
  local enriched = context.enrich_message(message, selection, sel_start, sel_end)

  -- Display user message in chat
  local cfg = config.get()
  append_to_chat({
    "╭─ " .. cfg.ui.icons.user .. " ─────────────────────────────",
    "",
  })
  local user_lines = vim.split(message, "\n")
  for _, line in ipairs(user_lines) do
    append_to_chat({ "  " .. line })
  end
  append_to_chat({ "", "╰──────────────────────────────────────", "" })

  -- Add to conversation history
  table.insert(state.messages, {
    role = "user",
    content = enriched,
  })

  -- Start streaming response
  M._do_completion()
end

-- Internal: run a completion (may loop for tool calls)
function M._do_completion(iteration)
  iteration = iteration or 1
  local cfg = config.get()

  if iteration > cfg.tools.max_iterations then
    append_to_chat({ "", "  [max tool iterations reached]", "" })
    return
  end

  -- Display assistant header
  append_to_chat({
    "╭─ " .. cfg.ui.icons.assistant .. " ────────────────────────────",
    "",
  })

  -- Mark where streaming content starts
  state.response_start_line = vim.api.nvim_buf_line_count(state.buf)
  state.current_response = ""
  state.streaming = true

  -- Start spinner
  utils.start_spinner(state.buf, state.response_start_line)

  -- Build messages with system context
  local messages = { context.build_system_message() }
  for _, m in ipairs(state.messages) do
    table.insert(messages, m)
  end

  -- Get tool definitions
  local tool_defs = tools.get_definitions()

  api.stream_chat({
    messages = messages,
    tools = #tool_defs > 0 and tool_defs or nil,

    on_chunk = function(content)
      if state.streaming then
        utils.stop_spinner()
        update_streaming_lines(content)
      end
    end,

    on_tool_call = function(tool_calls)
      utils.stop_spinner()
      state.streaming = false

      -- Record assistant message with tool calls
      local assistant_msg = {
        role = "assistant",
        content = state.current_response ~= "" and state.current_response or nil,
        tool_calls = tool_calls,
      }
      table.insert(state.messages, assistant_msg)

      -- Display tool execution
      for _, tc in ipairs(tool_calls) do
        local name = tc["function"].name
        local args_preview = tc["function"].arguments
        if #args_preview > 100 then
          args_preview = args_preview:sub(1, 100) .. "..."
        end

        append_to_chat({
          "",
          "  " .. cfg.ui.icons.tool .. " " .. name,
          "  " .. args_preview,
        })
      end

      -- Execute tools
      local results = tools.execute_tool_calls(tool_calls, function(status)
        append_to_chat({ "  → " .. status })
      end)

      -- Add tool results to messages
      for _, r in ipairs(results) do
        table.insert(state.messages, r)

        -- Show truncated result in chat
        local preview = r.content
        if #preview > 200 then
          preview = preview:sub(1, 200) .. "..."
        end
        append_to_chat({ "  ✓ " .. preview:gsub("\n", " "), "" })
      end

      append_to_chat({ "╰──────────────────────────────────────", "" })

      -- Continue the conversation with tool results
      M._do_completion(iteration + 1)
    end,

    on_done = function(usage)
      utils.stop_spinner()
      state.streaming = false

      -- Record assistant message
      if state.current_response ~= "" then
        table.insert(state.messages, {
          role = "assistant",
          content = state.current_response,
        })
      end

      -- Display token usage if available
      local usage_line = ""
      if usage then
        state.usage = state.usage or { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 }
        state.usage.prompt_tokens = state.usage.prompt_tokens + (usage.prompt_tokens or 0)
        state.usage.completion_tokens = state.usage.completion_tokens + (usage.completion_tokens or 0)
        state.usage.total_tokens = state.usage.total_tokens + (usage.total_tokens or 0)
        usage_line = string.format("  [tokens: %d in / %d out / %d total session]",
          usage.prompt_tokens or 0, usage.completion_tokens or 0, state.usage.total_tokens)
      end

      if usage_line ~= "" then
        append_to_chat({ "", usage_line })
      end
      append_to_chat({ "╰──────────────────────────────────────", "" })

      -- Update statusline with usage
      if state.win and vim.api.nvim_win_is_valid(state.win) then
        local status = " 鉄 TetsuoCode"
        if state.usage then
          status = status .. string.format("  [%d tokens]", state.usage.total_tokens)
        end
        vim.wo[state.win].statusline = status
      end
    end,

    on_error = function(err)
      utils.stop_spinner()
      state.streaming = false
      append_to_chat({ "", "  [Error: " .. tostring(err) .. "]", "" })
      append_to_chat({ "╰──────────────────────────────────────", "" })
    end,
  })
end

-- Submit from the input buffer
function M.submit_input()
  if not state.input_buf or not vim.api.nvim_buf_is_valid(state.input_buf) then
    return
  end

  local lines = vim.api.nvim_buf_get_lines(state.input_buf, 0, -1, false)
  local message = vim.fn.trim(table.concat(lines, "\n"))

  if message == "" then return end

  -- Clear input buffer
  vim.api.nvim_buf_set_lines(state.input_buf, 0, -1, false, { "" })

  -- Ensure chat is open
  if not M.is_open() then
    M.open()
  end

  M.send(message)
end

-- Quick ask from command line
function M.ask(prompt)
  if not M.is_open() then
    M.open()
  end
  M.send(prompt)
end

-- Reset conversation
function M.reset()
  api.cancel()
  utils.stop_spinner()
  state.messages = {}
  state.current_response = ""
  state.streaming = false
  state.usage = nil

  if state.buf and vim.api.nvim_buf_is_valid(state.buf) then
    vim.bo[state.buf].modifiable = true
    vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, {
      "╭──────────────────────────────────────╮",
      "│         鉄 TetsuoCode                │",
      "│         Chat reset.                  │",
      "╰──────────────────────────────────────╯",
      "",
    })
    vim.bo[state.buf].modifiable = false
  end

  utils.notify("Chat reset.")
end

-- Cancel active stream
function M.cancel_stream()
  if api.is_busy() then
    api.cancel()
    utils.stop_spinner()
    state.streaming = false
    append_to_chat({ "", "  [cancelled]", "" })
    append_to_chat({ "╰──────────────────────────────────────", "" })
    utils.notify("Response cancelled.")
  end
end

-- Yank the code block under cursor to clipboard
function M.yank_code_block()
  if not state.buf or not vim.api.nvim_buf_is_valid(state.buf) then return end

  local cursor = vim.api.nvim_win_get_cursor(state.win or 0)
  local line_nr = cursor[1]
  local lines = vim.api.nvim_buf_get_lines(state.buf, 0, -1, false)

  -- Search backwards for opening ```
  local start_line = nil
  for i = line_nr, 1, -1 do
    if lines[i]:match("^```") then
      start_line = i
      break
    end
  end

  if not start_line then
    utils.warn("No code block found at cursor.")
    return
  end

  -- Search forwards for closing ```
  local end_line = nil
  for i = start_line + 1, #lines do
    if lines[i]:match("^```%s*$") then
      end_line = i
      break
    end
  end

  if not end_line then
    utils.warn("No closing ``` found for code block.")
    return
  end

  -- Extract content between fences
  local code_lines = {}
  for i = start_line + 1, end_line - 1 do
    table.insert(code_lines, lines[i])
  end

  local code = table.concat(code_lines, "\n")
  vim.fn.setreg("+", code)
  vim.fn.setreg('"', code)
  utils.notify(string.format("Yanked %d lines to clipboard.", #code_lines))
end

-- Save conversation to disk
function M.save(name)
  local dir = vim.fn.stdpath("data") .. "/tetsuo"
  if vim.fn.isdirectory(dir) ~= 1 then
    vim.fn.mkdir(dir, "p")
  end

  name = name or os.date("%Y%m%d_%H%M%S")
  local filepath = dir .. "/" .. name .. ".json"

  local data = utils.json_encode({
    messages = state.messages,
    timestamp = os.date("%Y-%m-%dT%H:%M:%S"),
    model = config.get().model,
  })

  local f = io.open(filepath, "w")
  if f then
    f:write(data)
    f:close()
    utils.notify("Saved conversation to " .. filepath)
  else
    utils.error("Failed to save conversation.")
  end
end

-- Load conversation from disk
function M.load(name)
  local dir = vim.fn.stdpath("data") .. "/tetsuo"

  if not name then
    -- List available saves
    local files = vim.fn.globpath(dir, "*.json", false, true)
    if #files == 0 then
      utils.notify("No saved conversations found.")
      return
    end

    vim.ui.select(files, {
      prompt = "Load conversation:",
      format_item = function(item)
        return vim.fn.fnamemodify(item, ":t:r")
      end,
    }, function(choice)
      if choice then
        M._load_file(choice)
      end
    end)
    return
  end

  local filepath = dir .. "/" .. name .. ".json"
  M._load_file(filepath)
end

function M._load_file(filepath)
  local f = io.open(filepath, "r")
  if not f then
    utils.error("File not found: " .. filepath)
    return
  end

  local content = f:read("*a")
  f:close()

  local data = utils.json_decode(content)
  if not data or not data.messages then
    utils.error("Invalid conversation file.")
    return
  end

  state.messages = data.messages
  state.current_response = ""
  state.streaming = false

  -- Rebuild chat display
  if state.buf and vim.api.nvim_buf_is_valid(state.buf) then
    vim.bo[state.buf].modifiable = true
    vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, {
      "╭──────────────────────────────────────╮",
      "│         鉄 TetsuoCode                │",
      "│    Loaded: " .. vim.fn.fnamemodify(filepath, ":t:r") .. string.rep(" ", 26 - #vim.fn.fnamemodify(filepath, ":t:r")) .. "│",
      "╰──────────────────────────────────────╯",
      "",
    })
    vim.bo[state.buf].modifiable = false

    -- Re-render messages
    local cfg = config.get()
    for _, msg in ipairs(state.messages) do
      if msg.role == "user" then
        append_to_chat({
          "╭─ " .. cfg.ui.icons.user .. " ─────────────────────────────",
          "",
        })
        for _, line in ipairs(vim.split(msg.content, "\n")) do
          append_to_chat({ "  " .. line })
        end
        append_to_chat({ "", "╰──────────────────────────────────────", "" })
      elseif msg.role == "assistant" and msg.content then
        append_to_chat({
          "╭─ " .. cfg.ui.icons.assistant .. " ────────────────────────────",
          "",
        })
        for _, line in ipairs(vim.split(msg.content, "\n")) do
          append_to_chat({ line })
        end
        append_to_chat({ "", "╰──────────────────────────────────────", "" })
      end
    end
  end

  utils.notify("Loaded conversation (" .. #state.messages .. " messages).")
end

-- Get state (for external access)
function M.get_state()
  return state
end

-- Get token usage (for statusline)
function M.get_usage()
  return state.usage or {}
end

return M
