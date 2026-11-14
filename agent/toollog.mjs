// Pure formatter for the per-tool log line. Prints the tool name, ok, and for a failure only a short
// validated machine code: tool arguments and outputs contain what the caller said and are never logged.
const CODE = /^[a-z_]{1,40}$/;

export function toolLogLine(name, out) {
  const tool = typeof name === 'string' && CODE.test(name) ? name : 'unknown_tool';
  const prefix = `[agent] tool ${tool}`;
  if (!out || out.isError) return `${prefix} ok=false error=tool_exception`;
  let parsed;
  try {
    parsed = JSON.parse(out.output);
  } catch {
    return `${prefix} ok=false error=bad_output`;
  }
  if (parsed?.ok === true) return `${prefix} ok=true`;
  const error = parsed?.error;
  if (error === undefined || error === null) return `${prefix} ok=false error=none`;
  return `${prefix} ok=false error=${typeof error === 'string' && CODE.test(error) ? error : 'other'}`;
}
