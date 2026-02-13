-- SSE (Server-Sent Events) stream parser for xAI Grok API
local utils = require("tetsuo.utils")

local M = {}

-- Create a new SSE parser instance
function M.new(opts)
  opts = opts or {}
  return {
    buffer = "",           -- incomplete line buffer
    tool_calls = {},       -- accumulated tool call fragments
    usage = nil,           -- token usage from final chunk
    on_chunk = opts.on_chunk or function() end,
    on_tool_call = opts.on_tool_call or function() end,
    on_done = opts.on_done or function() end,
    on_error = opts.on_error or function() end,
  }
end

-- Parse a single SSE data payload (JSON string)
local function parse_payload(parser, json_str)
  local data = utils.json_decode(json_str)
  if not data then return end

  -- Check for errors
  if data.error then
    parser.on_error(data.error.message or "Unknown API error")
    return
  end

  local choices = data.choices
  if not choices or #choices == 0 then return end

  local choice = choices[1]
  local delta = choice.delta
  local finish_reason = choice.finish_reason

  if delta then
    -- Handle content chunks
    if delta.content and delta.content ~= "" then
      parser.on_chunk(delta.content)
    end

    -- Handle tool call chunks (they come in fragments)
    if delta.tool_calls then
      for _, tc in ipairs(delta.tool_calls) do
        local idx = tc.index + 1 -- lua 1-indexed
        if not parser.tool_calls[idx] then
          parser.tool_calls[idx] = {
            id = tc.id or "",
            type = "function",
            ["function"] = {
              name = "",
              arguments = "",
            },
          }
        end
        local existing = parser.tool_calls[idx]
        if tc.id then existing.id = tc.id end
        if tc["function"] then
          if tc["function"].name then
            existing["function"].name = existing["function"].name .. tc["function"].name
          end
          if tc["function"].arguments then
            existing["function"].arguments = existing["function"].arguments .. tc["function"].arguments
          end
        end
      end
    end
  end

  -- Capture usage if present
  if data.usage then
    parser.usage = data.usage
  end

  -- Stream finished
  if finish_reason == "tool_calls" and #parser.tool_calls > 0 then
    parser.on_tool_call(parser.tool_calls)
    parser.tool_calls = {}
  elseif finish_reason == "stop" then
    parser.on_done(parser.usage)
  end
end

-- Feed raw data from curl stdout into the parser
-- `data` is a table of lines from jobstart on_stdout callback
function M.feed(parser, data)
  for _, line in ipairs(data) do
    -- jobstart sends lines split by \n; accumulate partial lines
    local combined = parser.buffer .. line
    parser.buffer = ""

    -- Skip empty lines (SSE separators)
    if combined == "" then
      goto continue
    end

    -- Check for [DONE] signal
    if combined == "data: [DONE]" then
      if #parser.tool_calls > 0 then
        parser.on_tool_call(parser.tool_calls)
        parser.tool_calls = {}
      else
        parser.on_done()
      end
      goto continue
    end

    -- Parse "data: {json}" lines
    local json_str = combined:match("^data: (.+)$")
    if json_str then
      parse_payload(parser, json_str)
    elseif combined:match("^{") then
      -- Sometimes the data prefix is on a separate line
      parse_payload(parser, combined)
    else
      -- Incomplete line, buffer it
      parser.buffer = combined
    end

    ::continue::
  end
end

return M
