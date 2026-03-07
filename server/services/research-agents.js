import { callClaude } from './claude-cli.js';
import { toolExecutors, parseToolCalls, extractText, ARTIFACTS_NODE_ID } from './chat-tools.js';
import { get as getConfig } from './config.js';

// Tools that sub-agents are NEVER allowed to call
const BLOCKED_TOOLS = new Set([
  'deep_research', 'open_file', 'create_node', 'create_crossref', 'add_resource',
  'save_resource', 'create_artifact',
]);

// All tools available to sub-agents (subset)
const SUB_AGENT_TOOLS = new Set([
  'search_papers', 'internet_search', 'fetch_url', 'search_knowledge',
  'search_files', 'read_file', 'list_nodes', 'get_node',
]);

// ── Build a focused tool definition string for a sub-agent ───────────

function buildSubAgentToolDefs(allowedTools) {
  const defs = {
    search_papers: 'search_papers — Search academic papers on Semantic Scholar and arXiv.\n   Args: { "query": "search terms", "source": "all|semantic_scholar|arxiv", "limit": 5, "year": "2024-2026" }',
    internet_search: 'internet_search — Search the web for current information.\n   Args: { "query": "search terms", "num_results": 5 }',
    fetch_url: 'fetch_url — Fetch a web page and return its text content.\n   Args: { "url": "https://example.com" }',
    search_knowledge: 'search_knowledge — Search the knowledge base using semantic similarity.\n   Args: { "query": "search text", "limit": 5 }',
    search_files: 'search_files — Search for files on the local machine by name pattern.\n   Args: { "directory": "/Users/you/Documents", "pattern": "*.pdf", "max_results": 20 }',
    read_file: 'read_file — Read the contents of a local file.\n   Args: { "path": "/absolute/path/to/file" }',
    list_nodes: 'list_nodes — List all nodes in the knowledge base.\n   Args: {}',
    get_node: 'get_node — Get details about a specific node.\n   Args: { "node_id": "uuid" }',
  };

  const filtered = allowedTools.filter(t => SUB_AGENT_TOOLS.has(t) && !BLOCKED_TOOLS.has(t));
  const toolList = filtered.map((t, i) => `${i + 1}. ${defs[t] || t}`).join('\n\n');

  return `You have tools available. To use a tool, output a tool_call block:
<tool_call>{"name": "tool_name", "args": {"key": "value"}}</tool_call>

Available tools:

${toolList}

Rules:
- Only output ONE tool_call per response. Wait for the result before calling another.
- You have a maximum of 8 tool calls.
- Report your findings with source citations (paper titles, URLs, DOIs).
- Be thorough but concise — bullet points preferred.
`;
}

// ── Run a single sub-agent ───────────────────────────────────────────

export async function runSubAgent(task, sseCallback, signal) {
  const chatConfig = await getConfig('chat');
  const subAgentPrompt = chatConfig?.subAgentPrompt ||
    'You are a focused research agent. Find information on your assigned topic using the tools available. Report facts with source citations. Be thorough but concise — bullet points preferred.';

  const tools = task.tools || ['search_papers', 'internet_search', 'fetch_url'];
  const toolDefs = buildSubAgentToolDefs(tools);

  const systemPrompt = `${subAgentPrompt}

## Your Task
${task.description}
${task.focus ? `\nFocus: ${task.focus}` : ''}

${toolDefs}

When you've gathered enough information, provide a final summary of your findings. Do NOT use any tool_call in your final summary response.`;

  const MAX_ITERATIONS = 8;
  const conversation = [`Human: Research the following: ${task.description}${task.focus ? ` Focus on: ${task.focus}` : ''}`];
  let findings = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal?.aborted) {
      findings += '\n[Research cancelled]';
      break;
    }

    const prompt = conversation.join('\n\n');
    let response;
    try {
      response = await callClaude(prompt, systemPrompt, 60_000);
    } catch (err) {
      findings += `\n[Agent error: ${err.message}]`;
      break;
    }

    const toolCalls = parseToolCalls(response);
    const textContent = extractText(response);

    if (textContent) {
      sseCallback?.('sub_agent_text', { taskId: task.id, text: textContent });
    }

    // No tool calls — agent is done
    if (toolCalls.length === 0) {
      findings = textContent || findings;
      break;
    }

    // Process the first tool call only (per our "one at a time" rule)
    const tc = toolCalls[0];

    // Block disallowed tools
    if (BLOCKED_TOOLS.has(tc.name) || !SUB_AGENT_TOOLS.has(tc.name)) {
      conversation.push(`Assistant: ${textContent || `[used tool: ${tc.name}]`}`);
      conversation.push(`Tool Result for ${tc.name}: {"error": "Tool not available to sub-agents"}`);
      continue;
    }

    sseCallback?.('sub_agent_tool', { taskId: task.id, tool: tc.name, args: tc.args });

    let result;
    const executor = toolExecutors[tc.name];
    if (!executor) {
      result = { error: `Unknown tool: ${tc.name}` };
    } else {
      try {
        result = await executor(tc.args);
      } catch (err) {
        result = { error: err.message };
      }
    }

    sseCallback?.('sub_agent_result', { taskId: task.id, tool: tc.name, result });

    // Truncate large results for the conversation context
    const resultStr = JSON.stringify(result);
    const truncated = resultStr.length > 3000 ? resultStr.substring(0, 3000) + '...(truncated)' : resultStr;

    conversation.push(`Assistant: ${textContent || `[used tool: ${tc.name}]`}`);
    conversation.push(`Tool Result for ${tc.name}: ${truncated}`);

    // On the last iteration, the text we have so far is our findings
    if (i === MAX_ITERATIONS - 1) {
      findings = textContent || findings || '[Max iterations reached]';
    }
  }

  return { taskId: task.id, description: task.description, findings };
}

