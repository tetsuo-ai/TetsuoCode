-- Grok API client with streaming support
local config = require("tetsuo.config")
local sse = require("tetsuo.sse")
local utils = require("tetsuo.utils")

local M = {}

-- Active job handle
local active_job = nil

-- Build the request body
local function build_request(messages, tools)
  local cfg = config.get()
  local body = {
    model = cfg.model,
    messages = messages,
    max_tokens = cfg.max_tokens,
    temperature = cfg.temperature,
    stream = true,
  }
  if tools and #tools > 0 then
    body.tools = tools
    body.tool_choice = "auto"
  end
  return body
end

-- Stream a chat completion from Grok
-- opts: { messages, tools, on_chunk, on_tool_call, on_done, on_error }
function M.stream_chat(opts)
  local cfg = config.get()

  if not cfg.api_key or cfg.api_key == "" then
    utils.error("No API key set. Export XAI_API_KEY or set api_key in setup().")
    return
  end

  -- Cancel any in-flight request
  M.cancel()

  local body = build_request(opts.messages, opts.tools)
  local body_json = utils.json_encode(body)

  -- Write body to temp file to avoid shell escaping nightmares
  local tmp = vim.fn.tempname()
  local f = io.open(tmp, "w")
  if not f then
    utils.error("Failed to create temp file for request body")
    return
  end
  f:write(body_json)
  f:close()

  local url = cfg.base_url .. "/chat/completions"

  local parser = sse.new({
    on_chunk = function(content)
      vim.schedule(function()
        if opts.on_chunk then opts.on_chunk(content) end
      end)
    end,
    on_tool_call = function(tool_calls)
      vim.schedule(function()
        if opts.on_tool_call then opts.on_tool_call(tool_calls) end
      end)
    end,
    on_done = function(usage)
      vim.schedule(function()
        if opts.on_done then opts.on_done(usage) end
      end)
    end,
    on_error = function(err)
      vim.schedule(function()
        if opts.on_error then opts.on_error(err) end
      end)
    end,
  })

  local stderr_buf = {}

  active_job = vim.fn.jobstart({
    "curl", "--silent", "--no-buffer",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "-H", "Authorization: Bearer " .. cfg.api_key,
    "-d", "@" .. tmp,
    url,
  }, {
    on_stdout = function(_, data)
      if data then
        sse.feed(parser, data)
      end
    end,
    on_stderr = function(_, data)
      if data then
        for _, line in ipairs(data) do
          if line ~= "" then table.insert(stderr_buf, line) end
        end
      end
    end,
    on_exit = function(_, exit_code)
      -- Clean up temp file
      pcall(os.remove, tmp)
      active_job = nil

      if exit_code ~= 0 then
        vim.schedule(function()
          local err_msg = table.concat(stderr_buf, "\n")
          if err_msg == "" then
            err_msg = "curl exited with code " .. exit_code
          end
          if opts.on_error then opts.on_error(err_msg) end
        end)
      end
    end,
  })

  if active_job <= 0 then
    pcall(os.remove, tmp)
    active_job = nil
    utils.error("Failed to start curl process. Is curl installed?")
  end
end

-- Cancel the active request
function M.cancel()
  if active_job then
    pcall(vim.fn.jobstop, active_job)
    active_job = nil
  end
end

-- Check if a request is in flight
function M.is_busy()
  return active_job ~= nil
end

return M