// ── Orchestrator: run all sub-agents in parallel, then synthesize ────

export async function runResearch(question, tasks, nodeId, sseCallback, signal) {
  sseCallback?.('research_start', { question, tasks: tasks.map(t => ({ id: t.id, description: t.description })) });

  // Run all sub-agents in parallel
  const results = await Promise.allSettled(
    tasks.map(task => runSubAgent(task, sseCallback, signal))
  );

  if (signal?.aborted) {
    sseCallback?.('research_complete', { question, status: 'cancelled' });
    return { status: 'cancelled' };
  }

  // Collect findings
  const findings = results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return `### Agent ${i + 1}: ${r.value.description}\n\n${r.value.findings}`;
    }
    return `### Agent ${i + 1}: ${tasks[i].description}\n\n[Failed: ${r.reason?.message || 'Unknown error'}]`;
  }).join('\n\n---\n\n');

  sseCallback?.('research_synthesizing', { question });

  // Synthesize
  const chatConfig = await getConfig('chat');
  const synthesisPrompt = chatConfig?.synthesisPrompt ||
    'You are a research synthesizer. Combine findings from multiple research agents into a well-structured markdown document with: executive summary, main findings by theme, properly formatted citations, and a conclusion.';

  const synthesisInput = `Human: Synthesize these research findings into a comprehensive document.

## Research Question
${question}

## Findings from ${results.length} Research Agents

${findings}

Create a well-structured markdown document with:
1. Executive summary (2-3 sentences)
2. Main findings organized by theme
3. Properly formatted citations (include paper titles, authors, years, DOIs/URLs where available)
4. Key takeaways / conclusion

Use markdown headers, bullet points, and bold for emphasis. Include direct links to papers where available.`;

  let synthesis;
  try {
    synthesis = await callClaude(synthesisInput, synthesisPrompt, 120_000);
  } catch (err) {
    synthesis = `# Research: ${question}\n\n*Synthesis failed: ${err.message}*\n\n## Raw Findings\n\n${findings}`;
  }

  // Strip any tool calls from synthesis (shouldn't happen, but just in case)
  synthesis = extractText(synthesis) || synthesis;

  // Save as artifact
  const targetNodeId = nodeId || ARTIFACTS_NODE_ID;
  let artifact = null;
  try {
    artifact = await toolExecutors.create_artifact({
      node_id: targetNodeId,
      title: `Research - ${question.substring(0, 60)}`,
      type: 'markdown',
      content: synthesis,
    });
  } catch (err) {
    console.error('[Research] Failed to save artifact:', err.message);
  }

  sseCallback?.('research_complete', {
    question,
    status: 'done',
    synthesis,
    artifact,
  });

  return { status: 'done', synthesis, artifact, findings };
}
